/**
 * A EDIÇÃO DO CADASTRO FEITA NO APP diante do que o Control manda (migração
 * 051, 17/09/2026).
 *
 * Pedido do Yan: "quando mudar lá tem que mudar no ERP do Fábio também". A
 * pessoa edita o cadastro no app (PATCH /customers/:id/cadastro) e a edição
 * fica PENDENTE em `customer_changes` até chegar ao Control. Enquanto isso, o
 * Control continua mandando o cliente pelo POST /partner/v1/clientes — com o
 * valor ANTIGO. Sem esta conferência, o próximo lote apagaria a edição do app
 * em silêncio, e a pendência ficaria apontando para um valor que já não está
 * em lugar nenhum.
 *
 * A regra, coluna pendente a coluna pendente (as outras seguem a regra de
 * sempre do POST):
 *
 *   • o Control mandou o MESMO valor do app (comparação normalizada do
 *     @csb/shared: documento e CEP por dígitos, UF maiúscula, vazio = nulo) →
 *     a coluna ALCANÇOU o Control;
 *   • mandou OUTRO valor → a coluna sai do que vai ser gravado (a edição do app
 *     não é sobrescrita) e o lote avisa;
 *   • não mandou a chave → nada a conferir; a edição continua pendente.
 *
 * Uma edição pendente cujas colunas TODAS alcançaram está resolvida pelo
 * próprio Control (`erp_atualizado_via = 'api'`) — quem grava é o chamador.
 *
 * O "valor do app" de uma coluna pendente é o `depois` da edição mais recente
 * dela — o que a pessoa gravou —, não a leitura do cliente feita no começo do
 * lote. Os dois são iguais no dia a dia; a diferença é a edição que cai no meio
 * do lote (depois da leitura dos clientes, antes da leitura das pendências):
 * comparar com a leitura velha daria a edição nova por "alcançada" com o valor
 * antigo do Control.
 *
 * "Mais recente" entre TODAS as edições da coluna, não só as pendentes
 * (revisão de 17/09/2026). O Control resolve edição por edição: aplicou só a
 * mais nova (nome fantasia B→C) e ainda não a mais velha (nome fantasia A→B e
 * e-mail X→Y), a mais nova sai da fila — e, contando só as pendentes, o `depois`
 * vencido da velha (B) virava o valor do app. O Control com tudo igual ao app
 * (C e Y) levava aviso falso e a velha nunca fechava; o Control com o B que o
 * cartão ainda mostrava fechava a velha e gravava B por cima do C do app.
 * Quem chama passa as edições já resolvidas junto das pendentes; a coluna
 * continua protegida enquanto ALGUMA pendente mexe nela.
 *
 * O ENDEREÇO É UM GRUPO: as sete peças e a linha (`address`) alcançam juntas
 * ou não alcançam. Peça diferente — pendente ou não — tira o endereço inteiro
 * do que grava; misturar a rua do app com o bairro do Control montaria um
 * endereço que não existe em nenhum dos dois lados.
 *
 * Um detalhe do Firebird: o CHAR nulo chega como "". Para GRAVAR, "" não mexe
 * (regra da fase 0). Para CONFERIR se o Control já tem o valor do app, "" é o
 * Control dizendo que o campo está vazio lá — senão uma edição que limpou o
 * e-mail no app nunca seria dada por alcançada.
 *
 * O WHATSAPP NÃO ENTRA AQUI (22/09/2026). É dado só do app (Yan: "numero uma
 * coisa numero de wtss outro"): o Control não o recebe, então ele nunca
 * "alcança" nem é "mantido" com aviso. Quem o protege é a regra do próprio
 * POST (`receberClientes`): cliente existente com WhatsApp preenchido ignora o
 * que o Control mandar; vazio, é preenchido — menos o vazio que o app deixou
 * de propósito (edição do WhatsApp no histórico, o passo 2d; revisão de
 * 22/09/2026). Uma edição mista (WhatsApp e e-mail) é conferida só pelo e-mail.
 */
import {
  CAMPO_DO_CONTRATO_DO_PARCEIRO,
  PECAS_DO_ENDERECO_DO_CLIENTE,
  camposNoContratoDoParceiro,
  ehPecaDoEndereco,
  mesmoValorDoCadastro,
  vaiParaOControl,
} from '@csb/shared';
import type {
  AlteracaoDoCliente,
  CampoDoHistoricoDoCadastro,
  NomeNoContratoDoParceiro,
} from '@csb/shared';
import {
  alteracoesQueAlcancaram,
  estaPendente,
} from '../customers/customers.alteracoes.service.js';

export interface ConferenciaDaEdicaoNoApp {
  /** Campos (nomes do contrato) que o Control mandou diferentes: ficaram com o valor do app. */
  mantidos: NomeNoContratoDoParceiro[];
  /** Ids das edições pendentes que o Control alcançou — a resolver com via 'api'. */
  alcancadas: string[];
  /** Ids das edições pendentes com alguma coluna que o Control mandou diferente (e ficou com o valor do app). */
  comColunaMantida: string[];
  /** Sobrou edição do app que o Control ainda não tem? */
  aindaPendente: boolean;
}

