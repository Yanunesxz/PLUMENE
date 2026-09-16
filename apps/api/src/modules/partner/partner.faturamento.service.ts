/**
 * Recebe o FATURAMENTO que o ERP do parceiro empurra.
 *
 * É a última mão da integração, e a mais importante para quem comprou: enquanto
 * o pedido não é faturado, ele é só uma intenção. O gerente aprovar significa
 * "pode ir para o ERP"; quem diz que virou negócio é a nota, porque é o
 * financeiro que corta item em falta e corrige preço antes de emitir.
 *
 * Por isso o `invoiced` é o que acende "Aprovado" para o lojista (ver
 * `constants/statusDoCliente.ts`) e o que conta como venda no painel.
 *
 * O ERP identifica o pedido pelo número DELE (`pedido_erp`, gravado em
 * `orders.erp_order_id` na confirmação da importação). Aceita também o nosso
 * `id`, para o caso de ele preferir devolver o que recebeu.
 *
 * Mesma política tolerante das outras mãos: recusa só o registro que não dá
 * para usar e devolve a lista do que foi ignorado e por quê.
 *
 * COMO GUARDA (fase 0, 15/09/2026):
 *   • reenviar é seguro: campo que não veio não apaga (`valor_faturado`
 *     ausente mantém o gravado, `faturado_em` ausente mantém a data de quem já
 *     estava faturado); `null` explícito em `valor_faturado` limpa;
 *   • nada mudou → nada é gravado (nem `updated_at`), e o registro conta em
 *     `inalterados`;
 *   • momento sem fuso é recusado: "2026-08-13T14:02:00" não diz se é Brasília
 *     ou UTC, e três horas de diferença trocam o dia da última compra;
 *   • só fatura pedido aprovado ou enviado ao ERP;
 *   • com a 048, guarda a NOTA (número, série, chave, emissão, valor) e as
 *     peças que ela levou — o corte feito dentro do Control, peça por peça.
 */
import { supabase } from '../../config/supabase.js';
import { detectar } from '../../lib/detectarColuna.js';
import { registrarCompraDoCliente } from '../orders/orders.service.js';
import { guardarOriginal } from '../orders/pedidoOriginal.service.js';
import { registrarEventoErp, type TipoEventoErp } from '../orders/eventosErp.service.js';
import { detectarNotasOuFalhar } from '../orders/notasDoPedido.service.js';
import { avisarFaturadoAoRep } from '../push/push.avisos.js';
import { normalizarNumeroErp } from '@csb/shared';

/** Uma nota fiscal do pedido, como o ERP manda (048). */
export interface NotaParceiro {
  /** Obrigatório quando a nota vem. */
  numero?: string | number | null;
  /** Ausente = '' (a série faz parte da chave da nota). */
  serie?: string | number | null;
  chave?: string | null;
  /** Momento da emissão, com fuso (Z ou -03:00). */
  emitida_em?: string | null;
  valor?: number | null;
}

/** Uma peça que a nota levou (048). */
export interface ItemFaturadoParceiro {
  /** O mesmo código de produto que o GET /partner/v1/pedidos manda. */
  produto?: string | number | null;
  tamanho?: string | number | null;
  /** Inteiro maior que zero. */
  quantidade?: number | null;
  preco_unitario?: number | null;
}

export interface FaturamentoParceiro {
  /** Número do pedido no ERP — a chave preferida. */
  pedido_erp?: string | null;
  /** Nosso id, alternativa ao número do ERP. */
  id?: string | null;
  /** `false` cancela um faturamento informado antes. Ausente = true. */
  faturado?: boolean | null;
  /**
   * Momento da emissão da nota, COM fuso (Z ou -03:00). Ausente = mantém a
   * data de quem já estava faturado; para quem não estava, agora.
   */
  faturado_em?: string | null;
  /**
   * O valor que a nota realmente fechou. Ausente = mantém o gravado; `null`
   * explícito limpa (o painel volta ao valor do pedido); zero não é nota. É
   * normal ser MENOR que o pedido: o que faltou no estoque não é faturado.
   */
  valor_faturado?: number | null;
  /** A nota fiscal (048). Sem a migração, é ignorada com aviso. */
  nota?: NotaParceiro | null;
  /**
   * As peças que a nota levou (048). Vem junto com `nota` e SUBSTITUI as peças
   * daquela nota (reenviar a mesma lista não grava nada).
   */
  itens?: ItemFaturadoParceiro[] | null;
}

