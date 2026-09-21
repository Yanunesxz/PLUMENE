import {
  CAMPOS_EDITAVEIS_DO_CLIENTE,
  ROTULO_DO_CAMPO_DO_CADASTRO,
  camposQueVieram,
  ehPecaDoEndereco,
  formatarCep,
  formatarDocumento,
  formatarValorDoCadastro,
  mesmoValorDoCadastro,
  rotulosDosCamposAlterados,
  valoresEditaveisDoCliente,
} from '@csb/shared';
import type {
  AlteracaoDoCliente,
  AuthRole,
  AvisadosDaAlteracao,
  CampoDoHistoricoDoCadastro,
  CampoEditavelDoCliente,
  CustomerDetail,
  CustomerListItem,
  EditarCadastroDoClienteResponse,
  ErrosDaEdicaoDoCadastro,
  ValoresDoCadastro,
} from '@csb/shared';
import type { ErroDaApi } from '../services/api.js';

/**
 * As contas das telas de edição do cadastro (Yan, 17/09/2026: "Quero poder
 * mudar sim, e quando mudar lá tem que mudar no ERP do Fábio também"), fora dos
 * componentes para serem testadas sem navegador.
 *
 * A régua (o que é "o mesmo valor", o que é válido, quem pode) mora em
 * @csb/shared e é a mesma da API. Aqui fica só o que é da tela: o formulário
 * em texto, as frases e o que mostrar no cartão "Para atualizar no Control".
 */

/** O formulário é texto puro, um campo por coluna editável. */
export type FormularioDoCadastro = Record<CampoEditavelDoCliente, string>;

/**
 * Os valores crus dos campos editáveis de um cliente — os `vistos` do pedido.
 * É o mesmo helper que a API usa com a linha do banco; o nome daqui fica por
 * ser o que as telas e os testes já chamam.
 */
export function valoresDoCliente(cliente: ValoresDoCadastro): ValoresDoCadastro {
  return valoresEditaveisDoCliente(cliente);
}

/**
 * O formulário preenchido com o cadastro de agora. Documento e CEP com
 * máscara, para ler — a comparação e o envio são normalizados (dígitos), então
 * a máscara nunca vira alteração. UF em maiúscula pelo mesmo motivo: o
 * seletor só tem "MG", e um "mg" antigo apareceria vazio.
 */
export function formularioDoCliente(cliente: ValoresDoCadastro): FormularioDoCadastro {
  const v = valoresDoCliente(cliente);
  const form = {} as FormularioDoCadastro;
  for (const campo of CAMPOS_EDITAVEIS_DO_CLIENTE) {
    const cru = v[campo] ?? '';
    form[campo] =
      campo === 'cnpj' && cru
        ? formatarDocumento(cru)
        : campo === 'cep' && cru
          ? formatarCep(cru)
          : campo === 'uf'
            ? cru.trim().toUpperCase()
            : cru;
  }
  return form;
}

/**
 * Depois de um 409 MUDOU_DE_NOVO: o formulário com o cadastro de AGORA onde
 * outra pessoa mexeu, e com o que esta pessoa digitou no resto.
 *
 * O campo que o outro mudou TEM de voltar ao valor novo — mesmo que esta
 * pessoa nem tenha encostado nele. Senão o formulário seguiria com o valor
 * velho, a tela o veria como "alterado" e o próximo salvar desfaria, calado, a
 * edição do outro. O que só esta pessoa mudou fica: perder a digitação de uma
 * observação longa por causa de um WhatsApp corrigido por outro seria castigo.
 */
export function formularioAposConflito(
  formulario: FormularioDoCadastro,
  antes: ValoresDoCadastro,
  agora: ValoresDoCadastro,
): { formulario: FormularioDoCadastro; mudaram: CampoEditavelDoCliente[] } {
  const valoresAntes = valoresDoCliente(antes);
  const valoresAgora = valoresDoCliente(agora);
  const deAgora = formularioDoCliente(agora);
  const novo = { ...formulario };
  const mudaram: CampoEditavelDoCliente[] = [];
  for (const campo of CAMPOS_EDITAVEIS_DO_CLIENTE) {
    if (mesmoValorDoCadastro(campo, valoresAntes[campo], valoresAgora[campo])) continue;
    novo[campo] = deAgora[campo];
    mudaram.push(campo);
  }
  return { formulario: novo, mudaram };
}

