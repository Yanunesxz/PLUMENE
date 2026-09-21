import { randomUUID } from 'node:crypto';
import { supabase } from '../../config/supabase.js';
import { detectarComCerteza } from '../../lib/detectarColuna.js';
import {
  CAMPOS_QUE_PRECISAM_DA_041,
  camposQueVieram,
  ehPecaDoEndereco,
  linhaDoEnderecoEditado,
  linhaForaDasPecas,
  mesmoValorDoCadastro,
  normalizarCampoDoCadastro,
  validarEdicaoDoCadastro,
  valoresEditaveisDoCliente,
} from '@csb/shared';
import type {
  AlteracaoDoCliente,
  CampoDoHistoricoDoCadastro,
  CampoEditavelDoCliente,
  CamposAlteradosDoCadastro,
  CustomerDetail,
  EditarCadastroDoClienteRequest,
  ErrosDaEdicaoDoCadastro,
  ValoresDoCadastro,
} from '@csb/shared';
import {
  buscarClienteComOMesmoDocumento,
  lerClienteDaCarteira,
  lerFichaDoCliente,
  obterCliente,
  type ClienteDuplicado,
  type EscopoDaCarteira,
} from './customers.service.js';
import { COLUNAS_DA_ALTERACAO, paraAlteracao, sondarMigracao051 } from './customers.alteracoes.service.js';

/**
 * EDITAR O CADASTRO DO CLIENTE (PATCH /customers/:id/cadastro, migração 051).
 *
 * Pedido do Yan (17/09/2026): "Não tem como alterar esses dados nem sendo admin
 * lá dentro. Quero poder mudar sim, e quando mudar lá tem que mudar no ERP do
 * Fábio também."
 *
 * Três cuidados moldam o fluxo:
 *
 *   1. Duas pessoas editando o mesmo cliente. A tela manda, junto de cada campo
 *      novo, o valor que a pessoa VIU; se o banco já não está com ele, 409
 *      MUDOU_DE_NOVO. E a gravação é compare-and-set numa instrução só (cada
 *      coluna mudada na condição do UPDATE): a edição que cair entre a leitura
 *      e a gravação também é pega — 0 linhas afetadas é 409.
 *   2. A mudança tem de chegar ao Control. Sem a linha em customer_changes o
 *      recado se perde, então sem a 051 a edição NÃO acontece; e se o
 *      histórico não grava, o cliente é desfeito (compare-and-set inverso).
 *   3. Cadastro legado. ~2.600 clientes da CS têm só a linha `address` e
 *      documento com máscara: tudo se compara normalizado (documento e CEP por
 *      dígitos), e o endereço só é exigido completo quando alguém mexe nele.
 *
 * Não há transação pelo PostgREST: a ordem é cliente → histórico → (se o
 * histórico falhou) desfazer o cliente.
 *
 * ERRO NÃO É "NÃO GRAVOU" (revisão de 17/09/2026). O postgrest-js não repete
 * PATCH nem POST: se a conexão cai (ou o gateway responde 502/504) DEPOIS de o
 * banco confirmar, a gravação ficou e a resposta chega como erro. Ler isso como
 * "nada mudou" deixava, no UPDATE, o cliente alterado sem histórico com a tela
 * dizendo "Nada foi alterado"; e, no insert do histórico, o cliente desfeito
 * com uma pendência fantasma na fila do Control. Por isso, diante do erro, a
 * edição RELÊ (GET, que o cliente do banco repete sozinho) antes de decidir:
 * o cliente ficou como a edição deixou? a linha do histórico — com o id gerado
 * aqui — existe?
 */

/** Quem está editando — o nome vai para o histórico (o login pode ser apagado). */
export interface QuemEdita {
  id: string;
  nome: string;
}