/** Postgres: "invalid input syntax for type uuid" — o `id` não tem forma de id. */
const ID_MALFORMADO = '22P02';

/** Só pedido que a fábrica aceitou pode virar nota. */
const STATUS_FATURAVEIS = new Set(['approved', 'sent_erp']);

/** Momento com data, hora e fuso: `Z` ou `±hh:mm`. */
const MOMENTO_COM_FUSO = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/i;

export const AVISO_SEM_048 = 'notas e itens faturados ficam guardados depois da migração 048';

export interface ResultadoFaturamento {
  recebidos: number;
  /** Registros em que alguma coisa foi gravada (pedido, nota ou peças). */
  atualizados: number;
  /** Registros que chegaram iguais ao que já estava gravado: nada foi gravado. */
  inalterados: number;
  ignorados: Array<{ pedido: string; motivo: string; situacao?: string }>;
  /** O que foi gravado com ressalva (ex.: peça sem variante no catálogo). */
  avisos: Array<{ pedido: string; aviso: string }>;
}

export interface OpcoesDoFaturamento {
  /** Nome do parceiro da chave, para o rastro do pedido (order_erp_events). */
  parceiro?: string | null;
}

/**
 * `orders.invoiced_total` vem da migração 027. Como o código sobe antes de
 * alguém rodar o SQL, mandar a coluna cedo demais faria o PostgREST recusar o
 * update INTEIRO — e o ERP receberia erro num faturamento que existe. Sem a
 * coluna, o valor corrigido é ignorado e o resto grava normalmente.
 */
async function detectarColunaDoValor(): Promise<boolean> {
  return detectar('orders', 'invoiced_total');
}

const DIA_EM_SAO_PAULO = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * O DIA da compra em Brasília. Faturado às 22h de 13/08 em São Paulo é 01h de
 * 14/08 em UTC — cortar o ISO em UTC dava ao cliente uma compra no dia seguinte.
 */
export function diaEmSaoPaulo(momento: string): string | null {
  const ms = Date.parse(momento);
  if (Number.isNaN(ms)) return null;
  return DIA_EM_SAO_PAULO.format(new Date(ms));
}

/** Texto aparado de string ou número; `undefined` para o resto. */
function texto(v: unknown): string | undefined {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return undefined;
}

function temCampo(obj: object, campo: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, campo) && (obj as Record<string, unknown>)[campo] !== undefined;
}

/** Centavos: é o que o NUMERIC(12,2) guarda — comparar sem isso nunca dá "igual". */
function centavos(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function mesmoMomento(a: unknown, b: unknown): boolean {
  if (a == null || b == null) return a == null && b == null;
  return Date.parse(String(a)) === Date.parse(String(b));
}

/** "Não é data" e "é data sem fuso" são dois motivos diferentes. */
function problemaDoMomento(v: unknown, campo: string): string | null {
  if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) return `"${campo}" não é uma data ISO`;
  if (!MOMENTO_COM_FUSO.test(v.trim())) return `"${campo}" precisa de fuso (Z ou -03:00)`;
  return null;
}

// ─── A nota e as peças que vieram no registro ────────────────────────────────

interface NotaLida {
  numero: string;
  serie: string;
  /** Só os campos que VIERAM: ausente não mexe, null limpa. */
  campos: { chave?: string | null; emitida_em?: string | null; valor?: number | null };
}

interface ItemLido {
  produto: string;
  tamanho: string;
  quantidade: number;
  preco_unitario: number | null;
}

type Leitura<T> = { ok: true; valor: T } | { ok: false; motivo: string };

