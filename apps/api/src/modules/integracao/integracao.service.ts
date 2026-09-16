import { supabase } from '../../config/supabase.js';
import { detectar, detectarOuFalhar } from '../../lib/detectarColuna.js';
import { lerCanais, type Canais } from '../../lib/canais.js';

/**
 * A TELA DA INTEGRAÇÃO COM O CONTROL (decisão 7 de 16/09/2026).
 *
 * O Control PUXA tudo pela API de parceiro, sozinho, a cada poucos minutos. O
 * financeiro não vê nada disso acontecer — e quando o número de um pedido
 * demora, a pergunta é sempre a mesma: "o Control está falando com o app?".
 * Esta é a resposta, em uma tela: quais canais estão ligados, quando foi a
 * última passada do Control em cada rota (e o que ela gravou), quantos pedidos
 * estão em cada etapa da fila, e se alguém já pediu uma sincronização agora.
 *
 * Três regras:
 *   1. Só leitura, exceto o pedido de sincronização — que é UM carimbo em
 *      `companies` (migração 049), idempotente: pedir de novo com um pedido
 *      pendente não grava nada.
 *   2. Cada bloco da tela lê por conta própria: um soluço do banco numa parte
 *      (o registro de chamadas, por exemplo) vira `null` + aviso naquela parte,
 *      e o resto da tela sai. A tela existe para diagnosticar; um 500 inteiro
 *      esconderia justamente o que ela mostra.
 *   3. Nunca o `detalhe` de `erp_sync_log`, nunca linha de pedido: só rota,
 *      momento, status HTTP e contagens.
 *
 * Todas as colunas da 048/049 passam por detectar(): a API sobe antes do SQL.
 */

export interface RotaDoParceiro {
  metodo: 'GET' | 'POST';
  /** O PADRÃO da rota, como fica em `erp_sync_log.rota` (partner.chamada.ts). */
  rota: string;
  /** O nome que a tela mostra, em português. */
  titulo: string;
}

/**
 * As rotas que a tela SEMPRE lista, mesmo nunca chamadas — para "nunca chamada"
 * aparecer escrito, em vez de a rota simplesmente não existir na tela.
 * Rotas fora desta lista que apareçam no registro entram no fim (ver
 * `ultimasChamadas`), então acrescentar aqui é só para dar o título.
 */
export const ROTAS_DO_PARCEIRO: readonly RotaDoParceiro[] = [
  { metodo: 'GET', rota: '/partner/v1/status', titulo: 'Teste de conexão' },
  { metodo: 'GET', rota: '/partner/v1/pedidos', titulo: 'Fila de pedidos' },
  { metodo: 'POST', rota: '/partner/v1/pedidos/:id/confirmar', titulo: 'Número do Control (confirmação)' },
  { metodo: 'POST', rota: '/partner/v1/pedidos/:id/conciliar', titulo: 'Conciliação do passivo' },
  { metodo: 'GET', rota: '/partner/v1/conciliacao', titulo: 'Contagens da conciliação' },
  { metodo: 'GET', rota: '/partner/v1/pedidos/excluidos', titulo: 'Pedidos excluídos no app' },
  { metodo: 'POST', rota: '/partner/v1/pedidos/:id/excluir', titulo: 'Exclusão pelo Control' },
  { metodo: 'POST', rota: '/partner/v1/faturamento', titulo: 'Faturamento' },
  { metodo: 'POST', rota: '/partner/v1/clientes', titulo: 'Clientes (o Control manda)' },
  { metodo: 'GET', rota: '/partner/v1/clientes', titulo: 'Clientes alterados no app (o Control puxa)' },
  { metodo: 'POST', rota: '/partner/v1/representantes', titulo: 'Representantes (o Control manda)' },
  { metodo: 'GET', rota: '/partner/v1/representantes', titulo: 'Representantes alterados no app (o Control puxa)' },
  { metodo: 'POST', rota: '/partner/v1/tabelas-preco', titulo: 'Tabelas de preço' },
  { metodo: 'POST', rota: '/partner/v1/condicoes-pagamento', titulo: 'Condições de pagamento' },
  { metodo: 'POST', rota: '/partner/v1/produtos', titulo: 'Produtos e tamanhos' },
  { metodo: 'POST', rota: '/partner/v1/precos', titulo: 'Preços por tabela' },
  { metodo: 'POST', rota: '/partner/v1/estoque', titulo: 'Estoque' },
  { metodo: 'POST', rota: '/partner/v1/retrato', titulo: 'Retrato do cliente' },
  { metodo: 'POST', rota: '/partner/v1/sincronizacao', titulo: 'Sincronização concluída' },
];