/**
 * Os campos da LISTA de clientes (cache do aparelho) que a edição pode mudar.
 * Sem regravá-los, a lista, a busca e o novo pedido mostrariam o nome e o
 * WhatsApp antigos até a próxima sincronização.
 */
export function camposDaListaDoCliente(
  c: Pick<CustomerDetail, 'name' | 'trade_name' | 'cnpj' | 'whatsapp'>,
): Pick<CustomerListItem, 'name' | 'trade_name' | 'cnpj' | 'whatsapp'> {
  return { name: c.name, trade_name: c.trade_name, cnpj: c.cnpj, whatsapp: c.whatsapp };
}

/**
 * O que a frase de depois de salvar lê da resposta — a do 200 ou o corpo do
 * 500 SALVO_SEM_RELER_A_FICHA, que traz os mesmos campos sem a ficha.
 */
export interface ResultadoDoSalvar {
  sem_mudanca?: boolean | undefined;
  erp_pendente?: boolean | undefined;
  control_puxa_pela_api?: boolean | undefined;
  avisados?: AvisadosDaAlteracao | null | undefined;
}

/**
 * O toast depois de salvar: o que aconteceu com o Control.
 *
 * `papel` é o de quem salvou. O aviso nunca vai para quem editou — então o
 * financeiro que edita não entra na conta do financeiro, e o zero não quer
 * dizer "ninguém do financeiro está com aviso ligado" (revisão de 17/09/2026:
 * o único financeiro da empresa lia isso de si mesmo, com o push ligado).
 */
export function avisoDoCadastroSalvo(
  r: ResultadoDoSalvar | EditarCadastroDoClienteResponse,
  papel?: AuthRole | null,
): string {
  if (r.sem_mudanca === true) return 'Nada mudou — o cadastro já estava assim.';
  if (!r.erp_pendente) return 'Cadastro salvo. Cliente ainda não está no Control.';
  if (r.control_puxa_pela_api) return 'Cadastro salvo. O Control recebe a mudança pela integração.';
  // Só "o financeiro foi avisado" quando um aparelho do FINANCEIRO recebeu
  // (revisão de 17/09/2026). A API conta financeiro e admin separados de
  // propósito: somar os dois dizia ao representante que o financeiro sabia
  // quando só o admin tinha recebido — e ele deixava de avisar por outro
  // caminho. Mesma regra do "Atualizar no ERP" do pedido.
  if (r.avisados && r.avisados.financeiro > 0) {
    return 'Cadastro salvo. O financeiro foi avisado para atualizar no Control.';
  }
  if (r.avisados && r.avisados.admin > 0 && papel !== 'financeiro') {
    return 'Cadastro salvo. O aviso chegou só ao administrador — ninguém do financeiro está com aviso ligado. A mudança ficou na lista para atualizar no Control.';
  }
  // Sem aparelho com aviso ligado (ou o envio passou do tempo): a mudança está
  // registrada e aparece na Minha Área de quem atualiza o Control.
  return 'Cadastro salvo. A mudança ficou na lista para atualizar no Control.';
}

/**
 * A mensagem de um erro ao salvar. As da API já vêm em português e dizem o que
 * fazer; o que não vem da API é rede — `fetch` recusa com TypeError ("Failed to
 * fetch", "Load failed" no iPhone), que ninguém entende.
 */
export function mensagemDoErroDaEdicao(err: unknown): string {
  return mensagemDeErro(err, 'Não foi possível salvar o cadastro. Tente de novo.');
}

/**
 * A mensagem de um erro no "Já atualizei no Control" (17/09/2026). A mesma
 * tradução do salvar: sem ela, o financeiro no 4G fraco lia "Load failed" em
 * vermelho no cartão. Não diz "nada foi marcado": a resposta pode ter se
 * perdido depois de marcar — tocar de novo mostra "já estava em dia".
 */