const NADA_PENDENTE: ConferenciaDaEdicaoNoApp = {
  mantidos: [],
  alcancadas: [],
  comColunaMantida: [],
  aindaPendente: false,
};

/** As colunas do grupo do endereço: as sete peças e a linha única. */
const COLUNAS_DO_ENDERECO: readonly CampoDoHistoricoDoCadastro[] = [
  ...PECAS_DO_ENDERECO_DO_CLIENTE,
  'address',
];

const ehObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const ehColunaDoHistorico = (c: string): c is CampoDoHistoricoDoCadastro =>
  Object.prototype.hasOwnProperty.call(CAMPO_DO_CONTRATO_DO_PARCEIRO, c);

type Lido = { veio: false } | { veio: true; valor: string | number | null };

/**
 * A chave do corpo, crua, para CONFERIR: texto (inclusive ""), número ou null.
 * Ausente, objeto ou lista (lixo) = não veio.
 */
function lido(obj: Record<string, unknown>, chave: string): Lido {
  if (!Object.prototype.hasOwnProperty.call(obj, chave)) return { veio: false };
  const v = obj[chave];
  if (v === null || typeof v === 'string' || typeof v === 'number') return { veio: true, valor: v };
  return { veio: false };
}

/**
 * Confere um registro do POST /clientes contra as edições pendentes do app
 * daquele cliente e TIRA de `pedido` (as colunas que o registro pede para
 * gravar) cada coluna pendente que o Control mandou diferente.
 *
 * `raw` é o registro como veio; `existente`, a linha do cliente lida no começo
 * do lote; `alteracoes`, as edições do cliente — as pendentes e as já
 * resolvidas (estas só dão o valor atual do app). Sem edição pendente, não
 * mexe em nada.
 */
export function conferirEdicoesDoApp(
  raw: Record<string, unknown>,
  pedido: Record<string, unknown>,
  existente: Record<string, unknown>,
  alteracoes: readonly AlteracaoDoCliente[] | undefined,
): ConferenciaDaEdicaoNoApp {
  const pendentes = (alteracoes ?? []).filter(estaPendente);
  if (pendentes.length === 0) return NADA_PENDENTE;

  // O valor do app de cada coluna pendente: o da edição mais recente vence —
  // pendente ou não (ver o cabeçalho). Só as colunas de alguma pendente entram,
  // e só as que vão para o Control (o WhatsApp não é conferido, 22/09/2026).
  const colunasDasPendentes = new Set<string>(
    pendentes.flatMap((a) => Object.keys(a.campos)).filter(vaiParaOControl),
  );
  const doApp = new Map<CampoDoHistoricoDoCadastro, string | null>();
  const maisAntigasPrimeiro = [...new Map((alteracoes ?? []).map((a) => [a.id, a])).values()].sort(
    (a, b) => a.alterado_em.localeCompare(b.alterado_em) || a.id.localeCompare(b.id),
  );
  for (const a of maisAntigasPrimeiro) {
    for (const [coluna, mudanca] of Object.entries(a.campos)) {
      if (mudanca && ehColunaDoHistorico(coluna) && colunasDasPendentes.has(coluna)) doApp.set(coluna, mudanca.depois);
    }
  }

  const alcancaram = new Set<string>();
  const diferentes = new Set<CampoDoHistoricoDoCadastro>();

  // ── Os campos soltos (razão social, fantasia, documento, IE, contato, observações)
  for (const [coluna, valorDoApp] of doApp) {
    if (coluna === 'address' || ehPecaDoEndereco(coluna)) continue;
    const doControl = lido(raw, CAMPO_DO_CONTRATO_DO_PARCEIRO[coluna]);
    if (!doControl.veio) continue;
    if (mesmoValorDoCadastro(coluna, doControl.valor, valorDoApp)) {
      alcancaram.add(coluna);
    } else {
      diferentes.add(coluna);
      delete pedido[coluna];
    }
  }

  // ── O endereço, como grupo
  const enderecoPendente = [...doApp.keys()].some((c) => c === 'address' || ehPecaDoEndereco(c));
  if (enderecoPendente && Object.prototype.hasOwnProperty.call(raw, 'endereco')) {
    const e = raw['endereco'];
    const valorDoApp = (c: CampoDoHistoricoDoCadastro): unknown =>
      doApp.has(c) ? doApp.get(c) : existente[c];
    let bate: boolean | null = null;
    let chegouInteiro = false;

    if (e === null) {
      // O Control limpou o endereço lá.
      bate = COLUNAS_DO_ENDERECO.every((c) => mesmoValorDoCadastro(c, null, valorDoApp(c)));
      chegouInteiro = true;
    } else if (typeof e === 'string') {
      // A linha pronta: ela carrega todas as peças.
      bate = mesmoValorDoCadastro('address', e, valorDoApp('address'));
      chegouInteiro = true;
    } else if (ehObjeto(e)) {
      bate = PECAS_DO_ENDERECO_DO_CLIENTE.every((p) => {
        if (doApp.has(p)) {
          const doControl = lido(e, p);
          return !doControl.veio || mesmoValorDoCadastro(p, doControl.valor, doApp.get(p));
        }
        // Peça que o app não editou: vale o que o Control TEM, cru, como na peça
        // editada (revisão de 17/09/2026). Conferida pelo que o registro pede
        // para GRAVAR, o "" do Firebird (bairro vazio lá) sumia — "" não grava —
        // e contava como igual ao "Centro" do app: a edição saía da fila do
        // financeiro sem aviso, com o Control sem o bairro da própria edição.
        const doControl = lido(e, p);
        return !doControl.veio || mesmoValorDoCadastro(p, doControl.valor, existente[p]);
      });
      // Alcança só se cada peça editada no app veio no objeto — peça ausente
      // não diz o que o Control tem.
      chegouInteiro = PECAS_DO_ENDERECO_DO_CLIENTE.filter((p) => doApp.has(p)).every(
        (p) => lido(e, p).veio,
      );
    }
    // Outro tipo (lixo) não mexe no endereço — o POST também o ignora.

    if (bate === false) {
      diferentes.add('address');
      for (const c of COLUNAS_DO_ENDERECO) delete pedido[c];
    } else if (bate === true && chegouInteiro) {
      for (const c of COLUNAS_DO_ENDERECO) alcancaram.add(c);
    }
  }

  const alcancadas = alteracoesQueAlcancaram(pendentes, alcancaram);
  const resolvidas = new Set(alcancadas);
  const mantida = (c: string) =>
    diferentes.has(c as CampoDoHistoricoDoCadastro) ||
    (diferentes.has('address') && (c === 'address' || ehPecaDoEndereco(c as CampoDoHistoricoDoCadastro)));
  return {
    mantidos: camposNoContratoDoParceiro(diferentes),
    alcancadas,
    comColunaMantida: pendentes.filter((a) => Object.keys(a.campos).some(mantida)).map((a) => a.id),
    aindaPendente: pendentes.some((a) => !resolvidas.has(a.id)),
  };
}