function lerNota(bruta: unknown): Leitura<NotaLida> {
  if (typeof bruta !== 'object' || bruta === null || Array.isArray(bruta)) {
    return { ok: false, motivo: '"nota" precisa ser um objeto com "numero"' };
  }
  const nota = bruta as Record<string, unknown>;
  const numero = texto(nota['numero']);
  if (!numero) return { ok: false, motivo: '"nota.numero" é obrigatório quando "nota" vem' };
  const serie = texto(nota['serie']) ?? '';

  const campos: NotaLida['campos'] = {};
  if (temCampo(nota, 'chave')) {
    if (nota['chave'] === null) campos.chave = null;
    else {
      const chave = texto(nota['chave']);
      if (chave === undefined) return { ok: false, motivo: '"nota.chave" precisa ser um texto' };
      campos.chave = chave || null;
    }
  }
  if (temCampo(nota, 'emitida_em')) {
    if (nota['emitida_em'] === null) campos.emitida_em = null;
    else {
      const problema = problemaDoMomento(nota['emitida_em'], 'nota.emitida_em');
      if (problema) return { ok: false, motivo: problema };
      campos.emitida_em = String(nota['emitida_em']).trim();
    }
  }
  if (temCampo(nota, 'valor')) {
    if (nota['valor'] === null) campos.valor = null;
    else {
      const valor = typeof nota['valor'] === 'number' ? centavos(nota['valor']) : null;
      if (valor == null || !(valor > 0)) return { ok: false, motivo: '"nota.valor" precisa ser maior que zero' };
      campos.valor = valor;
    }
  }
  return { ok: true, valor: { numero, serie, campos } };
}

function lerItens(brutos: unknown): Leitura<ItemLido[]> {
  if (!Array.isArray(brutos)) return { ok: false, motivo: '"itens" precisa ser uma lista' };
  const itens: ItemLido[] = [];
  for (const [posicao, bruto] of brutos.entries()) {
    const item = (typeof bruto === 'object' && bruto !== null ? bruto : {}) as Record<string, unknown>;
    const produto = texto(item['produto']);
    const tamanho = texto(item['tamanho'])?.toUpperCase();
    const quantidade = item['quantidade'];
    if (!produto || !tamanho || typeof quantidade !== 'number' || !Number.isInteger(quantidade) || quantidade <= 0) {
      return {
        ok: false,
        motivo: `"itens[${posicao}]" precisa de "produto", "tamanho" e "quantidade" inteira maior que zero`,
      };
    }
    let preco_unitario: number | null = null;
    if (item['preco_unitario'] != null) {
      const preco = typeof item['preco_unitario'] === 'number' ? centavos(item['preco_unitario']) : null;
      if (preco == null || preco < 0) {
        return { ok: false, motivo: `"itens[${posicao}].preco_unitario" precisa ser um número maior ou igual a zero` };
      }
      preco_unitario = preco;
    }
    itens.push({ produto, tamanho, quantidade, preco_unitario });
  }
  return { ok: true, valor: itens };
}

/** A lista de peças numa forma comparável: mesma lista em outra ordem é a mesma lista. */
function assinaturaDosItens(
  itens: Array<{ produto: unknown; tamanho: unknown; variant_id: unknown; quantidade: unknown; preco_unitario: unknown }>,
): string {
  return itens
    .map((i) =>
      [String(i.produto ?? ''), String(i.tamanho ?? ''), String(i.variant_id ?? ''), Number(i.quantidade ?? 0), centavos(i.preco_unitario) ?? ''].join('|'),
    )
    .sort()
    .join('\n');
}

/**
 * A variante do catálogo de cada peça: primeiro por `product_variants.erp_sku`
 * ("PRODUTO|TAMANHO", a grafia das cargas do Control), depois por
 * `products.erp_id` + tamanho. Não achou → sem vínculo (a peça é guardada do
 * mesmo jeito). Erro de leitura volta como erro, e o registro é ignorado para
 * o ERP reenviar: gravar "sem variante" por um soluço de rede apagaria um
 * vínculo que existe.
 */