export function mensagemDoErroDaConfirmacao(err: unknown): string {
  return mensagemDeErro(err, 'Não foi possível marcar como atualizado. Tente de novo.');
}

/**
 * O erro do "Já atualizei no Control" deixa em dúvida se a baixa ficou?
 * (revisão de 17/09/2026)
 *
 *   • 503 CONFIRMACAO_NAO_CONFIRMADA — o banco não confirmou nem desmentiu;
 *   • falha de rede (TypeError, sem código) — a resposta pode ter se perdido
 *     DEPOIS de a API marcar.
 *
 * Nos dois a ficha relê: sem isso o cartão seguia pedindo o que já tinha baixa,
 * até a pessoa tocar de novo e ouvir "já estava em dia".
 */
export function confirmacaoTalvezGravada(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as Error & { code?: string }).code;
  if (code === 'CONFIRMACAO_NAO_CONFIRMADA') return true;
  return !code && err instanceof TypeError;
}

/**
 * A frase do cartão quando a confirmação parou no meio ou ficou em dúvida
 * (revisão de 17/09/2026). `jaMarcadas` = o que os lotes anteriores (a rota
 * aceita 50 ids por vez) já confirmaram; `fichaRelida` = a ficha foi relida
 * depois do erro. `null` = nada a dizer além do próprio erro.
 *
 * Com lote já marcado, a frase do erro ("Nada foi marcado") seria falsa para a
 * baixa como um todo — ela vale só para o lote que falhou.
 */
export function avisoDaConfirmacaoInterrompida(jaMarcadas: number, fichaRelida: boolean): string | null {
  const marcadas = `${jaMarcadas} ${jaMarcadas === 1 ? 'alteração marcada' : 'alterações marcadas'} no Control antes do erro`;
  if (fichaRelida) {
    return jaMarcadas > 0
      ? `${marcadas}. A ficha foi relida: o cartão mostra o que ainda falta.`
      : 'Não deu para confirmar se marcou, então a ficha foi relida: o cartão mostra o que ainda falta.';
  }
  return jaMarcadas > 0 ? `${marcadas}; o resto não deu para confirmar — confira o cartão e toque de novo.` : null;
}

function mensagemDeErro(err: unknown, padrao: string): string {
  if (!(err instanceof Error)) return padrao;
  const code = (err as Error & { code?: string }).code;
  if (!code && err instanceof TypeError) {
    return 'Não deu para falar com o servidor. Confira a internet e tente de novo.';
  }
  return err.message || padrao;
}

/**
 * O erro diz que a edição FICOU gravada? (revisão de 17/09/2026)
 *
 *   • 500 SALVO_SEM_RELER_A_FICHA — gravou e registrou; só a releitura da
 *     ficha falhou lá. O corpo traz o que a frase de "salvo" precisa;
 *   • 500 ALTERACAO_SEM_HISTORICO — o cliente ficou alterado (o registro para
 *     o Control falhou e não deu para desfazer).
 *
 * Tratados como falha comum, o diálogo ficava aberto com "Salvar" ligado sobre
 * a ficha velha — e salvar de novo levava um 409 "o cadastro mudou enquanto
 * você editava" pela própria edição. `null` = não gravou (ou não se sabe): a
 * tela segue como erro.
 */
export function edicaoGravadaApesarDoErro(
  err: unknown,
  papel?: AuthRole | null,
): { mensagem: string; tipo: 'success' | 'error' } | null {
  if (!(err instanceof Error)) return null;
  const code = (err as Error & { code?: string }).code;
  if (code === 'SALVO_SEM_RELER_A_FICHA') {
    return { mensagem: avisoDoCadastroSalvo((corpoDoErro(err) ?? {}) as ResultadoDoSalvar, papel), tipo: 'success' };
  }
  if (code === 'ALTERACAO_SEM_HISTORICO') return { mensagem: mensagemDoErroDaEdicao(err), tipo: 'error' };
  return null;
}