export type EdicaoDoCadastro =
  | { ok: true; sem_mudanca: true; detalhe: CustomerDetail | null }
  | {
      ok: true;
      sem_mudanca: false;
      detalhe: CustomerDetail | null;
      alteracao: AlteracaoDoCliente;
      /** O que o aviso ao financeiro precisa (o nome já com a edição aplicada). */
      cliente: { id: string; name: string; erp_id: string | null };
    }
  | {
      ok: false;
      motivo:
        | 'migracao_051_pendente'
        | 'migracao_041_pendente'
        | 'banco_indisponivel'
        | 'cliente_nao_encontrado'
        /** O histórico não gravou e o cliente foi desfeito: nada mudou. */
        | 'alteracao_nao_registrada';
    }
  | { ok: false; motivo: 'mudou_de_novo'; campos: CampoEditavelDoCliente[]; detalhe: CustomerDetail | null }
  | { ok: false; motivo: 'invalido'; erros: ErrosDaEdicaoDoCadastro }
  | { ok: false; motivo: 'documento_duplicado'; duplicado: ClienteDuplicado['duplicado'] }
  /** Falhou antes de gravar: nada mudou. */
  | { ok: false; motivo: 'erro'; detalhe: string }
  /**
   * O UPDATE respondeu erro e nem a releitura respondeu: não dá para dizer se
   * o cadastro mudou. Nunca "nada foi alterado" (ver o cabeçalho).
   */
  | { ok: false; motivo: 'gravacao_incerta'; detalhe: string }
  /** O cliente ficou gravado SEM histórico (o desfazer também falhou). */
  | { ok: false; motivo: 'sem_historico'; detalhe: string };

/** As colunas que a edição lê: as editáveis, a linha do endereço e o que decide a pendência. */
const COLUNAS_BASICAS = 'id, name, trade_name, cnpj, whatsapp, email, address, erp_id';
const COLUNAS_DA_041 = 'cep, logradouro, numero, complemento, bairro, cidade, uf, inscricao_estadual, observacoes';

type LinhaDoCliente = Record<string, unknown> & { id: string };

/** Aplica, para cada coluna, "ainda está com este valor" na condição do UPDATE. */
function comValoresAtuais<Q extends { eq: (c: string, v: unknown) => Q; is: (c: string, v: null) => Q }>(
  consulta: Q,
  valores: Record<string, unknown>,
): Q {
  let q = consulta;
  for (const [coluna, valor] of Object.entries(valores)) {
    q = valor == null ? q.is(coluna, null) : q.eq(coluna, valor);
  }
  return q;
}

/**
 * Como o cadastro ficou depois de um UPDATE que respondeu erro. Relê as colunas
 * da gravação e confere contra os dois estados que ela conhece: o que queria
 * deixar (`esperado`) e o de onde partiu (`anterior`).
 *
 *   • 'esperado'  — todas as colunas com o valor mandado: gravou;
 *   • 'anterior'  — todas ainda como antes: não gravou, nada mudou;
 *   • 'misturado' — nem um nem outro (outra mão mexeu em alguma coluna);
 *   • 'nao_sei'   — nem a releitura respondeu.
 *
 * Não confere `updated_at`: na PLUMENE a trigger da 013 troca o valor que a API
 * mandou pela hora do banco. As colunas bastam — cada uma mudou de verdade
 * (valor normalizado diferente do de antes).
 *
 * TRÊS ESTADOS, NÃO DOIS (revisão de 17/09/2026). Decidir só por `esperado`
 * ("todas as colunas com o valor mandado, senão não gravou") dava "nada foi
 * alterado" com a edição GRAVADA: basta outra mão trocar UMA das colunas do
 * mesmo patch na janela entre o commit e a releitura (o lote do POST
 * /partner/v1/clientes que leu o valor novo, o rep na própria ficha) para uma
 * coluna ficar num terceiro valor. A API respondia 500 "Nada foi alterado" com
 * o cadastro alterado e `customer_changes` vazio — a mudança nunca chegava ao
 * Control —, e a segunda tentativa levava 409 pela própria edição.
 */
async function comoOClienteFicou(
  company_id: string,
  customer_id: string,
  esperado: Readonly<Record<string, unknown>>,
  anterior: Readonly<Record<string, unknown>>,
): Promise<'esperado' | 'anterior' | 'misturado' | 'nao_sei'> {
  const { data, error } = await supabase
    .from('customers')
    .select(Object.keys(esperado).join(', '))
    .eq('id', customer_id)
    .eq('company_id', company_id)
    .maybeSingle();
  if (error) return 'nao_sei';
  // Sem a linha não há o que conferir: o cliente saiu da empresa ou foi apagado.
  if (!data) return 'anterior';
  const linha = data as unknown as Record<string, unknown>;
  const todasCom = (valores: Readonly<Record<string, unknown>>) =>
    Object.entries(valores).every(([coluna, valor]) =>
      mesmoValorDoCadastro(coluna as CampoDoHistoricoDoCadastro, linha[coluna], valor),
    );
  if (todasCom(esperado)) return 'esperado';
  if (todasCom(anterior)) return 'anterior';
  return 'misturado';
}