/**
 * A edição do app que caiu ENTRE as duas gravações dela (revisão de
 * 17/09/2026): a tela grava primeiro o cliente e só depois a linha do
 * histórico. O lote que lê o cliente nesse meio vê o valor novo do app sem
 * pendência nenhuma — e o compare-and-set passa, porque a condição é o próprio
 * valor novo. A edição sumia calada, e a pendência (gravada logo depois)
 * apontava para um valor que não estava em lugar nenhum.
 *
 * Depois de gravar, o lote relê as pendências dos clientes que gravou. Uma
 * edição pendente que o lote NÃO tinha visto e cujo `depois` é justamente o
 * valor que ele leu (e trocou) foi apagada por ele: estas são as colunas a
 * devolver ao valor lido. O endereço é um grupo — uma peça apagada devolve
 * todas as colunas do endereço que o lote trocou.
 *
 * `lidas` = o valor lido de cada coluna do app que o lote gravou (a condição do
 * UPDATE); `gravadas` = o que ele gravou.
 */
export function colunasQueOLoteApagou(
  edicoesNaoVistas: readonly AlteracaoDoCliente[],
  lidas: Readonly<Record<string, unknown>>,
  gravadas: Readonly<Record<string, unknown>>,
): CampoDoHistoricoDoCadastro[] {
  const trocadaPeloLote = (c: CampoDoHistoricoDoCadastro) =>
    Object.prototype.hasOwnProperty.call(lidas, c) && !mesmoValorDoCadastro(c, gravadas[c], lidas[c]);
  const apagadas = new Set<CampoDoHistoricoDoCadastro>();
  for (const a of edicoesNaoVistas.filter(estaPendente)) {
    for (const [coluna, mudanca] of Object.entries(a.campos)) {
      // O WhatsApp não volta por aqui (22/09/2026): o lote só o grava onde o
      // app o tinha vazio e nunca o editou (o 2d de `receberClientes`) — a
      // regra do POST, a mesma com ou sem edição no meio; a edição que troca a
      // coluna depois da leitura barra o UPDATE pelo compare-and-set.
      if (!mudanca || !ehColunaDoHistorico(coluna) || !vaiParaOControl(coluna) || !trocadaPeloLote(coluna)) continue;
      if (mesmoValorDoCadastro(coluna, mudanca.depois, lidas[coluna])) apagadas.add(coluna);
    }
  }
  if ([...apagadas].some((c) => c === 'address' || ehPecaDoEndereco(c))) {
    for (const c of COLUNAS_DO_ENDERECO) if (trocadaPeloLote(c)) apagadas.add(c);
  }
  return [...apagadas];
}