/**
 * O aviso quando a edição ficou gravada apesar do erro e a releitura da ficha
 * TAMBÉM falhou (revisão de 17/09/2026).
 *
 * A ficha tem um toast só: a frase da releitura trocava a do salvar. No 500
 * ALTERACAO_SEM_HISTORICO — banco instável, justamente quando a releitura
 * também cai — "o registro para o Control falhou… avise o suporte" durava o
 * tempo do GET que falhou e sobrava "O cadastro foi salvo", sem nada sobre o
 * Control: o representante saía achando que estava tudo certo, e o cadastro
 * ficava diferente do Control sem ninguém avisar o suporte. Por isso a frase
 * do salvar vem inteira, e a da releitura vai atrás dela.
 */
export function avisoSemReleituraDaFicha(aviso: { mensagem: string; tipo: 'success' | 'error' }): {
  mensagem: string;
  tipo: 'error';
} {
  const frase = aviso.mensagem.trim();
  const comPonto = frase === '' || /[.!?]$/.test(frase) ? frase : `${frase}.`;
  const releitura = 'Não deu para recarregar a ficha: feche e abra a ficha de novo para ver os dados.';
  return { mensagem: comPonto ? `${comPonto} ${releitura}` : releitura, tipo: 'error' };
}

/**
 * O erro deixa em dúvida se a edição ficou? (revisão de 17/09/2026)
 *
 *   • 503 GRAVACAO_NAO_CONFIRMADA — o banco não confirmou nem desmentiu;
 *   • falha de rede (`fetch` recusa com TypeError, sem código) — a resposta
 *     pode ter se perdido DEPOIS de a API gravar.
 *
 * Nos dois, a tela relê a ficha antes de a pessoa tentar de novo. Sem isso o
 * formulário e a ficha atrás dele ficavam com o cadastro de antes: salvar de
 * novo (ou fechar e reabrir o diálogo) levava um 409 "o cadastro mudou enquanto
 * você editava" pela própria edição.
 */
export function edicaoTalvezGravada(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as Error & { code?: string }).code;
  if (code === 'GRAVACAO_NAO_CONFIRMADA') return true;
  return !code && err instanceof TypeError;
}

/**
 * A frase do 503 GRAVACAO_NAO_CONFIRMADA em que a releitura mostrou a edição
 * APLICADA (revisão de 17/09/2026).
 *
 * Nesse caminho a API nunca chega a inserir em `customer_changes`: o cadastro
 * ficou alterado e a mudança NÃO entrou na fila do Control — sem cartão "Para
 * atualizar no Control", sem push ao financeiro, sem item na Minha área. É o
 * mesmo estado que o 500 ALTERACAO_SEM_HISTORICO manda avisar o suporte, e
 * dizer só "os campos já estão com o que está no cadastro agora" (a frase da
 * releitura) deixava a pessoa fechar o diálogo achando que deu certo.
 */
export const AVISO_DA_EDICAO_SEM_REGISTRO_PARA_O_CONTROL =
  'O cadastro foi alterado, mas o registro para o Control falhou: a mudança NÃO entrou na lista para atualizar no Control — avise o suporte.';

/**
 * Depois de reler a ficha num erro que deixou a gravação em dúvida: a edição
 * ficou gravada SEM o registro que leva a mudança ao Control?
 *
 * Só no 503 GRAVACAO_NAO_CONFIRMADA — a falha de rede pura pode ter gravado com
 * o histórico, e aí o cartão aparece sozinho. Decide CAMPO A CAMPO, com o que a
 * tela já tem em mãos: basta um campo enviado que a ficha relida mostre com o
 * valor mandado e que nenhuma alteração pendente leve a esse valor (o `depois`
 * dela). Sem nenhum assim, é a frase de sempre.
 *
 * Campo a campo, e pelo `depois` (revisão de 17/09/2026). Os dois caminhos do
 * 503 NUNCA gravam linha em `customer_changes` para esta edição — então:
 *   • uma pendência ANTIGA do mesmo campo, com outro `depois` (A→B esperando o
 *     financeiro, e agora B→C), não é o registro desta: contada só pela chave,
 *     ela escondia que o C ficou sem registro — o cartão seguia mandando pôr B
 *     no Control, e ninguém avisava o suporte;
 *   • o UPDATE é um compare-and-set de todas as colunas juntas, então UM campo
 *     com o valor mandado prova que a edição gravou. Exigir todos deixava sem
 *     aviso o WhatsApp novo quando outra mão trocava o e-mail antes da releitura.
 */