async function resolverVariantes(
  company_id: string,
  itens: ItemLido[],
): Promise<{ ok: true; variantes: Map<string, string> } | { ok: false; erro: string }> {
  const variantes = new Map<string, string>();
  if (itens.length === 0) return { ok: true, variantes };
  const chaves = [...new Set(itens.map((i) => `${i.produto}|${i.tamanho}`))];

  const porSku = await supabase
    .from('product_variants')
    .select('id, erp_sku')
    .eq('company_id', company_id)
    .in('erp_sku', chaves);
  if (porSku.error) return { ok: false, erro: porSku.error.message };
  for (const v of (porSku.data ?? []) as Array<{ id: string; erp_sku: string | null }>) {
    if (v.erp_sku && !variantes.has(v.erp_sku)) variantes.set(v.erp_sku, v.id);
  }

  const faltam = chaves.filter((c) => !variantes.has(c));
  if (faltam.length === 0) return { ok: true, variantes };

  const produtos = [...new Set(faltam.map((c) => c.slice(0, c.lastIndexOf('|'))))];
  const porProduto = await supabase
    .from('products')
    .select('id, erp_id')
    .eq('company_id', company_id)
    .in('erp_id', produtos);
  if (porProduto.error) return { ok: false, erro: porProduto.error.message };
  const produtoPorCodigo = new Map<string, string>();
  for (const p of (porProduto.data ?? []) as Array<{ id: string; erp_id: string | null }>) {
    if (p.erp_id && !produtoPorCodigo.has(p.erp_id)) produtoPorCodigo.set(p.erp_id, p.id);
  }
  if (produtoPorCodigo.size === 0) return { ok: true, variantes };

  const porTamanho = await supabase
    .from('product_variants')
    .select('id, product_id, size')
    .eq('company_id', company_id)
    .in('product_id', [...new Set(produtoPorCodigo.values())]);
  if (porTamanho.error) return { ok: false, erro: porTamanho.error.message };
  const linhas = (porTamanho.data ?? []) as Array<{ id: string; product_id: string; size: string | null }>;
  for (const chave of faltam) {
    const corte = chave.lastIndexOf('|');
    const produtoId = produtoPorCodigo.get(chave.slice(0, corte));
    const tamanho = chave.slice(corte + 1);
    const achada = linhas.find((l) => l.product_id === produtoId && (l.size ?? '').trim().toUpperCase() === tamanho);
    if (achada) variantes.set(chave, achada.id);
  }
  return { ok: true, variantes };
}

// ─── O pedido ────────────────────────────────────────────────────────────────

interface PedidoLido {
  id: string;
  status: string | null;
  invoiced: boolean | null;
  invoiced_at: string | null;
  invoiced_total?: number | string | null;
  customer_id: string | null;
  order_number: number | null;
  rep_id: string | null;
  guest_name: string | null;
}

/** A nota como está no banco (order_invoices). */
interface NotaGravada {
  id: string;
  chave: string | null;
  emitida_em: string | null;
  valor: number | string | null;
  cancelada_em: string | null;
}

type Desfecho =
  | { tipo: 'atualizado' }
  | { tipo: 'inalterado' }
  | { tipo: 'ignorado'; motivo: string; situacao?: string };

interface Contexto {
  company_id: string;
  parceiro: string | null;
  comValor: boolean;
  /** Lança quando o banco não respondeu sobre o schema. */
  temNotas: () => Promise<boolean>;
  avisar: (aviso: string) => void;
}

export async function receberFaturamento(
  company_id: string,
  lista: FaturamentoParceiro[],
  opcoes: OpcoesDoFaturamento = {},
): Promise<ResultadoFaturamento> {
  const ignorados: ResultadoFaturamento['ignorados'] = [];
  const avisos: ResultadoFaturamento['avisos'] = [];
  let atualizados = 0;
  let inalterados = 0;

  const comValor = await detectarColunaDoValor();
  // A 048 só é sondada quando algum registro precisa dela. Sonda que falha por
  // rede não fica lembrada: o registro é ignorado e o próximo pergunta de novo.
  let comNotas: Promise<boolean> | null = null;
  const temNotas = () =>
    (comNotas ??= detectarNotasOuFalhar().catch((e: unknown) => {
      comNotas = null;
      throw e;
    }));

  for (const bruto of lista) {
    // Registro que nem objeto é (null, número) cai em "sem identificação" em
    // vez de virar TypeError e derrubar o lote inteiro.
    const item: FaturamentoParceiro = typeof bruto === 'object' && bruto !== null ? bruto : {};
    // O MESMO numero, escrito de dois jeitos: o app grava normalizado
    // ("SX14627") desde 10/09/2026, e o ERP pode mandar "sx-14627" ou
    // "SX 14627". Sem normalizar aqui, o pedido lancado nunca fatura.
    const pedidoErpCru = texto(item.pedido_erp);
    const pedidoErp = pedidoErpCru ? normalizarNumeroErp(pedidoErpCru) : undefined;
    const id = texto(item.id);
    const referencia = pedidoErp || id || '(sem identificação)';

    const avisosDoItem = new Set<string>();
    const desfecho = await processarItem(
      {
        company_id,
        parceiro: opcoes.parceiro ?? null,
        comValor,
        temNotas,
        avisar: (aviso) => avisosDoItem.add(aviso),
      },
      item,
      pedidoErp,
      pedidoErpCru,
      id,
    );
    for (const aviso of avisosDoItem) avisos.push({ pedido: referencia, aviso });

    if (desfecho.tipo === 'ignorado') {
      ignorados.push(
        desfecho.situacao !== undefined
          ? { pedido: referencia, motivo: desfecho.motivo, situacao: desfecho.situacao }
          : { pedido: referencia, motivo: desfecho.motivo },
      );
    } else if (desfecho.tipo === 'atualizado') {
      atualizados += 1;
    } else {
      inalterados += 1;
    }
  }

  return { recebidos: lista.length, atualizados, inalterados, ignorados, avisos };
}