/**
 * O insert do histórico respondeu erro: a linha (pelo id gerado aqui) existe?
 * `nao_sei` = nem a releitura respondeu.
 */
async function comoOHistoricoFicou(
  company_id: string,
  id: string,
): Promise<{ situacao: 'gravou'; linha: Record<string, unknown> } | { situacao: 'nao_gravou' | 'nao_sei' }> {
  const { data, error } = await supabase
    .from('customer_changes')
    .select(COLUNAS_DA_ALTERACAO)
    .eq('id', id)
    .eq('company_id', company_id)
    .maybeSingle();
  if (error) return { situacao: 'nao_sei' };
  if (!data) return { situacao: 'nao_gravou' };
  return { situacao: 'gravou', linha: data as unknown as Record<string, unknown> };
}

export async function editarCadastroDoCliente(
  company_id: string,
  customer_id: string,
  pedido: EditarCadastroDoClienteRequest,
  escopo: EscopoDaCarteira,
  quem: QuemEdita,
): Promise<EdicaoDoCadastro> {
  const campos = camposQueVieram(pedido.novo);

  // ─── 1. As migrações ───────────────────────────────────────────────────────
  // Sem o histórico (051) a edição não acontece — a mudança nunca chegaria ao
  // Control. "Não sei" (o banco não respondeu) também para, com outra mensagem.
  const m051 = await sondarMigracao051();
  if (m051 === 'nao_existe') return { ok: false, motivo: 'migracao_051_pendente' };
  if (m051 === 'nao_sei') return { ok: false, motivo: 'banco_indisponivel' };

  // Endereço em peças, IE e observações só existem com a 041. Quem só mexe no
  // WhatsApp de um banco sem a 041 segue normalmente.
  const m041 = await detectarComCerteza('customers', 'cep');
  if (campos.some((c) => CAMPOS_QUE_PRECISAM_DA_041.includes(c))) {
    if (m041 === 'nao_existe') return { ok: false, motivo: 'migracao_041_pendente' };
    if (m041 === 'nao_sei') return { ok: false, motivo: 'banco_indisponivel' };
  }
  const colunas = m041 === 'existe' ? `${COLUNAS_BASICAS}, ${COLUNAS_DA_041}` : COLUNAS_BASICAS;

  // ─── 2. O cliente, dentro da carteira de quem pediu ────────────────────────
  const lido = await lerClienteDaCarteira<LinhaDoCliente>(company_id, customer_id, escopo, colunas);
  if (lido.error) return { ok: false, motivo: 'erro', detalhe: lido.error.message };
  const linha = lido.data;
  if (!linha) return { ok: false, motivo: 'cliente_nao_encontrado' };
  const atual: ValoresDoCadastro = valoresEditaveisDoCliente(linha);

  // ─── 3. Alguém mudou no meio? ──────────────────────────────────────────────
  // Por cada campo que a pessoa quer mudar, o banco ainda está com o valor que
  // ela viu. Comparação normalizada: máscara de documento não é conflito.
  const conflitos = campos.filter((c) => !mesmoValorDoCadastro(c, linha[c], pedido.vistos[c]));
  if (conflitos.length > 0) {
    return {
      ok: false,
      motivo: 'mudou_de_novo',
      campos: conflitos,
      detalhe: await obterCliente(company_id, customer_id, escopo),
    };
  }

  // ─── 4. Só o que mudou de verdade ──────────────────────────────────────────
  const mudados = campos.filter((c) => !mesmoValorDoCadastro(c, linha[c], pedido.novo[c]));
  if (mudados.length === 0) {
    // Nada a gravar — nem o updated_at, que faria o Control reler um cadastro igual.
    // A ficha que volta é relida SEM engolir o erro (17/09/2026): o cliente acabou
    // de ser achado na carteira, e o banco que não respondeu virava 404 "não
    // encontrado na sua carteira". Nada foi gravado: é o "tente de novo".
    const ficha = await lerFichaDoCliente(company_id, customer_id, escopo);
    if (ficha.error) return { ok: false, motivo: 'banco_indisponivel' };
    return { ok: true, sem_mudanca: true, detalhe: ficha.data };
  }
  const novo: ValoresDoCadastro = {};
  for (const c of mudados) novo[c] = normalizarCampoDoCadastro(c, pedido.novo[c]);

  // ─── 5. A régua do cadastro novo ───────────────────────────────────────────
  const erros = validarEdicaoDoCadastro(atual, novo);
  if (Object.keys(erros).length > 0) return { ok: false, motivo: 'invalido', erros };

  // ─── 6. Documento de outro cliente? ────────────────────────────────────────
  if (mudados.includes('cnpj') && novo.cnpj) {
    // Sem resposta do banco, não grava (revisão de 17/09/2026): esta busca é a
    // única trava contra documento repetido (o índice da 041 não é UNIQUE), e
    // o erro lido como "ninguém tem" deixava duas lojas com o mesmo CPF/CNPJ.
    const busca = await buscarClienteComOMesmoDocumento(company_id, novo.cnpj, customer_id);
    if (busca.error) {
      console.error(
        `[editar-cadastro] cliente ${customer_id}: não deu para conferir se o documento novo é de outro cliente (${busca.error.message}); nada gravado`,
      );
      return { ok: false, motivo: 'banco_indisponivel' };
    }
    if (busca.duplicado) return { ok: false, motivo: 'documento_duplicado', duplicado: busca.duplicado };
  }

  // ─── 7. O que vai para o banco e para o histórico ──────────────────────────
  const patch: Record<string, string | null> = {};
  const historico: CamposAlteradosDoCadastro = {};
  for (const c of mudados) {
    const depois = novo[c] ?? null;
    patch[c] = depois;
    historico[c] = { antes: normalizarCampoDoCadastro(c, linha[c]), depois };
  }
  // A linha única nunca vem de fora: mexeu numa peça, o servidor remonta.
  if (mudados.some(ehPecaDoEndereco)) {
    const address = linhaDoEnderecoEditado(atual, novo);
    if (!mesmoValorDoCadastro('address', linha['address'], address)) {
      patch['address'] = address;
      historico.address = { antes: normalizarCampoDoCadastro('address', linha['address']), depois: address };
      // A linha de antes já não era a das peças (17/09/2026): a troca dela não
      // se explica pelas peças que mudaram — marca, para o cartão mostrá-la.
      if (linhaForaDasPecas(linha['address'], atual)) historico.address.linha_fora_das_pecas = true;
    }
  }
  const antesCru: Record<string, unknown> = {};
  for (const coluna of Object.keys(patch)) antesCru[coluna] = linha[coluna] ?? null;

  // ─── 8. Compare-and-set no cliente ─────────────────────────────────────────
  // `updated_at` à mão: a 013 (trigger) nunca rodou na CS, e é por ele que o
  // Control descobre, no GET ?desde=, que o cadastro mudou.
  const agora = new Date().toISOString();
  const { data: gravadas, error: erroDaGravacao } = await comValoresAtuais(
    supabase
      .from('customers')
      .update({ ...patch, updated_at: agora })
      .eq('id', customer_id)
      .eq('company_id', company_id),
    antesCru,
  ).select('id');
  if (erroDaGravacao) {
    // Erro no UPDATE não prova que ele não gravou (17/09/2026): a resposta pode
    // ter se perdido depois do commit. Dizer "Nada foi alterado" nesse caso
    // deixava o cliente alterado SEM histórico — e a pessoa, tentando de novo,
    // levava um 409 "alguém alterou" pela própria edição. Relê e decide.
    //
    // "Nada foi alterado" só com TODAS as colunas ainda como antes. A mistura
    // (parte da edição gravada, ou uma coluna num terceiro valor porque outra
    // mão mexeu na janela do gateway) não é "nada mudou": é o caso incerto, que
    // a tela já trata relendo a ficha.
    const ficou = await comoOClienteFicou(company_id, customer_id, patch, antesCru);
    if (ficou === 'anterior') return { ok: false, motivo: 'erro', detalhe: erroDaGravacao.message };
    if (ficou !== 'esperado') {
      const detalhe = `o UPDATE respondeu erro (${erroDaGravacao.message}) e a releitura ${
        ficou === 'nao_sei'
          ? 'também falhou'
          : 'achou o cadastro nem todo como antes nem todo como a edição deixou (outra mão mexeu)'
      }; colunas: ${Object.keys(patch).join(', ')}`;
      console.error(
        `[editar-cadastro] ALERTA: cliente ${customer_id} pode ter ficado ALTERADO SEM HISTÓRICO — não deu para conferir. ${detalhe}`,
      );
      return { ok: false, motivo: 'gravacao_incerta', detalhe };
    }
    // Gravou: segue para o histórico, como se a resposta tivesse chegado.
    console.error(
      `[editar-cadastro] cliente ${customer_id}: o UPDATE respondeu erro (${erroDaGravacao.message}), mas gravou — seguindo para o histórico`,
    );
  } else if (!Array.isArray(gravadas) || gravadas.length === 0) {
    // Alguém gravou entre a leitura e o UPDATE. A tela recarrega com o de agora.
    //
    // Releitura que FALHA não é "não encontrado" (17/09/2026): o 404 dizia ao
    // representante que o cliente tinha saído da carteira dele — com o cliente
    // lá e nada gravado. O 0 linhas já prova o conflito: 409 sem a ficha, e a
    // tela relê pelo GET (ver `fichaDoConflito`). Os campos, sem a releitura,
    // não se sabem.
    const ficha = await lerFichaDoCliente(company_id, customer_id, escopo);
    if (ficha.error) {
      console.error(
        `[editar-cadastro] cliente ${customer_id}: o compare-and-set não achou o cadastro como lido e a releitura falhou (${ficha.error.message}); nada gravado`,
      );
      return { ok: false, motivo: 'mudou_de_novo', campos: [], detalhe: null };
    }
    const detalhe = ficha.data;
    if (!detalhe) return { ok: false, motivo: 'cliente_nao_encontrado' };
    const agoraNoBanco = detalhe as unknown as Record<string, unknown>;
    return {
      ok: false,
      motivo: 'mudou_de_novo',
      campos: mudados.filter((c) => !mesmoValorDoCadastro(c, agoraNoBanco[c], linha[c])),
      detalhe,
    };
  }

  // ─── 9. O histórico — e a fila do Control ──────────────────────────────────
  // Pendente só se o cliente JÁ está no Control: o nascido no app ainda não
  // incluído vai para lá com os dados de hoje, pela fila de "incluir". Se o
  // Control já o tinha puxado (e ainda não devolveu o código), a adoção pelo
  // CNPJ no POST /partner/v1/clientes confere esta edição e a põe na fila
  // sempre que o registro não mostrar o mesmo valor — outro valor ou o campo
  // ausente (17/09/2026); a edição que cair durante o lote também (o 3a de
  // `receberClientes`).
  const erpCru = linha['erp_id'];
  const erp_id = typeof erpCru === 'string' && erpCru.trim() !== '' ? erpCru.trim() : null;
  // O id nasce aqui, e não no banco (17/09/2026): se a resposta do insert se
  // perder, é por ele que se descobre se a linha ficou — e se apaga a que ficou.
  const idDaAlteracao = randomUUID();
  const { data: registradaNaResposta, error: erroDoHistorico } = await supabase
    .from('customer_changes')
    .insert({
      id: idDaAlteracao,
      company_id,
      customer_id,
      alterado_por: quem.id,
      alterado_por_nome: quem.nome,
      alterado_em: agora,
      campos: historico,
      erp_pendente: erp_id !== null,
    })
    .select(COLUNAS_DA_ALTERACAO)
    .single();

  let registrada: unknown = registradaNaResposta;
  const motivoDoHistorico = erroDoHistorico?.message ?? 'o histórico não voltou do banco';
  if (erroDoHistorico || !registrada) {
    // A linha pode ter sido gravada e só a resposta se perdido (17/09/2026).
    // Desfazer o cliente nesse caso deixava uma pendência FANTASMA: a ficha e
    // a fila mandavam o financeiro pôr no Control um valor que o app não tem —
    // e o Control, devolvendo esse valor pela API, gravava de volta no app a
    // edição que o representante ouviu que não foi salva.
    const conferida = await comoOHistoricoFicou(company_id, idDaAlteracao);
    if (conferida.situacao === 'gravou') {
      console.error(
        `[editar-cadastro] cliente ${customer_id}: o insert do histórico respondeu erro (${motivoDoHistorico}), mas gravou — edição mantida`,
      );
      registrada = conferida.linha;
    } else {
      // Não deu para conferir: apaga pelo id antes de desfazer o cliente. Sem
      // conseguir nem apagar, NÃO desfaz — desfazer com a linha talvez gravada
      // é a pendência fantasma de novo; o cliente fica, com o alerta abaixo.
      const apagada =
        conferida.situacao === 'nao_gravou' ||
        !(await supabase.from('customer_changes').delete().eq('id', idDaAlteracao).eq('company_id', company_id)).error;
      if (!apagada) {
        const detalhe = `histórico respondeu erro (${motivoDoHistorico}) e não deu para conferir nem apagar a linha ${idDaAlteracao}; o cliente NÃO foi desfeito; colunas: ${Object.keys(patch).join(', ')}`;
        console.error(
          `[editar-cadastro] ALERTA: cliente ${customer_id} ficou ALTERADO, talvez SEM HISTÓRICO — a mudança pode não chegar ao Control. ${detalhe}`,
        );
        return { ok: false, motivo: 'sem_historico', detalhe };
      }
    }
  }

  if (!registrada) {
    // Sem o histórico a mudança nunca chegaria ao Control: desfaz o cliente,
    // com a condição inversa (só volta onde ainda está o que esta edição gravou).
    const { data: desfeitas, error: erroDoDesfazer } = await comValoresAtuais(
      supabase
        .from('customers')
        .update({ ...antesCru, updated_at: new Date().toISOString() })
        .eq('id', customer_id)
        .eq('company_id', company_id),
      patch,
    ).select('id');
    let desfeito = !erroDoDesfazer && Array.isArray(desfeitas) && desfeitas.length > 0;
    if (!desfeito) {
      // O desfazer também é um UPDATE cuja resposta pode se perder depois do
      // commit (17/09/2026). Lido como "não desfez", a API dizia "O cadastro foi
      // alterado… avise o suporte" com o cadastro já de volta ao original — a
      // tela fechava o diálogo, a digitação sumia e o suporte recebia um alerta
      // falso. Relê: voltou ao de antes é "nada mudou"; sem resposta, não se sabe.
      //
      // Vale também para o desfazer SEM erro e com 0 linhas (17/09/2026): o
      // cadastro já não está como a edição deixou — mas pode estar justamente
      // como estava antes dela (o lote do Control que leu o valor novo sem
      // pendência e gravou o antigo; outra pessoa que pôs o valor de volta).
      // Aí nada mudou, e o 500 "foi alterado" era o mesmo alerta falso.
      // Aqui só o 'esperado' (o cadastro de volta ao de antes) é "nada mudou". A
      // mistura continua sendo "ficou alterado e não deu para desfazer": o
      // cadastro não está como antes, e não há histórico (17/09/2026).
      const voltou = await comoOClienteFicou(company_id, customer_id, antesCru, patch);
      if (voltou === 'esperado') {
        desfeito = true;
        console.error(
          `[editar-cadastro] cliente ${customer_id}: ${
            erroDoDesfazer
              ? `o desfazer respondeu erro (${erroDoDesfazer.message}), mas desfez`
              : 'o desfazer não achou o cliente como a edição deixou, mas o cadastro já estava de volta ao de antes'
          }`,
        );
      } else if (voltou === 'nao_sei') {
        const detalhe = `histórico não gravou (${motivoDoHistorico}), o desfazer ${
          erroDoDesfazer ? `respondeu erro (${erroDoDesfazer.message})` : 'não achou o cliente como a edição deixou'
        } e a releitura também falhou; colunas: ${Object.keys(patch).join(', ')}`;
        console.error(
          `[editar-cadastro] ALERTA: cliente ${customer_id} pode ter ficado ALTERADO SEM HISTÓRICO — não deu para conferir. ${detalhe}`,
        );
        return { ok: false, motivo: 'gravacao_incerta', detalhe };
      }
    }
    if (desfeito) {
      console.error(`[editar-cadastro] cliente ${customer_id}: histórico não gravou (${motivoDoHistorico}); edição desfeita`);
      return { ok: false, motivo: 'alteracao_nao_registrada' };
    }
    // Só ids e nomes de coluna no log: nada de nome ou documento de cliente.
    const detalhe = `histórico não gravou (${motivoDoHistorico}) e o desfazer ${
      erroDoDesfazer ? `falhou (${erroDoDesfazer.message})` : 'não achou o cliente como a edição deixou'
    }; colunas: ${Object.keys(patch).join(', ')}`;
    console.error(
      `[editar-cadastro] ALERTA: cliente ${customer_id} ficou ALTERADO SEM HISTÓRICO — a mudança não vai chegar ao Control. ${detalhe}`,
    );
    return { ok: false, motivo: 'sem_historico', detalhe };
  }

  const alteracao = paraAlteracao(registrada as unknown as Record<string, unknown>);
  const detalhe = await obterCliente(company_id, customer_id, escopo);
  const nome = patch['name'] ?? (typeof linha['name'] === 'string' ? linha['name'] : '');
  return {
    ok: true,
    sem_mudanca: false,
    detalhe,
    alteracao,
    cliente: { id: customer_id, name: nome, erp_id },
  };
}