export function edicaoSemRegistroParaOControl(
  err: unknown,
  novo: ValoresDoCadastro,
  agora: Pick<CustomerDetail, 'alteracoes'> & ValoresDoCadastro,
): boolean {
  if (!(err instanceof Error) || (err as Error & { code?: string }).code !== 'GRAVACAO_NAO_CONFIRMADA') return false;
  const valores = valoresDoCliente(agora);
  const pendentes = (agora.alteracoes ?? []).filter(alteracaoPendente);
  return camposQueVieram(novo).some((c) => {
    if (!mesmoValorDoCadastro(c, valores[c], novo[c])) return false;
    const registrada = pendentes.some((a) => {
      const m = a.campos[c];
      return m !== undefined && mesmoValorDoCadastro(c, m.depois, novo[c]);
    });
    return !registrada;
  });
}

/**
 * Os campos que o servidor recusou (400) e que a tela NEM MANDOU (revisão de
 * 17/09/2026).
 *
 * A régua local roda antes de mandar, com o mesmo cadastro; um campo recusado
 * que não está em `novo` só acontece quando o cadastro mudou POR FORA desde que
 * o diálogo abriu — o lote do Control que apagou o bairro, por exemplo. O
 * endereço é validado como grupo, então o erro cai numa peça que a pessoa nem
 * tocou: ela lia "Bairro é obrigatório" embaixo de um bairro preenchido e
 * digitar o mesmo valor de novo não saía do lugar (igual ao `base`, não entra
 * em `novo`). A saída é reler a ficha, como no 409.
 */
export function camposRecusadosQueNaoForamMandados(
  erros: ErrosDaEdicaoDoCadastro,
  novo: ValoresDoCadastro,
): CampoEditavelDoCliente[] {
  const mandados = new Set(camposQueVieram(novo));
  return CAMPOS_EDITAVEIS_DO_CLIENTE.filter((c) => erros[c] && !mandados.has(c));
}

/** A frase depois de reler a ficha por causa de um campo recusado que a tela não mandou. */
export function avisoDoCadastroMudadoPorFora(mudaram: readonly CampoEditavelDoCliente[]): string {
  const rotulos = rotulosDosCamposAlterados(mudaram);
  return rotulos.length > 0
    ? `O cadastro mudou por fora e ficou incompleto (${rotulos.join(', ')}). Os campos marcados já estão com o que está no cadastro agora — preencha o que falta e salve de novo.`
    : 'O cadastro mudou por fora e ficou incompleto. Confira os campos abaixo, preencha o que falta e salve de novo.';
}

/** A frase depois de reler a ficha num erro que deixou a gravação em dúvida. */
export function avisoDaReleituraDepoisDoErro(mudaram: readonly CampoEditavelDoCliente[]): string {
  const rotulos = rotulosDosCamposAlterados(mudaram);
  return rotulos.length > 0
    ? `Não deu para confirmar se salvou, então a ficha foi relida. Os campos marcados (${rotulos.join(', ')}) já estão com o que está no cadastro agora — confira antes de salvar de novo.`
    : 'Não deu para confirmar se salvou, então a ficha foi relida: o cadastro continua como estava. Confira e salve de novo.';
}

/**
 * A frase do rodapé quando o servidor recusou campos (revisão de 17/09/2026).
 * A frase de cada campo fica embaixo dele — lá em cima, fora da vista de quem
 * tocou em Salvar no rodapé. Sem isto, para essa pessoa, "nada aconteceu".
 */
export function fraseDoRodapeComErroNoCampo(campos: readonly CampoEditavelDoCliente[]): string {
  const rotulos = campos.map((c) => ROTULO_DO_CAMPO_DO_CADASTRO[c]);
  if (rotulos.length === 0) return 'Não salvou: confira os campos marcados.';
  return rotulos.length === 1
    ? `Não salvou: confira o campo ${rotulos[0]!}.`
    : `Não salvou: confira os campos ${rotulos.join(', ')}.`;
}