export interface UltimaChamada extends RotaDoParceiro {
  /** Quando a última chamada chegou (ISO com fuso). `null` = nunca chamada. */
  quando: string | null;
  http_status: number | null;
  recebidos: number | null;
  gravados: number | null;
  ignorados: number | null;
  sem_mudanca: number | null;
}

export interface ContagensDaFila {
  /**
   * Aprovado, sem número do Control, não faturado e AINDA SEM o clique do
   * financeiro em "Lançar no ERP". `null` sem a 049 (a coluna não existe).
   */
  aguardando_clique: number | null;
  /**
   * Aprovado, sem número, não faturado e já solicitado ao Control — é a fila
   * que o `GET /partner/v1/pedidos` entrega. Sem a 049, é a fila de hoje
   * (todo aprovado sem número e não faturado).
   */
  solicitados_sem_numero: number;
  /** Enviado ao ERP sem número (o passivo do `/conciliar`), não faturado. */
  enviados_sem_numero: number;
  /** Com número do Control, esperando o faturamento chegar. */
  sem_faturamento: number;
}

export interface SolicitacaoDeSync {
  solicitado_em: string;
  solicitado_por: string | null;
  /** Nome de quem pediu, quando o login ainda existe. */
  solicitado_por_nome: string | null;
}

export interface EstadoDaIntegracao {
  servidor_hora: string;
  /** `null` = o banco não respondeu sobre os canais agora (ver `avisos`). */
  canais: Canais | null;
  /** `true` enquanto há um pedido de sincronização que o Control ainda não concluiu. */
  sincronizar_agora: boolean;
  solicitacao: SolicitacaoDeSync | null;
  /** Uma linha por rota. `null` = não deu para ler o registro agora. */
  chamadas: UltimaChamada[] | null;
  /** `null` = não deu para contar agora. */
  fila: ContagensDaFila | null;
  migracoes: {
    /** 048: `companies.canal_*`. */
    canais: boolean;
    /** 048: `erp_sync_log.rota` (o registro de cada chamada do parceiro). */
    registro: boolean;
    /** 049: `companies.sync_solicitado_em` (o botão desta tela). */
    sincronizacao: boolean;
    /** 049: `orders.erp_requested_at` (o "Lançar no ERP" que solicita ao Control). */
    solicitacao_do_pedido: boolean;
  };
  /** O que não deu para ler agora, em português, para a tela mostrar. */
  avisos: string[];
}