async function processarItem(
  ctx: Contexto,
  item: FaturamentoParceiro,
  pedidoErp: string | undefined,
  pedidoErpCru: string | undefined,
  id: string | undefined,
): Promise<Desfecho> {
  const { company_id, comValor } = ctx;

  if (!pedidoErp && !id) return { tipo: 'ignorado', motivo: 'informe "pedido_erp" ou "id"' };

  // Sempre dentro da empresa da chave: um parceiro nunca fatura pedido de
  // outra fábrica, mesmo acertando o número por acaso.
  let busca = supabase
    .from('orders')
    .select(
      `id, status, invoiced, invoiced_at, customer_id, order_number, rep_id, guest_name${comValor ? ', invoiced_total' : ''}`,
    )
    .eq('company_id', company_id);
  busca = pedidoErp
    // As duas grafias: o normalizado (app) e o texto cru que o parceiro
    // gravou antes de 10/09 pelo confirmOrderImport.
    ? busca.in('erp_order_id', [...new Set([pedidoErp, pedidoErpCru as string])])
    : busca.eq('id', id as string);

  const { data, error: erroBusca } = await busca.maybeSingle();
  // `id` sem forma de UUID: o Postgres recusa o texto (22P02). Isso é "não
  // existe pedido com esse id", não "falha ao buscar" — senão a doc mandaria
  // o ERP reenviar o mesmo id errado a cada rodada.
  if (erroBusca && (erroBusca as { code?: string }).code !== ID_MALFORMADO) {
    return { tipo: 'ignorado', motivo: `falha ao buscar: ${erroBusca.message}` };
  }
  if (!data) return { tipo: 'ignorado', motivo: 'pedido não encontrado nesta empresa' };
  const pedido = data as unknown as PedidoLido;

  // Rascunho, fila de aprovação ou recusado não viram nota: o ERP só tem o
  // pedido depois do aceite da fábrica.
  if (!STATUS_FATURAVEIS.has(String(pedido.status ?? ''))) {
    return {
      tipo: 'ignorado',
      motivo: 'pedido não está aprovado nem enviado ao ERP',
      situacao: String(pedido.status ?? ''),
    };
  }

  const faturado = item.faturado !== false;

  if (item.faturado_em) {
    const problema = problemaDoMomento(item.faturado_em, 'faturado_em');
    if (problema) return { tipo: 'ignorado', motivo: problema };
  }

  const veioValor = temCampo(item, 'valor_faturado');
  if (item.valor_faturado != null && !(item.valor_faturado > 0)) {
    // Zero não é nota: cancelamento se diz com faturado: false.
    return { tipo: 'ignorado', motivo: '"valor_faturado" precisa ser maior que zero' };
  }

  // A nota e as peças: lidas antes de qualquer gravação — registro com nota
  // malformada é recusado inteiro, para o ERP corrigir e reenviar tudo junto.
  const veioNota = item.nota != null;
  const veioItens = item.itens != null;
  let nota: NotaLida | null = null;
  let itens: ItemLido[] | null = null;
  if (veioNota) {
    const lida = lerNota(item.nota);
    if (!lida.ok) return { tipo: 'ignorado', motivo: lida.motivo };
    nota = lida.valor;
  }
  if (veioItens) {
    if (!veioNota) return { tipo: 'ignorado', motivo: '"itens" precisa vir junto com "nota" (informe "nota.numero")' };
    const lidos = lerItens(item.itens);
    if (!lidos.ok) return { tipo: 'ignorado', motivo: lidos.motivo };
    itens = lidos.valor;
  }

  const antesFaturado = pedido.invoiced === true;
  const agora = new Date().toISOString();

  // ── O que muda no pedido ──
  const mudancas: Record<string, unknown> = {};
  if (faturado) {
    if (!antesFaturado) mudancas['invoiced'] = true;
    if (item.faturado_em) {
      if (!mesmoMomento(item.faturado_em, pedido.invoiced_at)) mudancas['invoiced_at'] = item.faturado_em.trim();
    } else if (!antesFaturado || !pedido.invoiced_at) {
      // Sem `faturado_em`, quem ainda não estava faturado fatura agora. Quem já
      // estava mantém a data: reenviar sem `faturado_em` não é nota nova.
      mudancas['invoiced_at'] = agora;
    }
    if (comValor && veioValor) {
      const valor = centavos(item.valor_faturado);
      if (valor !== centavos(pedido.invoiced_total)) mudancas['invoiced_total'] = valor;
    }
  } else {
    // Cancelou? O valor faturado some junto — deixá-lo para trás faria o
    // painel somar uma nota que não existe mais.
    if (antesFaturado) mudancas['invoiced'] = false;
    if (pedido.invoiced_at != null) mudancas['invoiced_at'] = null;
    if (comValor && centavos(pedido.invoiced_total) != null) mudancas['invoiced_total'] = null;
    if (Object.keys(mudancas).length > 0) {
      // Grava o estado inteiro do cancelamento, não só a diferença.
      mudancas['invoiced'] = false;
      mudancas['invoiced_at'] = null;
      if (comValor) mudancas['invoiced_total'] = null;
    }
  }
  const pedidoMudou = Object.keys(mudancas).length > 0;

  // ── As notas ──
  let notaAtual: NotaGravada | null = null;
  const notaPatch: Record<string, unknown> = {};
  let notaNova = false;
  let itensParaGravar: Array<ItemLido & { variant_id: string | null }> | null = null;
  let notasACancelar: Array<{ id: string; numero: string; serie: string }> = [];

  if ((veioNota || veioItens) && !faturado) {
    ctx.avisar('nota e itens ignorados: "faturado": false cancela as notas do pedido');
    nota = null;
    itens = null;
  }
  // Só pergunta pela 048 quando vai precisar dela (nota, ou desfazer que
  // cancela notas). Sem resposta do banco o registro é ignorado para o ERP
  // reenviar — "sem a 048" por um soluço perderia a nota em silêncio.
  let comNotas = false;
  if (nota || !faturado) {
    try {
      comNotas = await ctx.temNotas();
    } catch (e) {
      return { tipo: 'ignorado', motivo: `falha ao buscar: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  if (nota && !comNotas) {
    ctx.avisar(AVISO_SEM_048);
    nota = null;
    itens = null;
  }

  if (nota) {
    const lida = await supabase
      .from('order_invoices')
      .select('id, chave, emitida_em, valor, cancelada_em')
      .eq('company_id', company_id)
      .eq('order_id', pedido.id)
      .eq('serie', nota.serie)
      .eq('numero', nota.numero)
      .maybeSingle();
    if (lida.error) return { tipo: 'ignorado', motivo: `falha ao buscar: ${lida.error.message}` };
    notaAtual = (lida.data as NotaGravada | null) ?? null;

    if (!notaAtual) {
      notaNova = true;
    } else {
      const c = nota.campos;
      if (c.chave !== undefined && (c.chave ?? null) !== (notaAtual.chave ?? null)) notaPatch['chave'] = c.chave;
      if (c.emitida_em !== undefined && !mesmoMomento(c.emitida_em, notaAtual.emitida_em)) {
        notaPatch['emitida_em'] = c.emitida_em;
      }
      if (c.valor !== undefined && c.valor !== centavos(notaAtual.valor)) notaPatch['valor'] = c.valor;
      // Reenviar uma nota cancelada é dizer que ela vale de novo.
      if (notaAtual.cancelada_em != null) notaPatch['cancelada_em'] = null;
    }

    if (itens) {
      const resolvidas = await resolverVariantes(company_id, itens);
      if (!resolvidas.ok) return { tipo: 'ignorado', motivo: `falha ao buscar: ${resolvidas.erro}` };
      itensParaGravar = itens.map((i) => ({
        ...i,
        variant_id: resolvidas.variantes.get(`${i.produto}|${i.tamanho}`) ?? null,
      }));
      for (const i of itensParaGravar) {
        if (!i.variant_id) {
          ctx.avisar(`peça ${i.produto} tamanho ${i.tamanho} sem variante no catálogo: guardada sem vínculo`);
        }
      }

      let itensIguais = false;
      if (notaAtual) {
        const atuais = await supabase
          .from('order_invoice_items')
          .select('produto, tamanho, variant_id, quantidade, preco_unitario')
          .eq('company_id', company_id)
          .eq('invoice_id', notaAtual.id);
        if (atuais.error) return { tipo: 'ignorado', motivo: `falha ao buscar: ${atuais.error.message}` };
        itensIguais =
          assinaturaDosItens((atuais.data ?? []) as never[]) === assinaturaDosItens(itensParaGravar);
      } else {
        itensIguais = itensParaGravar.length === 0;
      }
      if (itensIguais) itensParaGravar = null;
    }
  } else if (!faturado && comNotas) {
    // Desfazer o faturamento cancela as notas ativas do pedido (e só elas: a
    // nota cancelada antes fica com a data em que foi cancelada).
    const ativas = await supabase
      .from('order_invoices')
      .select('id, numero, serie')
      .eq('company_id', company_id)
      .eq('order_id', pedido.id)
      .is('cancelada_em', null);
    if (ativas.error) return { tipo: 'ignorado', motivo: `falha ao buscar: ${ativas.error.message}` };
    notasACancelar = (Array.isArray(ativas.data) ? ativas.data : []) as typeof notasACancelar;
  }

  const notaMudou = notaNova || Object.keys(notaPatch).length > 0;
  const itensMudaram = itensParaGravar !== null;
  if (!pedidoMudou && !notaMudou && !itensMudaram && notasACancelar.length === 0) {
    return { tipo: 'inalterado' };
  }

  // A foto do original (044) antes da primeira gravação: se ninguém tinha
  // cortado peça, é agora que ela vale.
  if (faturado) {
    await guardarOriginal(
      { id: pedido.id, company_id, status: pedido.status as never },
      'faturamento',
    );
  }

  // ── Gravações: a nota e as peças primeiro, o pedido por último. Se o pedido
  // falhar, o ERP reenvia e só o que faltou é gravado. ──
  let invoiceId = notaAtual?.id ?? null;
  if (nota && notaMudou) {
    if (notaNova) {
      const gravada = await supabase
        .from('order_invoices')
        .upsert(
          {
            company_id,
            order_id: pedido.id,
            numero: nota.numero,
            serie: nota.serie,
            ...nota.campos,
            cancelada_em: null,
            origem: 'api',
            updated_at: agora,
          },
          { onConflict: 'company_id,order_id,serie,numero' },
        )
        .select('id')
        .maybeSingle();
      if (gravada.error || !gravada.data) {
        return { tipo: 'ignorado', motivo: `falha ao gravar a nota: ${gravada.error?.message ?? 'sem resposta do banco'}` };
      }
      invoiceId = (gravada.data as { id: string }).id;
    } else if (notaAtual) {
      const { error } = await supabase
        .from('order_invoices')
        .update({ ...notaPatch, updated_at: agora })
        .eq('id', notaAtual.id)
        .eq('company_id', company_id);
      if (error) return { tipo: 'ignorado', motivo: `falha ao gravar a nota: ${error.message}` };
    }
  }

  if (itensParaGravar && invoiceId) {
    // Substitui as peças DAQUELA nota — as das outras notas do pedido ficam.
    const apagou = await supabase
      .from('order_invoice_items')
      .delete()
      .eq('company_id', company_id)
      .eq('invoice_id', invoiceId);
    if (apagou.error) return { tipo: 'ignorado', motivo: `falha ao gravar as peças da nota: ${apagou.error.message}` };
    if (itensParaGravar.length > 0) {
      const { error } = await supabase.from('order_invoice_items').insert(
        itensParaGravar.map((i) => ({
          company_id,
          invoice_id: invoiceId,
          order_id: pedido.id,
          produto: i.produto,
          tamanho: i.tamanho,
          variant_id: i.variant_id,
          quantidade: i.quantidade,
          preco_unitario: i.preco_unitario,
          created_at: agora,
          updated_at: agora,
        })),
      );
      if (error) return { tipo: 'ignorado', motivo: `falha ao gravar as peças da nota: ${error.message}` };
    }
  }

  if (notasACancelar.length > 0) {
    const { error } = await supabase
      .from('order_invoices')
      .update({ cancelada_em: agora, updated_at: agora })
      .eq('company_id', company_id)
      .eq('order_id', pedido.id)
      .is('cancelada_em', null);
    if (error) return { tipo: 'ignorado', motivo: `falha ao gravar: ${error.message}` };
  }

  const rastro = {
    faturado,
    antesFaturado,
    pedidoMudou,
    mudancas,
    nota,
    notaMudou: notaMudou || itensMudaram,
    notaAtual,
    pecas: itensParaGravar ? itensParaGravar.reduce((s, i) => s + i.quantidade, 0) : undefined,
    notasACancelar,
    agora,
  };
  // O rastro da nota sai logo depois de a nota ser gravada: se o pedido falhar
  // agora, o reenvio acha a nota igual e não teria outra chance de registrar.
  await registrarRastro(ctx, pedido, rastro, 'notas');

  // O pedido: o faturamento em si, ou só o carimbo de alteração quando a
  // mudança foi na nota — o CRM enxerga o pedido por `updated_at`.
  const { error } = await supabase
    .from('orders')
    .update({ ...mudancas, updated_at: agora })
    .eq('id', pedido.id)
    .eq('company_id', company_id);
  if (error) return { tipo: 'ignorado', motivo: `falha ao gravar: ${error.message}` };

  await registrarRastro(ctx, pedido, rastro, 'pedido');

  // A transição para faturado: a última compra do cliente anda (só para
  // frente, pelo dia de Brasília) e o representante fica sabendo.
  if (faturado && !antesFaturado) {
    const momento = (mudancas['invoiced_at'] as string | undefined) ?? pedido.invoiced_at ?? agora;
    await registrarCompraDoCliente(pedido.customer_id, diaEmSaoPaulo(momento), company_id);
    if (pedido.rep_id) {
      try {
        avisarFaturadoAoRep(
          company_id,
          { id: pedido.id, order_number: pedido.order_number, rep_id: pedido.rep_id, guest_name: pedido.guest_name },
          'api-parceiro',
        );
      } catch (e) {
        console.error(`[faturamento] aviso ao representante não saiu: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  return { tipo: 'atualizado' };
}

/** Uma linha em order_erp_events por acontecimento (048). Nunca derruba a rota. */
async function registrarRastro(
  ctx: Contexto,
  pedido: PedidoLido,
  r: {
    faturado: boolean;
    antesFaturado: boolean;
    pedidoMudou: boolean;
    mudancas: Record<string, unknown>;
    nota: NotaLida | null;
    notaMudou: boolean;
    notaAtual: NotaGravada | null;
    pecas: number | undefined;
    notasACancelar: Array<{ numero: string; serie: string }>;
    agora: string;
  },
  parte: 'notas' | 'pedido',
): Promise<void> {
  const base = {
    company_id: ctx.company_id,
    order_id: pedido.id,
    order_number: pedido.order_number,
    origem: 'api' as const,
    parceiro: ctx.parceiro,
  };
  const estadoAntes = {
    invoiced: pedido.invoiced === true,
    invoiced_at: pedido.invoiced_at,
    ...(ctx.comValor ? { invoiced_total: centavos(pedido.invoiced_total) } : {}),
  };

  if (parte === 'pedido') {
    if (!r.pedidoMudou) return;
    const tipo: TipoEventoErp = !r.faturado
      ? 'faturamento_desfeito'
      : r.antesFaturado
        ? 'faturamento_alterado'
        : 'faturado';
    await registrarEventoErp({ ...base, tipo, antes: estadoAntes, depois: { ...estadoAntes, ...r.mudancas } });
    return;
  }

  if (r.nota && r.notaMudou) {
    await registrarEventoErp({
      ...base,
      tipo: 'nota_registrada',
      antes: r.notaAtual
        ? {
            numero: r.nota.numero,
            serie: r.nota.serie,
            chave: r.notaAtual.chave,
            emitida_em: r.notaAtual.emitida_em,
            valor: centavos(r.notaAtual.valor),
            cancelada_em: r.notaAtual.cancelada_em,
          }
        : null,
      depois: {
        numero: r.nota.numero,
        serie: r.nota.serie,
        ...r.nota.campos,
        cancelada_em: null,
        ...(r.pecas !== undefined ? { pecas: r.pecas } : {}),
      },
    });
  }

  for (const n of r.notasACancelar) {
    await registrarEventoErp({
      ...base,
      tipo: 'nota_cancelada',
      antes: { numero: n.numero, serie: n.serie, cancelada_em: null },
      depois: { numero: n.numero, serie: n.serie, cancelada_em: r.agora },
    });
  }
}