/** O corpo JSON da resposta de erro, quando a API mandou (ver `ErroDaApi`). */
function corpoDoErro(err: unknown): Record<string, unknown> | null {
  if (!(err instanceof Error)) return null;
  const corpo = (err as ErroDaApi).corpo;
  return typeof corpo === 'object' && corpo !== null && !Array.isArray(corpo) ? corpo : null;
}

/**
 * A ficha de AGORA que o 409 MUDOU_DE_NOVO traz em `data`. `null` quando não
 * veio (a releitura falhou lá, ou é de outro cliente): a tela relê pelo
 * GET /customers/:id — mais uma ida, mas nunca um formulário com dado velho.
 */
export function fichaDoConflito(err: unknown, idDoCliente: string): CustomerDetail | null {
  const data = corpoDoErro(err)?.['data'];
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  return (data as { id?: unknown }).id === idDoCliente ? (data as CustomerDetail) : null;
}

/**
 * Os erros por campo do 400 VALIDATION_ERROR da edição (`campos`: campo →
 * frase). A régua local é a mesma e pega quase tudo antes; isto cobre o que só
 * o servidor enxerga (o endereço resultante com o cadastro de agora, por
 * exemplo). Chave que não é campo editável, ou sem texto, fica de fora — o
 * 400 do schema não traz `campos` e cai na mensagem geral.
 */
export function errosDoServidorNaEdicao(err: unknown): ErrosDaEdicaoDoCadastro {
  const erros: ErrosDaEdicaoDoCadastro = {};
  const campos = corpoDoErro(err)?.['campos'];
  if (typeof campos !== 'object' || campos === null || Array.isArray(campos)) return erros;
  for (const campo of CAMPOS_EDITAVEIS_DO_CLIENTE) {
    const frase = (campos as Record<string, unknown>)[campo];
    if (typeof frase === 'string' && frase.trim() !== '') erros[campo] = frase;
  }
  return erros;
}

// ─── O cartão "Para atualizar no Control" ─────────────────────────────────────

/** Esperando alguém atualizar no Control: o cliente já estava lá e ninguém deu baixa. */
export function alteracaoPendente(a: Pick<AlteracaoDoCliente, 'erp_pendente' | 'erp_atualizado_em'>): boolean {
  return a.erp_pendente && a.erp_atualizado_em === null;
}

/** As pendentes (o cartão) e as demais (o histórico), na ordem em que vieram — das mais novas para as mais antigas. */
export function separarAlteracoes(alteracoes: readonly AlteracaoDoCliente[]): {
  pendentes: AlteracaoDoCliente[];
  resolvidas: AlteracaoDoCliente[];
} {
  const pendentes: AlteracaoDoCliente[] = [];
  const resolvidas: AlteracaoDoCliente[] = [];
  for (const a of alteracoes) (alteracaoPendente(a) ? pendentes : resolvidas).push(a);
  return { pendentes, resolvidas };
}

export interface LinhaDaAlteracao {
  campo: CampoDoHistoricoDoCadastro;
  rotulo: string;
  antes: string;
  depois: string;
  /**
   * Uma edição MAIS NOVA do mesmo campo trocou o valor depois desta: o `depois`
   * daqui já não é o do app (revisão de 17/09/2026). `depois` é o valor que
   * vale agora, formatado; `em`, quando a mais nova foi feita.
   */
  superada?: { depois: string; em: string };
}

const ORDEM_DO_HISTORICO: readonly CampoDoHistoricoDoCadastro[] = [...CAMPOS_EDITAVEIS_DO_CLIENTE, 'address'];

/** A ordem da API: pela hora da edição, e o id desempata. Positivo = `a` é mais nova. */
const maisNova = (a: Pick<AlteracaoDoCliente, 'alterado_em' | 'id'>, b: Pick<AlteracaoDoCliente, 'alterado_em' | 'id'>) =>
  a.alterado_em.localeCompare(b.alterado_em) || a.id.localeCompare(b.id);