function mensagem(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ─── Solicitação de sincronização (companies.sync_solicitado_em, 049) ─────────

interface LinhaDaSolicitacao {
  sync_solicitado_em: string | null;
  sync_solicitado_por: string | null;
}

async function lerLinhaDaSolicitacao(company_id: string): Promise<LinhaDaSolicitacao | null> {
  const { data, error } = await supabase
    .from('companies')
    .select('sync_solicitado_em, sync_solicitado_por')
    .eq('id', company_id)
    .maybeSingle();
  if (error) throw new Error(`Falha ao ler o pedido de sincronização: ${error.message}`);
  return (data as LinhaDaSolicitacao | null) ?? null;
}

/** O nome de quem pediu — só para a tela; sem resposta, fica `null`. */
async function nomeDoUsuario(company_id: string, user_id: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('users')
    .select('name')
    .eq('id', user_id)
    .eq('company_id', company_id)
    .maybeSingle();
  if (error) return null;
  const nome = (data as { name?: unknown } | null)?.name;
  return typeof nome === 'string' && nome.trim() ? nome : null;
}

/**
 * Há um pedido de sincronização pendente nesta empresa?
 *
 * `migracao: false` = a 049 ainda não rodou (não há onde guardar o pedido).
 * É a mesma pergunta que o `GET /partner/v1/status` faz para devolver
 * `sincronizar_agora` ao Control. Lança quando o banco não respondeu —
 * inclusive na sonda da coluna: um soluço de rede lido como "a 049 não rodou"
 * fazia o botão responder MIGRACAO_PENDENTE com a 049 já rodada (revisão de
 * 16/09/2026). Só a ausência de verdade vira `migracao: false`.
 */
export async function lerSolicitacaoDeSync(
  company_id: string,
): Promise<{ migracao: boolean; solicitacao: SolicitacaoDeSync | null }> {
  if (!(await detectarOuFalhar('companies', 'sync_solicitado_em'))) return { migracao: false, solicitacao: null };

  const linha = await lerLinhaDaSolicitacao(company_id);
  if (!linha?.sync_solicitado_em) return { migracao: true, solicitacao: null };

  const por = linha.sync_solicitado_por ?? null;
  return {
    migracao: true,
    solicitacao: {
      solicitado_em: linha.sync_solicitado_em,
      solicitado_por: por,
      solicitado_por_nome: por ? await nomeDoUsuario(company_id, por) : null,
    },
  };
}

export type ResultadoDoPedidoDeSync =
  | { ok: true; ja_solicitado: boolean; solicitacao: SolicitacaoDeSync }
  | { ok: false; motivo: 'sem_migracao' };

/**
 * O botão "Pedir sincronização agora".
 *
 * Grava `sync_solicitado_em = now()` e quem pediu. Com um pedido já pendente,
 * NÃO regrava: o Control lê `sincronizar_agora = true` do mesmo jeito, e o
 * momento que interessa é o do primeiro pedido — é dele que se mede a demora.
 * O filtro `sync_solicitado_em IS NULL` no UPDATE é o que segura dois cliques
 * ao mesmo tempo: só um grava, o outro lê o que ficou.
 */
export async function pedirSincronizacao(
  company_id: string,
  quem: { id: string; nome: string },
): Promise<ResultadoDoPedidoDeSync> {
  const atual = await lerSolicitacaoDeSync(company_id);
  if (!atual.migracao) return { ok: false, motivo: 'sem_migracao' };
  if (atual.solicitacao) return { ok: true, ja_solicitado: true, solicitacao: atual.solicitacao };

  const agora = new Date().toISOString();
  const { data, error } = await supabase
    .from('companies')
    .update({ sync_solicitado_em: agora, sync_solicitado_por: quem.id })
    .eq('id', company_id)
    .is('sync_solicitado_em', null)
    .select('sync_solicitado_em, sync_solicitado_por');
  if (error) throw new Error(`Falha ao registrar o pedido de sincronização: ${error.message}`);

  const gravada = (Array.isArray(data) ? data[0] : data) as LinhaDaSolicitacao | null | undefined;
  if (!gravada?.sync_solicitado_em) {
    // Alguém gravou entre a leitura e o UPDATE: vale o pedido que ficou.
    const depois = await lerSolicitacaoDeSync(company_id);
    if (depois.solicitacao) return { ok: true, ja_solicitado: true, solicitacao: depois.solicitacao };
    throw new Error('Falha ao registrar o pedido de sincronização: nenhuma linha gravada');
  }
  return {
    ok: true,
    ja_solicitado: false,
    solicitacao: {
      solicitado_em: gravada.sync_solicitado_em,
      solicitado_por: gravada.sync_solicitado_por ?? quem.id,
      solicitado_por_nome: quem.nome,
    },
  };
}

export interface ConclusaoDeSync {
  /** `false` = a 049 não rodou; não havia onde existir um pedido. */
  migracao: boolean;
  /** Se este aviso limpou um pedido pendente. */
  limpo: boolean;
  /** O pedido que continua pendente depois deste aviso, se algum. */
  pendente: string | null;
}

/**
 * `POST /partner/v1/sincronizacao { concluida: true }` — o Control avisa que
 * rodou tudo; o pedido pendente é limpo.
 *
 * Sem pedido pendente não grava nada (idempotente). Quando o Control informa
 * `solicitado_em` (o momento que ele viu no `/status`), um pedido MAIS NOVO que
 * esse fica de pé: alguém clicou de novo enquanto o Control rodava, e essa
 * passada não cobriu o que mudou depois. O `eq` no UPDATE segura a mesma
 * corrida quando o Control não informa o momento.
 */
export async function concluirSincronizacao(
  company_id: string,
  opts: { solicitado_em?: string | undefined } = {},
): Promise<ConclusaoDeSync> {
  // Soluço na sonda sobe (500) e o Control avisa de novo; lido como "sem a
  // 049", o aviso seria engolido e o pedido ficaria de pé sem motivo.
  if (!(await detectarOuFalhar('companies', 'sync_solicitado_em'))) {
    return { migracao: false, limpo: false, pendente: null };
  }

  const linha = await lerLinhaDaSolicitacao(company_id);
  const pendente = linha?.sync_solicitado_em ?? null;
  if (!pendente) return { migracao: true, limpo: false, pendente: null };

  if (opts.solicitado_em && Date.parse(pendente) > Date.parse(opts.solicitado_em)) {
    return { migracao: true, limpo: false, pendente };
  }

  const { data, error } = await supabase
    .from('companies')
    .update({ sync_solicitado_em: null, sync_solicitado_por: null })
    .eq('id', company_id)
    .eq('sync_solicitado_em', pendente)
    .select('id');
  if (error) throw new Error(`Falha ao concluir a sincronização: ${error.message}`);

  const afetadas = Array.isArray(data) ? data.length : data ? 1 : 0;
  if (afetadas === 0) {
    // Um pedido novo entrou no meio: ele fica.
    const depois = await lerLinhaDaSolicitacao(company_id);
    return { migracao: true, limpo: false, pendente: depois?.sync_solicitado_em ?? null };
  }
  return { migracao: true, limpo: true, pendente: null };
}

// ─── Última chamada por rota (erp_sync_log, 048) ─────────────────────────────

const COLUNAS_DA_CHAMADA = 'rota, metodo, started_at, http_status, recebidos, gravados, ignorados, sem_mudanca';

interface LinhaDoRegistro {
  rota: string | null;
  metodo: string | null;
  started_at: string | null;
  http_status: number | null;
  recebidos: number | null;
  gravados: number | null;
  ignorados: number | null;
  sem_mudanca: number | null;
}

/** Quantas linhas recentes olhar para achar rotas fora de `ROTAS_DO_PARCEIRO`. */
const JANELA_DE_ROTAS_NOVAS = 200;

function numeroOuNulo(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function chamadaDaLinha(rota: RotaDoParceiro, linha: LinhaDoRegistro | null): UltimaChamada {
  return {
    ...rota,
    quando: linha?.started_at ?? null,
    http_status: numeroOuNulo(linha?.http_status),
    recebidos: numeroOuNulo(linha?.recebidos),
    gravados: numeroOuNulo(linha?.gravados),
    ignorados: numeroOuNulo(linha?.ignorados),
    sem_mudanca: numeroOuNulo(linha?.sem_mudanca),
  };
}

async function ultimaLinhaDaRota(company_id: string, rota: RotaDoParceiro): Promise<LinhaDoRegistro | null> {
  const { data, error } = await supabase
    .from('erp_sync_log')
    .select(COLUNAS_DA_CHAMADA)
    .eq('company_id', company_id)
    .eq('sync_type', 'parceiro')
    .eq('rota', rota.rota)
    .eq('metodo', rota.metodo)
    .order('started_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(`Falha ao ler o registro de ${rota.metodo} ${rota.rota}: ${error.message}`);
  const linhas = (Array.isArray(data) ? data : data ? [data] : []) as LinhaDoRegistro[];
  return linhas[0] ?? null;
}

/**
 * Rotas que o registro conhece e esta lista não (uma rota nova que outra
 * parte do app registrou): a mais recente de cada, dentro da janela.
 */
async function rotasForaDaLista(company_id: string): Promise<UltimaChamada[]> {
  const { data, error } = await supabase
    .from('erp_sync_log')
    .select(COLUNAS_DA_CHAMADA)
    .eq('company_id', company_id)
    .eq('sync_type', 'parceiro')
    .order('started_at', { ascending: false })
    .limit(JANELA_DE_ROTAS_NOVAS);
  if (error) throw new Error(`Falha ao ler o registro das chamadas: ${error.message}`);

  const conhecidas = new Set(ROTAS_DO_PARCEIRO.map((r) => `${r.metodo} ${r.rota}`));
  const vistas = new Map<string, UltimaChamada>();
  for (const linha of (Array.isArray(data) ? data : []) as LinhaDoRegistro[]) {
    const metodo = String(linha.metodo ?? '').toUpperCase();
    const rota = String(linha.rota ?? '');
    if (!rota || (metodo !== 'GET' && metodo !== 'POST')) continue;
    const chave = `${metodo} ${rota}`;
    if (conhecidas.has(chave) || vistas.has(chave)) continue;
    vistas.set(chave, chamadaDaLinha({ metodo, rota, titulo: rota }, linha));
  }
  return [...vistas.values()];
}

/**
 * A última chamada de cada rota do parceiro nesta empresa. Uma consulta por
 * rota (o índice da 048 é exatamente company_id + rota + started_at): a rota
 * chamada uma vez por dia não pode sumir atrás da fila que roda a cada minuto.
 * Sem a 048, lista vazia. Erro em qualquer leitura sobe.
 */
export async function ultimasChamadas(
  company_id: string,
): Promise<{ migracao: boolean; chamadas: UltimaChamada[] }> {
  if (!(await detectar('erp_sync_log', 'rota'))) return { migracao: false, chamadas: [] };

  const [daLista, novas] = await Promise.all([
    Promise.all(ROTAS_DO_PARCEIRO.map(async (rota) => chamadaDaLinha(rota, await ultimaLinhaDaRota(company_id, rota)))),
    rotasForaDaLista(company_id),
  ]);
  return { migracao: true, chamadas: [...daLista, ...novas] };
}

// ─── A fila, em contagens (orders) ───────────────────────────────────────────

interface Grandeza {
  status: 'approved' | 'sent_erp';
  comNumero: boolean;
  /** `undefined` = não filtra por `erp_requested_at`. */
  solicitado?: boolean;
}

async function contarPedidos(company_id: string, g: Grandeza, colunas: { invoiced: boolean; solicitado: boolean }): Promise<number> {
  // `count: 'exact'` com `head: true`: só a contagem, nenhuma linha viaja.
  let query = supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', company_id)
    .eq('status', g.status);
  query = g.comNumero ? query.not('erp_order_id', 'is', null) : query.is('erp_order_id', null);
  // Sem a coluna (banco antes da 027) nenhum pedido está faturado.
  if (colunas.invoiced) query = query.or('invoiced.is.null,invoiced.eq.false');
  if (g.solicitado !== undefined && colunas.solicitado) {
    query = g.solicitado ? query.not('erp_requested_at', 'is', null) : query.is('erp_requested_at', null);
  }

  const { count, error } = await query;
  if (error) throw new Error(`Falha ao contar a fila do Control: ${error.message}`);
  if (typeof count !== 'number') throw new Error('Falha ao contar a fila do Control: o banco não devolveu a contagem');
  return count;
}

/**
 * As contagens da fila desta empresa. Só números, nenhuma linha.
 *
 * `invoiced` usa `detectarOuFalhar`, como a fila do parceiro: uma sonda que
 * falha por rede não pode virar "nada está faturado" e inflar a fila em
 * silêncio. `erp_requested_at` (049) degrada: sem ela, a fila de hoje.
 */
export async function contarFila(company_id: string): Promise<{ fila: ContagensDaFila; migracao: boolean }> {
  const colunas = {
    invoiced: await detectarOuFalhar('orders', 'invoiced'),
    solicitado: await detectar('orders', 'erp_requested_at'),
  };
  const [aguardando, solicitados, enviados, semFaturamento] = await Promise.all([
    colunas.solicitado
      ? contarPedidos(company_id, { status: 'approved', comNumero: false, solicitado: false }, colunas)
      : Promise.resolve(null),
    contarPedidos(company_id, { status: 'approved', comNumero: false, solicitado: true }, colunas),
    contarPedidos(company_id, { status: 'sent_erp', comNumero: false }, colunas),
    contarPedidos(company_id, { status: 'sent_erp', comNumero: true }, colunas),
  ]);
  return {
    migracao: colunas.solicitado,
    fila: {
      aguardando_clique: aguardando,
      solicitados_sem_numero: solicitados,
      enviados_sem_numero: enviados,
      sem_faturamento: semFaturamento,
    },
  };
}

// ─── O estado inteiro, para a tela ───────────────────────────────────────────

/**
 * Tudo que a tela mostra, numa chamada. Cada bloco falha sozinho: o que não
 * deu para ler vira `null` e uma frase em `avisos`; o resto sai.
 */
export async function lerEstadoDaIntegracao(company_id: string): Promise<EstadoDaIntegracao> {
  const avisos: string[] = [];

  const seguro = async <T>(o_que: string, ler: () => Promise<T>): Promise<T | null> => {
    try {
      return await ler();
    } catch (e) {
      console.error(`[integracao] ${o_que} sem resposta do banco: ${mensagem(e)}`);
      avisos.push(`Não deu para ler ${o_que} agora. Tente de novo em instantes.`);
      return null;
    }
  };

  // canais e solicitação leem `companies` em sequência (uma leitura de cada
  // vez na mesma tabela); o registro e a fila correm em paralelo com eles.
  const [empresa, registro, contagem] = await Promise.all([
    (async () => {
      const canais = await seguro('os canais', () => lerCanais(company_id));
      const solicitacao = await seguro('o pedido de sincronização', () => lerSolicitacaoDeSync(company_id));
      return { canais, solicitacao };
    })(),
    seguro('o registro das chamadas', () => ultimasChamadas(company_id)),
    seguro('a fila de pedidos', () => contarFila(company_id)),
  ]);

  return {
    servidor_hora: new Date().toISOString(),
    canais: empresa.canais,
    sincronizar_agora: Boolean(empresa.solicitacao?.solicitacao),
    solicitacao: empresa.solicitacao?.solicitacao ?? null,
    chamadas: registro?.chamadas ?? null,
    fila: contagem?.fila ?? null,
    migracoes: {
      canais: empresa.canais?.migracao ?? false,
      registro: registro?.migracao ?? false,
      sincronizacao: empresa.solicitacao?.migracao ?? false,
      solicitacao_do_pedido: contagem?.migracao ?? false,
    },
    avisos,
  };
}