/**
 * As pendentes na ordem de DIGITAR no Control: da mais antiga para a mais nova
 * (revisão de 17/09/2026). A ficha recebe as alterações das mais novas para as
 * mais antigas (é o histórico); no cartão, quem digitava de cima para baixo
 * punha por último o valor mais VELHO de um campo mexido duas vezes — o app com
 * C e o Control com B, e a baixa das duas sem aviso nenhum.
 */
export function pendentesNaOrdemDeDigitar(alteracoes: readonly AlteracaoDoCliente[]): AlteracaoDoCliente[] {
  return separarAlteracoes(alteracoes).pendentes.sort(maisNova);
}

/**
 * "Rótulo: antes → depois", um por campo, na ordem do formulário.
 *
 * A linha única `address` sai quando alguma peça do endereço mudou: ela é
 * recalculada das peças, e o Control tem as peças em campos separados — quem
 * digita lá precisa de "Número: 12 → 120", não da frase inteira repetida.
 *
 * A exceção (revisão de 17/09/2026) é a linha que a API marcou como FORA DAS
 * PEÇAS: antes da edição ela já dizia outra coisa (um endereço em texto que o
 * Control mandou, por exemplo). Aí a troca da linha não é explicada pelas
 * peças — mexer só no complemento trocava rua, número e bairro da linha — e
 * escondê-la deixava o financeiro dar baixa numa mudança que nunca viu.
 *
 * Com `todas` (as alterações da ficha), cada linha que uma edição MAIS NOVA do
 * mesmo campo trocou depois — pendente ou já resolvida — sai marcada como
 * `superada`, com o valor que vale agora (revisão de 17/09/2026). O cartão é
 * "a lista do que digitar": a edição A→B de WhatsApp e e-mail, com o WhatsApp já
 * trocado para C por outra (resolvida pelo Control), mandava digitar B — e a
 * baixa dela soltava a coluna para o próximo envio do Control gravar o B por
 * cima do C do app, sem aviso nenhum.
 */
export function linhasDaAlteracao(
  a: Pick<AlteracaoDoCliente, 'campos'> & Partial<Pick<AlteracaoDoCliente, 'id' | 'alterado_em'>>,
  todas: readonly AlteracaoDoCliente[] = [],
): LinhaDaAlteracao[] {
  const chaves = Object.keys(a.campos);
  const mudouPeca = chaves.some((c) => ehPecaDoEndereco(c));
  const estas = a.id !== undefined && a.alterado_em !== undefined ? { id: a.id, alterado_em: a.alterado_em } : null;
  const linhas: LinhaDaAlteracao[] = [];
  for (const campo of ORDEM_DO_HISTORICO) {
    const m = a.campos[campo];
    if (!m) continue;
    if (campo === 'address' && mudouPeca && m.linha_fora_das_pecas !== true) continue;
    const linha: LinhaDaAlteracao = {
      campo,
      rotulo: ROTULO_DO_CAMPO_DO_CADASTRO[campo],
      antes: formatarValorDoCadastro(campo, m.antes),
      depois: formatarValorDoCadastro(campo, m.depois),
    };
    if (estas) {
      // A mais nova de todas as que mexeram neste campo depois desta.
      const ultima = todas
        .filter((o) => o.id !== estas.id && o.campos[campo] !== undefined && maisNova(o, estas) > 0)
        .sort(maisNova)
        .pop();
      const agora = ultima?.campos[campo];
      if (ultima && agora && !mesmoValorDoCadastro(campo, agora.depois, m.depois)) {
        linha.superada = { depois: formatarValorDoCadastro(campo, agora.depois), em: ultima.alterado_em };
      }
    }
    linhas.push(linha);
  }
  return linhas;
}

const dataCurta = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** A nota da linha que uma edição mais nova já trocou: o que vale no Control. */
export function notaDaLinhaSuperada(
  l: Pick<LinhaDaAlteracao, 'depois' | 'superada'>,
  formatar: (iso: string) => string = dataCurta,
): string | null {
  if (!l.superada) return null;
  return `Mudou de novo em ${formatar(l.superada.em)}: no Control vale ${l.superada.depois}, não ${l.depois}.`;
}

/** Quem editou e quando. O nome é a foto gravada na hora — o login pode ter sido apagado depois. */
export function autoriaDaAlteracao(
  a: Pick<AlteracaoDoCliente, 'alterado_por_nome' | 'alterado_em'>,
  formatar: (iso: string) => string = dataCurta,
): string {
  return `${a.alterado_por_nome?.trim() || 'Alguém'} · ${formatar(a.alterado_em)}`;
}

/** Como a alteração terminou, para o histórico. */
export function situacaoDaAlteracao(
  a: Pick<
    AlteracaoDoCliente,
    'erp_pendente' | 'erp_atualizado_em' | 'erp_atualizado_por_nome' | 'erp_atualizado_via'
  >,
  formatar: (iso: string) => string = dataCurta,
): string {
  if (alteracaoPendente(a)) return 'Esperando atualizar no Control';
  if (!a.erp_pendente) return 'Feita quando o cliente ainda não estava no Control';
  const quando = a.erp_atualizado_em ? formatar(a.erp_atualizado_em) : '';
  if (a.erp_atualizado_via === 'api') return `Atualizado pelo Control automaticamente em ${quando}`;
  const quem = a.erp_atualizado_por_nome?.trim();
  if (a.erp_atualizado_via === 'app' && quem) return `Atualizado no Control por ${quem} em ${quando}`;
  return `Atualizado no Control em ${quando}`;
}

/** O limite do corpo de POST /customers/:id/alteracoes/confirmar. */
export const IDS_POR_CONFIRMACAO = 50;

/** Os ids em pedaços que a rota aceita (1 a 50 por vez). */
export function emLotesDeConfirmacao(ids: readonly string[]): string[][] {
  const lotes: string[][] = [];
  for (let i = 0; i < ids.length; i += IDS_POR_CONFIRMACAO) lotes.push(ids.slice(i, i + IDS_POR_CONFIRMACAO));
  return lotes;
}

/**
 * O toast depois de "Já atualizei no Control". Diz quando parte já estava em
 * dia (outra pessoa confirmou, ou o Control devolveu pela API) e quando chegou
 * edição NOVA enquanto a pessoa digitava lá — essa continua no cartão, porque
 * só se dá baixa no que foi visto.
 */
export function avisoDaConfirmacao(
  pedidas: number,
  confirmadas: number,
  alteracoes: readonly AlteracaoDoCliente[] | null,
): string {
  const restantes = alteracoes ? alteracoes.filter(alteracaoPendente).length : 0;
  const base =
    confirmadas === 0
      ? 'Nada a marcar — já estava em dia no Control.'
      : confirmadas < pedidas
        ? `${confirmadas} de ${pedidas} marcadas — as outras já estavam em dia.`
        : 'Marcado como atualizado no Control.';
  return restantes > 0 ? `${base} Chegou alteração nova: confira o cartão.` : base;
}

/**
 * As alterações da ficha com as que a API confirmou marcadas como atualizadas
 * no Control por quem confirmou (revisão de 17/09/2026). É o que a tela usa
 * quando a baixa gravou, mas nem a API nem a tela conseguiram reler: a ficha
 * fica de pé (sem virar a tela de erro, que escondia que a baixa tinha ficado),
 * e o cartão já não pede o que foi feito.
 */
export function marcarConfirmadasNaFicha(
  alteracoes: readonly AlteracaoDoCliente[],
  confirmadas: readonly string[],
  quem: { id: string | null; nome: string | null },
  em: string,
): AlteracaoDoCliente[] {
  const marcadas = new Set(confirmadas);
  return alteracoes.map((a) =>
    marcadas.has(a.id) && alteracaoPendente(a)
      ? {
          ...a,
          erp_atualizado_em: em,
          erp_atualizado_por: quem.id,
          erp_atualizado_por_nome: quem.nome,
          erp_atualizado_via: 'app',
        }
      : a,
  );
}
