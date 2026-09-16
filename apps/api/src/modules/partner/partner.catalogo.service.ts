/**
 * O CATÁLOGO que o Control empurra: tabelas de preço, condições de pagamento,
 * produtos e tamanhos, preço por tabela e estoque (decisão 6 do Yan,
 * 16/09/2026). O Control manda TUDO e sobrescreve; o Firebird fica aposentado
 * (as travas já existem) e o PDF deixa de ser a fonte do preço.
 *
 * Mesma política das outras mãos de entrada (partner.sync.service.ts):
 *
 *   • campo AUSENTE não mexe; `null` explícito limpa (numa coluna NOT NULL,
 *     limpar é voltar ao padrão). Texto vazio conta como ausente;
 *   • as leituras vêm ANTES da primeira gravação; se uma falhar, a rota vira
 *     500 sem ter gravado nada (o Control tenta de novo);
 *   • grava só o que mudou; sem mudança nada vai ao banco (nem `updated_at`) e
 *     o registro conta em `sem_mudanca`. Reenviar o mesmo lote é inofensivo;
 *   • a falha ao gravar UM registro vira ignorado com o motivo, e o lote segue;
 *   • tolerante: só é recusado o que não dá para usar (sem código, sem nome,
 *     preço ilegível, tabela ou produto que o app não tem).
 *
 * DUAS COLUNAS NUNCA SÃO REGRAVADAS: `price_tables.name` e
 * `payment_conditions.description` — o CRM casa por elas. A descrição que o
 * Control manda vai para `erp_description` (049). Tabela nova nasce com
 * `name` = descrição (ou "Tabela <código>"); condição nova nasce com
 * `description` = descrição — e daí em diante o app é dono do texto.
 *
 * Tudo que depende da migração 049 (erp_description, active de price_tables,
 * valor_minimo, erp_updated_at, preco_original, desconto_percentual,
 * stock_updated_at) passa por `detectarOuFalhar`: a API sobe antes do SQL, e
 * sem a coluna o dado correspondente não é gravado e volta como aviso.
 *
 * O código de tabela e de condição casa pelo miolo (`codigoMiolo`); o de
 * produto também, com uma adoção a mais: produto carregado do PDF não tem
 * `erp_id` — quando o Control manda o mesmo código (ou a mesma referência)
 * como `sku`, o cadastro aprende o código em vez de nascer um segundo.
 */
import { codigoCanonico, codigoMiolo } from '@csb/shared';
import { supabase } from '../../config/supabase.js';
import { buscarTudoOuFalhar, emLotes } from '../../lib/paginacao.js';
import { detectarOuFalhar } from '../../lib/detectarColuna.js';

// ─── Tipos do corpo que o Control envia ──────────────────────────────────────

export interface TabelaDePrecoParceiro {
  codigo?: string | number | null;
  descricao?: string | null;
  /** A coluna de preço do Control (1 a 6). Obrigatória na tabela nova. */
  coluna?: number | string | null;
  ativo?: string | boolean | number | null;
  /** Quando o Control alterou o cadastro, COM fuso. Ausente = agora. */
  data_update?: string | null;
}

export interface CondicaoDePagamentoParceiro {
  codigo?: string | number | null;
  descricao?: string | null;
  ativo?: string | boolean | number | null;
  /** O menor pedido que a condição aceita; `null` limpa. */
  valor_minimo?: number | string | null;
  data_update?: string | null;
}

export interface TamanhoParceiro {
  tamanho?: string | number | null;
  ativo?: string | boolean | number | null;
}

export interface ProdutoParceiro {
  codigo?: string | number | null;
  /** A referência do catálogo. Vira `sku` só quando o produto nasce (ou está sem sku). */
  referencia?: string | number | null;
  nome?: string | null;
  grupo?: string | null;
  colecao?: string | null;
  marca?: string | null;
  ativo?: string | boolean | number | null;
  /** A grade. Ausente não mexe; tamanho que não vier NÃO é desativado. */
  tamanhos?: TamanhoParceiro[] | null;
  data_update?: string | null;
}

export interface PrecoParceiro {
  tabela?: string | number | null;
  produto?: string | number | null;
  /** O preço que vale na tabela — sobrescreve o que estava (inclusive o do PDF). */
  preco?: number | string | null;
  preco_original?: number | string | null;
  desconto_percentual?: number | string | null;
  data_update?: string | null;
}

export interface EstoqueParceiro {
  produto?: string | number | null;
  tamanho?: string | number | null;
  /** Estoque de prateleira (inteiro; negativo é aceito como o ERP conta). */
  quantidade?: number | string | null;
  /** Reservado em pedidos. Ausente não mexe; `null` zera. */
  reservado?: number | string | null;
}

export interface Ignorado {
  codigo: string | null;
  motivo: string;
}

export interface ResultadoCatalogo {
  recebidos: number;
  criados: number;
  atualizados: number;
  /** Registros que chegaram iguais ao que já estava: nada foi gravado. */
  sem_mudanca: number;
  ignorados: Ignorado[];
  avisos: string[];
}

export interface ResultadoProdutos extends ResultadoCatalogo {
  tamanhos_criados: number;
  tamanhos_atualizados: number;
}

/** Avisos fixos de "a 049 ainda não rodou" — um por rota, uma vez por lote. */
export const AVISO_SEM_049 = {
  tabelas:
    'Descrição do Control, "ativo" e "data_update" das tabelas ficam guardados depois da migração 049 — por ora só código e coluna foram gravados.',
  condicoes:
    'Descrição do Control, "valor_minimo" e "data_update" das condições ficam guardados depois da migração 049 — por ora só "ativo" foi gravado.',
  produtos: '"data_update" dos produtos fica guardado depois da migração 049 — o resto foi gravado.',
  precos:
    '"preco_original", "desconto_percentual" e "data_update" ficam guardados depois da migração 049 — o preço foi gravado.',
  estoque: 'A data do estoque (stock_updated_at) fica guardada depois da migração 049 — o estoque foi gravado.',
} as const;

// ─── Leitura do que veio ─────────────────────────────────────────────────────

/** O campo não veio (ou veio vazio), ou veio com um valor — `null` = limpar. */
type Recebido<T> = { veio: false } | { veio: true; valor: T | null };
type RecebidoOuInvalido<T> = Recebido<T> | { veio: 'invalido' };

const NAO_VEIO = { veio: false } as const;
const INVALIDO = { veio: 'invalido' } as const;

/** O valor recebido, ou null quando não veio. */
const valorDe = <T>(r: Recebido<T>): T | null => (r.veio ? r.valor : null);

/** Até quantos códigos um aviso lista (o resto vira "e mais N"). */
const CODIGOS_POR_AVISO = 20;

/** Inserts e upserts vão em lotes deste tamanho. */
const LINHAS_POR_LOTE = 500;

const ehObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const tem = (obj: Record<string, unknown>, chave: string): boolean =>
  Object.prototype.hasOwnProperty.call(obj, chave) && obj[chave] !== undefined;

/** Texto aparado, ou null quando não há texto (ausente, vazio ou não é texto). */
const textoSimples = (v: unknown): string | null => {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

/** Campo de texto: ausente ou "" não mexe; `null` limpa; número vira texto. */
function lerTexto(obj: Record<string, unknown>, chave: string): Recebido<string> {
  if (!tem(obj, chave)) return NAO_VEIO;
  const v = obj[chave];
  if (v === null) return { veio: true, valor: null };
  const s = textoSimples(v);
  return s === null ? NAO_VEIO : { veio: true, valor: s };
}

const SIM = new Set(['S', 'SIM', 'TRUE', '1']);
const NAO = new Set(['N', 'NAO', 'NÃO', 'FALSE', '0']);

/**
 * `ativo`: S/SIM/true/1 liga, N/NÃO/false/0 desliga. Ausente, "" ou `null`
 * não mexem (a coluna é NOT NULL: não há "limpar"). Outro texto não mexe e
 * volta como aviso.
 */
function lerSimNao(obj: Record<string, unknown>, chave: string): boolean | undefined | 'invalido' {
  if (!tem(obj, chave)) return undefined;
  const v = obj[chave];
  if (v === null) return undefined;
  if (typeof v === 'boolean') return v;
  const s = textoSimples(v);
  if (s === null) return undefined;
  const S = s.toUpperCase();
  if (SIM.has(S)) return true;
  if (NAO.has(S)) return false;
  return 'invalido';
}

/** Número JSON ou texto numérico ("1500.50", "1.500,50"). `null` quando não é número. */
function numeroDe(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = textoSimples(v);
  if (s === null) return null;
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
  return Number.isFinite(n) ? n : null;
}

/** Centavos: é o que o NUMERIC(12,2) guarda. */
const centavos = (n: number): number => Math.round(n * 100) / 100;

/**
 * Campo numérico com casas: ausente ou "" não mexe; `null` limpa; ilegível ou
 * fora de `[minimo, maximo]` é inválido (não mexe, e quem chamou avisa ou recusa).
 */
function lerValor(
  obj: Record<string, unknown>,
  chave: string,
  minimo = 0,
  maximo = Number.POSITIVE_INFINITY,
): RecebidoOuInvalido<number> {
  if (!tem(obj, chave)) return NAO_VEIO;
  const v = obj[chave];
  if (v === null) return { veio: true, valor: null };
  if (textoSimples(v) === null) return NAO_VEIO;
  const n = numeroDe(v);
  if (n === null || n < minimo || n > maximo) return INVALIDO;
  return { veio: true, valor: centavos(n) };
}

/** Inteiro: ausente ou "" não mexe; `null` limpa; decimal ou fora da faixa é inválido. */
function lerInteiro(
  obj: Record<string, unknown>,
  chave: string,
  minimo = Number.NEGATIVE_INFINITY,
  maximo = Number.POSITIVE_INFINITY,
): RecebidoOuInvalido<number> {
  if (!tem(obj, chave)) return NAO_VEIO;
  const v = obj[chave];
  if (v === null) return { veio: true, valor: null };
  if (textoSimples(v) === null) return NAO_VEIO;
  const n = numeroDe(v);
  if (n === null || !Number.isInteger(n) || n < minimo || n > maximo) return INVALIDO;
  return { veio: true, valor: n };
}

/** Momento com data, hora e fuso: `Z` ou `±hh:mm`. Sem fuso não diz que hora é. */
const MOMENTO_COM_FUSO = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/i;

type Momento = { veio: false } | { veio: true; valor: string } | { veio: 'invalido'; motivo: string };

/**
 * `data_update`: ausente, "" ou `null` = sem carimbo próprio (vale a hora de
 * agora quando algo é gravado). Presente, PRECISA ter fuso — como em todas as
 * rotas do parceiro; sem ele o registro é recusado.
 */
function lerMomento(obj: Record<string, unknown>, chave: string): Momento {
  if (!tem(obj, chave) || obj[chave] === null) return NAO_VEIO;
  const s = textoSimples(obj[chave]);
  if (s === null) return NAO_VEIO;
  if (Number.isNaN(Date.parse(s))) return { veio: 'invalido', motivo: `"${chave}" não é uma data ISO` };
  if (!MOMENTO_COM_FUSO.test(s)) return { veio: 'invalido', motivo: `"${chave}" precisa de fuso (Z ou -03:00)` };
  return { veio: true, valor: s };
}

/** O valor que está no banco é o mesmo que chegou? (número compara em centavos) */
function mesmoValor(atual: unknown, novo: unknown): boolean {
  const a = atual === undefined ? null : atual;
  if (a === null || novo === null) return a === novo;
  if (typeof novo === 'number') {
    const n = typeof a === 'number' ? a : Number(a);
    return Number.isFinite(n) && Math.round(n * 100) === Math.round(novo * 100);
  }
  return a === novo;
}

function mesmoMomento(a: unknown, b: unknown): boolean {
  if (a == null || b == null) return a == null && b == null;
  return Date.parse(String(a)) === Date.parse(String(b));
}

/** "a, b, c" com no máximo CODIGOS_POR_AVISO itens. */
function listar(codigos: Iterable<string>): string {
  const todos = [...codigos];
  const mostrados = todos.slice(0, CODIGOS_POR_AVISO).join(', ');
  return todos.length > CODIGOS_POR_AVISO ? `${mostrados} e mais ${todos.length - CODIGOS_POR_AVISO}` : mostrados;
}

/** Tamanho na grafia das cargas e do faturamento: aparado e em maiúscula. */
const tamanhoNormalizado = (v: unknown): string | null => textoSimples(v)?.toUpperCase() ?? null;

/**
 * O código do produto como o Control escreve, sem espaços e em maiúscula —
 * NÃO é `codigoCanonico`: as variantes guardam "PRODUTO|TAMANHO" com a grafia
 * do Control ("0706", não "00706"), e é por ela que o faturamento casa a peça.
 */
const grafiaDoProduto = (v: unknown): string | null => {
  const s = textoSimples(v);
  return s === null ? null : s.replace(/\s+/g, '').toUpperCase();
};

// ─── O patch de um cadastro que já existe ────────────────────────────────────

/**
 * Compara o que veio com o que está e devolve só o que mudou. `pedido` traz
 * apenas as chaves que vieram; nada fora dele entra.
 */
function diferencas(existente: Record<string, unknown>, pedido: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [coluna, valor] of Object.entries(pedido)) {
    if (!mesmoValor(existente[coluna], valor)) patch[coluna] = valor;
  }
  return patch;
}

/**
 * Fecha o patch: põe o carimbo do Control (`coluna049`, quando a 049 existe) e
 * o `updated_at`. O carimbo entra quando `data_update` veio diferente do
 * guardado, ou quando algo mudou e não veio data (vale agora). Devolve `null`
 * quando não há nada a gravar.
 */
function fecharPatch(
  patch: Record<string, unknown>,
  existente: Record<string, unknown>,
  coluna049: string | null,
  momento: Momento,
  agora: string,
): Record<string, unknown> | null {
  if (coluna049) {
    if (momento.veio === true) {
      if (!mesmoMomento(existente[coluna049], momento.valor)) patch[coluna049] = momento.valor;
    } else if (Object.keys(patch).length > 0) {
      patch[coluna049] = agora;
    }
  }
  if (Object.keys(patch).length === 0) return null;
  patch['updated_at'] = agora;
  return patch;
}

/** O carimbo de um cadastro NOVO: a data que veio, senão agora. */
const carimboNovo = (momento: Momento, agora: string): string => (momento.veio === true ? momento.valor : agora);

// ─── Gravações tolerantes ────────────────────────────────────────────────────

interface ParaInserir {
  codigo: string;
  linha: Record<string, unknown>;
}

/**
 * Insere em lotes; um lote que falha é repetido um a um e só o culpado vira
 * ignorado. Com `devolver`, pede as colunas de volta (o id de quem nasceu).
 */
async function inserirTolerante(
  tabela: string,
  itens: ParaInserir[],
  ignorados: Ignorado[],
  devolver?: string,
): Promise<{ criados: number; devolvidas: Record<string, unknown>[] }> {
  let criados = 0;
  const devolvidas: Record<string, unknown>[] = [];

  const tentar = async (lote: ParaInserir[]): Promise<string | null> => {
    const insercao = supabase.from(tabela).insert(lote.map((i) => i.linha));
    const { data, error } = await (devolver ? insercao.select(devolver) : insercao);
    if (error) return error.message;
    criados += lote.length;
    if (Array.isArray(data)) devolvidas.push(...(data as unknown as Record<string, unknown>[]));
    return null;
  };

  for (const lote of emLotes(itens, LINHAS_POR_LOTE)) {
    const erro = await tentar(lote);
    if (erro === null) continue;
    if (lote.length === 1) {
      ignorados.push({ codigo: lote[0]?.codigo ?? null, motivo: `falha ao gravar: ${erro}` });
      continue;
    }
    for (const item of lote) {
      const erroDoItem = await tentar([item]);
      if (erroDoItem !== null) ignorados.push({ codigo: item.codigo, motivo: `falha ao gravar: ${erroDoItem}` });
    }
  }
  return { criados, devolvidas };
}

/** Um update por linha, sempre pela empresa da chave. Devolve a mensagem do erro, ou null. */
async function atualizar(
  tabela: string,
  company_id: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<string | null> {
  const { error } = await supabase.from(tabela).update(patch).eq('id', id).eq('company_id', company_id);
  return error ? error.message : null;
}

/**
 * Upsert em lotes, um lote por conjunto de chaves — o PostgREST exige as
 * mesmas colunas em todas as linhas do lote, e "campo ausente não apaga"
 * significa que linhas diferentes podem levar colunas diferentes. Lote que
 * falha é repetido um a um. Devolve os itens que o banco aceitou.
 */
async function upsertTolerante(
  tabela: string,
  onConflict: string,
  itens: ParaInserir[],
  ignorados: Ignorado[],
): Promise<ParaInserir[]> {
  const porChaves = new Map<string, ParaInserir[]>();
  for (const item of itens) {
    const assinatura = Object.keys(item.linha).sort().join(',');
    const grupo = porChaves.get(assinatura) ?? [];
    grupo.push(item);
    porChaves.set(assinatura, grupo);
  }

  const gravados: ParaInserir[] = [];
  const tentar = async (lote: ParaInserir[]): Promise<string | null> => {
    const { error } = await supabase.from(tabela).upsert(
      lote.map((i) => i.linha),
      { onConflict },
    );
    if (error) return error.message;
    gravados.push(...lote);
    return null;
  };

  for (const grupo of porChaves.values()) {
    for (const lote of emLotes(grupo, LINHAS_POR_LOTE)) {
      const erro = await tentar(lote);
      if (erro === null) continue;
      if (lote.length === 1) {
        ignorados.push({ codigo: lote[0]?.codigo ?? null, motivo: `falha ao gravar: ${erro}` });
        continue;
      }
      for (const item of lote) {
        const erroDoItem = await tentar([item]);
        if (erroDoItem !== null) ignorados.push({ codigo: item.codigo, motivo: `falha ao gravar: ${erroDoItem}` });
      }
    }
  }
  return gravados;
}

// ─── Índices do que já existe ────────────────────────────────────────────────

/** Linhas por miolo do código; o miolo com duas linhas vai para `repetidos`. */
function indexarPorMiolo<T>(linhas: readonly T[], codigoDe: (l: T) => unknown): { porMiolo: Map<string, T>; repetidos: Set<string> } {
  const porMiolo = new Map<string, T>();
  const repetidos = new Set<string>();
  for (const l of linhas) {
    const m = codigoMiolo(codigoDe(l));
    if (!m) continue;
    if (porMiolo.has(m)) repetidos.add(m);
    else porMiolo.set(m, l);
  }
  return { porMiolo, repetidos };
}

type LinhaProduto = { id: string; erp_id: string | null; sku: string | null } & Record<string, unknown>;

interface IndiceDeProdutos {
  /** Por miolo do `erp_id`. */
  porCodigo: Map<string, LinhaProduto>;
  /** Miolos de `erp_id` com mais de um produto — ninguém casa neles. */
  repetidos: Set<string>;
  /** Os SEM `erp_id` (carga do PDF), por miolo do `sku`: candidatos a adoção. */
  semCodigoPorSku: Map<string, LinhaProduto>;
}

function indexarProdutos(linhas: readonly LinhaProduto[]): IndiceDeProdutos {
  const { porMiolo, repetidos } = indexarPorMiolo(linhas, (p) => p.erp_id);
  const semCodigoPorSku = new Map<string, LinhaProduto>();
  for (const p of linhas) {
    if (codigoMiolo(p.erp_id)) continue;
    const m = codigoMiolo(p.sku);
    if (m && !semCodigoPorSku.has(m)) semCodigoPorSku.set(m, p);
  }
  return { porCodigo: porMiolo, repetidos, semCodigoPorSku };
}

/**
 * O produto de um código do Control: pelo `erp_id`; não achando, pelo `sku`
 * de quem ainda não tem código (o PDF carregou a referência sem o vínculo).
 * `undefined` = não existe; `'ambiguo'` = mais de um cadastro com o código.
 */
function acharProduto(indice: IndiceDeProdutos, miolo: string, mioloDaReferencia?: string | null): LinhaProduto | 'ambiguo' | undefined {
  if (indice.repetidos.has(miolo)) return 'ambiguo';
  const porCodigo = indice.porCodigo.get(miolo);
  if (porCodigo) return porCodigo;
  return (mioloDaReferencia ? indice.semCodigoPorSku.get(mioloDaReferencia) : undefined) ?? indice.semCodigoPorSku.get(miolo);
}

const COLUNAS_DO_PRODUTO_PARA_CASAR = 'id, erp_id, sku';

async function lerProdutos(company_id: string, colunas = COLUNAS_DO_PRODUTO_PARA_CASAR): Promise<LinhaProduto[]> {
  return buscarTudoOuFalhar<LinhaProduto>((de, ate) =>
    supabase.from('products').select(colunas).eq('company_id', company_id).order('id').range(de, ate),
  );
}

const resultadoVazio = (recebidos: number): ResultadoCatalogo => ({
  recebidos,
  criados: 0,
  atualizados: 0,
  sem_mudanca: 0,
  ignorados: [],
  avisos: [],
});

/** O aviso de "ativo" não reconhecido, quando houve algum. */
function avisarAtivosInvalidos(avisos: string[], codigos: Set<string>): void {
  if (codigos.size > 0) {
    avisos.push(`"ativo" não reconhecido (aceito S, N, true ou false) — não foi mexido: ${listar(codigos)}.`);
  }
}

// ─── (a) Tabelas de preço ────────────────────────────────────────────────────

const COLUNAS_DA_TABELA = 'id, erp_code, name, price_column';
const COLUNAS_DA_TABELA_049 = 'erp_description, active, erp_updated_at';

type LinhaTabela = { id: string; erp_code: string | null; name: string; price_column: number | null } & Record<string, unknown>;

/**
 * POST /partner/v1/tabelas-preco. Casa por miolo do `erp_code`; grava o código
 * na grafia única (`codigoCanonico`), a coluna, e com a 049 a descrição do
 * Control, o ativo e o carimbo. `name` nunca é regravado.
 */
export async function receberTabelasDePreco(company_id: string, tabelas: readonly unknown[]): Promise<ResultadoCatalogo> {
  const r = resultadoVazio(tabelas.length);
  const agora = new Date().toISOString();

  // ── 1. Leituras, antes de qualquer gravação.
  const com049 = await detectarOuFalhar('price_tables', 'erp_description');
  const colunas = com049 ? `${COLUNAS_DA_TABELA}, ${COLUNAS_DA_TABELA_049}` : COLUNAS_DA_TABELA;
  const existentes = await buscarTudoOuFalhar<LinhaTabela>((de, ate) =>
    supabase.from('price_tables').select(colunas).eq('company_id', company_id).order('id').range(de, ate),
  );
  const { porMiolo, repetidos } = indexarPorMiolo(existentes, (t) => t.erp_code);

  // ── 2. Decide, registro a registro.
  const paraInserir: ParaInserir[] = [];
  const paraAtualizar: Array<{ codigo: string; id: string; patch: Record<string, unknown> }> = [];
  const vistosNoLote = new Set<string>();
  const semColuna = new Set<string>();
  const ativosInvalidos = new Set<string>();
  let precisamDa049 = false;

  for (const raw of tabelas) {
    if (!ehObjeto(raw)) {
      r.ignorados.push({ codigo: null, motivo: 'registro inválido' });
      continue;
    }
    const codigo = textoSimples(raw['codigo']);
    const miolo = codigoMiolo(codigo);
    if (!codigo || !miolo) {
      r.ignorados.push({ codigo, motivo: 'sem código do ERP' });
      continue;
    }
    if (vistosNoLote.has(miolo)) {
      r.ignorados.push({ codigo, motivo: 'código repetido no lote' });
      continue;
    }
    vistosNoLote.add(miolo);
    if (repetidos.has(miolo)) {
      r.ignorados.push({ codigo, motivo: 'código com mais de uma tabela no app' });
      continue;
    }
    const coluna = lerInteiro(raw, 'coluna', 1, 6);
    if (coluna.veio === 'invalido' || (coluna.veio === true && coluna.valor === null)) {
      r.ignorados.push({ codigo, motivo: '"coluna" precisa ser um inteiro de 1 a 6' });
      continue;
    }
    const momento = lerMomento(raw, 'data_update');
    if (momento.veio === 'invalido') {
      r.ignorados.push({ codigo, motivo: momento.motivo });
      continue;
    }
    const descricao = lerTexto(raw, 'descricao');
    const ativo = lerSimNao(raw, 'ativo');
    if (ativo === 'invalido') ativosInvalidos.add(codigo);

    const existente = porMiolo.get(miolo);
    if (existente) {
      const pedido: Record<string, unknown> = {};
      // Uma grafia só no banco: "1" e "#00001" gravam "00001".
      const canonico = codigoCanonico(codigo);
      if (canonico && canonico !== existente.erp_code) pedido['erp_code'] = canonico;
      if (coluna.veio) pedido['price_column'] = coluna.valor;
      if (com049) {
        if (descricao.veio) pedido['erp_description'] = descricao.valor;
        if (typeof ativo === 'boolean') pedido['active'] = ativo;
      } else if (descricao.veio || typeof ativo === 'boolean' || momento.veio === true) {
        precisamDa049 = true;
      }
      const patch = fecharPatch(diferencas(existente, pedido), existente, com049 ? 'erp_updated_at' : null, momento, agora);
      if (!patch) {
        r.sem_mudanca++;
        continue;
      }
      paraAtualizar.push({ codigo, id: existente.id, patch });
    } else {
      if (!coluna.veio) semColuna.add(codigo);
      const linha: Record<string, unknown> = {
        company_id,
        erp_code: codigoCanonico(codigo),
        // O nome do app nasce da descrição do Control e daí em diante é do app.
        name: valorDe(descricao) ?? `Tabela ${codigo}`,
        price_column: coluna.veio ? coluna.valor : 1,
        updated_at: agora,
      };
      if (com049) {
        linha['erp_description'] = valorDe(descricao);
        linha['active'] = typeof ativo === 'boolean' ? ativo : true;
        linha['erp_updated_at'] = carimboNovo(momento, agora);
      } else if (ativo === false || momento.veio === true) {
        precisamDa049 = true;
      }
      paraInserir.push({ codigo, linha });
    }
  }

  // ── 3. Gravações.
  r.criados = (await inserirTolerante('price_tables', paraInserir, r.ignorados)).criados;
  for (const u of paraAtualizar) {
    const erro = await atualizar('price_tables', company_id, u.id, u.patch);
    if (erro !== null) r.ignorados.push({ codigo: u.codigo, motivo: `falha ao gravar: ${erro}` });
    else r.atualizados++;
  }

  // ── 4. Avisos.
  if (semColuna.size > 0) {
    r.avisos.push(`Tabela nova sem "coluna" — gravada com a coluna 1; mande a coluna certa: ${listar(semColuna)}.`);
  }
  avisarAtivosInvalidos(r.avisos, ativosInvalidos);
  if (precisamDa049) r.avisos.push(AVISO_SEM_049.tabelas);
  return r;
}

// ─── (b) Condições de pagamento ──────────────────────────────────────────────

const COLUNAS_DA_CONDICAO = 'id, code, description, active';
const COLUNAS_DA_CONDICAO_049 = 'erp_description, valor_minimo, erp_updated_at';

type LinhaCondicao = { id: string; code: number | string | null; description: string; active: boolean | null } & Record<string, unknown>;

/**
 * POST /partner/v1/condicoes-pagamento. O código do Control é inteiro
 * (`payment_conditions.code`); casa pelo miolo ("015" = 15). Grava ativo e,
 * com a 049, a descrição do Control, o valor mínimo e o carimbo.
 * `description` nunca é regravada.
 */
export async function receberCondicoesDePagamento(company_id: string, condicoes: readonly unknown[]): Promise<ResultadoCatalogo> {
  const r = resultadoVazio(condicoes.length);
  const agora = new Date().toISOString();

  const com049 = await detectarOuFalhar('payment_conditions', 'erp_description');
  const colunas = com049 ? `${COLUNAS_DA_CONDICAO}, ${COLUNAS_DA_CONDICAO_049}` : COLUNAS_DA_CONDICAO;
  const existentes = await buscarTudoOuFalhar<LinhaCondicao>((de, ate) =>
    supabase.from('payment_conditions').select(colunas).eq('company_id', company_id).order('id').range(de, ate),
  );
  const porCodigo = new Map<number, LinhaCondicao>();
  const repetidos = new Set<number>();
  for (const c of existentes) {
    const n = Number(c.code);
    if (!Number.isInteger(n)) continue;
    if (porCodigo.has(n)) repetidos.add(n);
    else porCodigo.set(n, c);
  }

  const paraInserir: ParaInserir[] = [];
  const paraAtualizar: Array<{ codigo: string; id: string; patch: Record<string, unknown> }> = [];
  const vistosNoLote = new Set<number>();
  const ativosInvalidos = new Set<string>();
  const minimosInvalidos = new Set<string>();
  let precisamDa049 = false;

  for (const raw of condicoes) {
    if (!ehObjeto(raw)) {
      r.ignorados.push({ codigo: null, motivo: 'registro inválido' });
      continue;
    }
    const codigo = textoSimples(raw['codigo']);
    const miolo = codigoMiolo(codigo);
    if (!codigo || !miolo) {
      r.ignorados.push({ codigo, motivo: 'sem código do ERP' });
      continue;
    }
    if (!/^\d+$/.test(miolo)) {
      r.ignorados.push({ codigo, motivo: 'código da condição precisa ser numérico' });
      continue;
    }
    const code = Number(miolo);
    if (vistosNoLote.has(code)) {
      r.ignorados.push({ codigo, motivo: 'código repetido no lote' });
      continue;
    }
    vistosNoLote.add(code);
    if (repetidos.has(code)) {
      r.ignorados.push({ codigo, motivo: 'código com mais de uma condição no app' });
      continue;
    }
    const momento = lerMomento(raw, 'data_update');
    if (momento.veio === 'invalido') {
      r.ignorados.push({ codigo, motivo: momento.motivo });
      continue;
    }
    const descricao = lerTexto(raw, 'descricao');
    const ativo = lerSimNao(raw, 'ativo');
    if (ativo === 'invalido') ativosInvalidos.add(codigo);
    const minimo = lerValor(raw, 'valor_minimo', 0);
    if (minimo.veio === 'invalido') minimosInvalidos.add(codigo);

    const existente = porCodigo.get(code);
    if (existente) {
      const pedido: Record<string, unknown> = {};
      if (typeof ativo === 'boolean') pedido['active'] = ativo;
      if (com049) {
        if (descricao.veio) pedido['erp_description'] = descricao.valor;
        if (minimo.veio === true) pedido['valor_minimo'] = minimo.valor;
      } else if (descricao.veio || minimo.veio === true || momento.veio === true) {
        precisamDa049 = true;
      }
      const patch = fecharPatch(diferencas(existente, pedido), existente, com049 ? 'erp_updated_at' : null, momento, agora);
      if (!patch) {
        r.sem_mudanca++;
        continue;
      }
      paraAtualizar.push({ codigo, id: existente.id, patch });
    } else {
      const texto = valorDe(descricao);
      if (texto === null) {
        r.ignorados.push({ codigo, motivo: 'sem descrição' });
        continue;
      }
      const linha: Record<string, unknown> = {
        company_id,
        code,
        description: texto,
        active: typeof ativo === 'boolean' ? ativo : true,
        updated_at: agora,
      };
      if (com049) {
        linha['erp_description'] = texto;
        linha['valor_minimo'] = minimo.veio === true ? minimo.valor : null;
        linha['erp_updated_at'] = carimboNovo(momento, agora);
      } else if (minimo.veio === true || momento.veio === true) {
        precisamDa049 = true;
      }
      paraInserir.push({ codigo, linha });
    }
  }

  r.criados = (await inserirTolerante('payment_conditions', paraInserir, r.ignorados)).criados;
  for (const u of paraAtualizar) {
    const erro = await atualizar('payment_conditions', company_id, u.id, u.patch);
    if (erro !== null) r.ignorados.push({ codigo: u.codigo, motivo: `falha ao gravar: ${erro}` });
    else r.atualizados++;
  }

  avisarAtivosInvalidos(r.avisos, ativosInvalidos);
  if (minimosInvalidos.size > 0) {
    r.avisos.push(`"valor_minimo" negativo ou ilegível — não foi mexido: ${listar(minimosInvalidos)}.`);
  }
  if (precisamDa049) r.avisos.push(AVISO_SEM_049.condicoes);
  return r;
}

// ─── (c) Produtos e tamanhos ─────────────────────────────────────────────────

const COLUNAS_DO_PRODUTO = 'id, erp_id, sku, name, collection, brand, group_name, active';
const COLUNAS_DO_PRODUTO_049 = 'erp_updated_at';
const COLUNAS_DO_TAMANHO = 'id, product_id, size, active';

type LinhaTamanho = { id: string; product_id: string; size: string | null; active: boolean | null };

interface TamanhoLido {
  tamanho: string;
  ativo: boolean | undefined;
}

/** A grade que veio: ausente/null não mexe; entrada sem tamanho é pulada (com aviso). */
function lerTamanhos(raw: Record<string, unknown>): { veio: false } | { veio: true; lista: TamanhoLido[]; pulados: number } {
  if (!tem(raw, 'tamanhos') || raw['tamanhos'] === null) return NAO_VEIO;
  const bruto = raw['tamanhos'];
  if (!Array.isArray(bruto)) return { veio: true, lista: [], pulados: 1 };
  const entradas: unknown[] = bruto;
  const lista: TamanhoLido[] = [];
  const vistos = new Set<string>();
  let pulados = 0;
  for (const item of entradas) {
    const obj = ehObjeto(item) ? item : { tamanho: item };
    const tamanho = tamanhoNormalizado(obj['tamanho']);
    if (!tamanho || vistos.has(tamanho)) {
      pulados++;
      continue;
    }
    vistos.add(tamanho);
    const ativo = lerSimNao(obj, 'ativo');
    lista.push({ tamanho, ativo: ativo === 'invalido' ? undefined : ativo });
  }
  return { veio: true, lista, pulados };
}

/**
 * POST /partner/v1/produtos. Produto por miolo do `erp_id` (adotando pelo
 * `sku` quem veio do PDF sem código); tamanhos por (produto, tamanho), criando
 * os que faltam com `erp_sku` = "PRODUTO|TAMANHO". Nunca toca em `image_url`,
 * `description`, cores ou `variant_group`; `sku` só é preenchido se estiver
 * vazio; tamanho que não veio não é desativado.
 */
export async function receberProdutos(company_id: string, produtos: readonly unknown[]): Promise<ResultadoProdutos> {
  const r: ResultadoProdutos = { ...resultadoVazio(produtos.length), tamanhos_criados: 0, tamanhos_atualizados: 0 };
  const agora = new Date().toISOString();

  // ── 1. Leituras.
  const com049 = await detectarOuFalhar('products', 'erp_updated_at');
  const colunas = com049 ? `${COLUNAS_DO_PRODUTO}, ${COLUNAS_DO_PRODUTO_049}` : COLUNAS_DO_PRODUTO;
  const indice = indexarProdutos(await lerProdutos(company_id, colunas));
  const tamanhosExistentes = await buscarTudoOuFalhar<LinhaTamanho>((de, ate) =>
    supabase.from('product_variants').select(COLUNAS_DO_TAMANHO).eq('company_id', company_id).order('id').range(de, ate),
  );
  const tamanhoPorChave = new Map<string, LinhaTamanho>();
  for (const t of tamanhosExistentes) {
    const chave = `${t.product_id}|${tamanhoNormalizado(t.size) ?? ''}`;
    if (!tamanhoPorChave.has(chave)) tamanhoPorChave.set(chave, t);
  }

  // ── 2. Decide produto a produto; a grade fica anotada para depois dos ids.
  interface Grade {
    codigo: string;
    /** O código na grafia gravada em `erp_id` — o prefixo do `erp_sku`. */
    prefixo: string;
    product_id: string | null;
    tamanhos: TamanhoLido[];
    /** O produto em si mudou (ou nasceu)? Para contar atualizado × sem mudança. */
    mudou: boolean;
  }
  const paraInserir: ParaInserir[] = [];
  const paraAtualizar: Array<{ codigo: string; id: string; patch: Record<string, unknown> }> = [];
  const grades: Grade[] = [];
  const vistosNoLote = new Set<string>();
  const ativosInvalidos = new Set<string>();
  const tamanhosPulados = new Set<string>();
  let adotados = 0;
  let precisamDa049 = false;

  for (const raw of produtos) {
    if (!ehObjeto(raw)) {
      r.ignorados.push({ codigo: null, motivo: 'registro inválido' });
      continue;
    }
    const codigo = grafiaDoProduto(raw['codigo']);
    const miolo = codigoMiolo(codigo);
    if (!codigo || !miolo) {
      r.ignorados.push({ codigo, motivo: 'sem código do ERP' });
      continue;
    }
    if (vistosNoLote.has(miolo)) {
      r.ignorados.push({ codigo, motivo: 'código repetido no lote' });
      continue;
    }
    vistosNoLote.add(miolo);
    const momento = lerMomento(raw, 'data_update');
    if (momento.veio === 'invalido') {
      r.ignorados.push({ codigo, motivo: momento.motivo });
      continue;
    }
    const referencia = grafiaDoProduto(raw['referencia']);
    const achado = acharProduto(indice, miolo, codigoMiolo(referencia));
    if (achado === 'ambiguo') {
      r.ignorados.push({ codigo, motivo: 'código com mais de um produto no app' });
      continue;
    }
    const nome = lerTexto(raw, 'nome');
    const ativo = lerSimNao(raw, 'ativo');
    if (ativo === 'invalido') ativosInvalidos.add(codigo);
    const grade = lerTamanhos(raw);
    if (grade.veio && grade.pulados > 0) tamanhosPulados.add(codigo);
    const tamanhos = grade.veio ? grade.lista : [];

    const pedido: Record<string, unknown> = {};
    // `name` é NOT NULL: `null` não limpa, só texto troca.
    if (nome.veio && nome.valor !== null) pedido['name'] = nome.valor;
    for (const [campo, coluna] of [
      ['grupo', 'group_name'],
      ['colecao', 'collection'],
      ['marca', 'brand'],
    ] as const) {
      const lido = lerTexto(raw, campo);
      if (lido.veio) pedido[coluna] = lido.valor;
    }
    if (typeof ativo === 'boolean') pedido['active'] = ativo;
    if (!com049 && momento.veio === true) precisamDa049 = true;

    if (achado) {
      const existente = achado;
      const adotado = !codigoMiolo(existente.erp_id);
      const patch = diferencas(existente, pedido);
      // Quem veio do PDF aprende o código; quem já tem código nunca o troca.
      if (adotado) patch['erp_id'] = codigo;
      // `sku` só quando está vazio — é a chave que as telas e o CRM usam.
      if (!textoSimples(existente.sku)) patch['sku'] = referencia ?? codigo;
      const fechado = fecharPatch(patch, existente, com049 ? 'erp_updated_at' : null, momento, agora);
      const prefixo = adotado ? codigo : (textoSimples(existente.erp_id) ?? codigo);
      grades.push({ codigo, prefixo, product_id: existente.id, tamanhos, mudou: fechado !== null });
      if (fechado) {
        if (adotado) adotados++;
        paraAtualizar.push({ codigo, id: existente.id, patch: fechado });
      }
    } else {
      if (pedido['name'] === undefined) {
        r.ignorados.push({ codigo, motivo: 'sem nome' });
        continue;
      }
      // Linha completa, com as mesmas chaves em todas (o insert em lote grava
      // NULL — não o padrão — na chave que falta numa e existe noutra).
      const linha: Record<string, unknown> = {
        company_id,
        erp_id: codigo,
        sku: referencia ?? codigo,
        name: pedido['name'],
        group_name: pedido['group_name'] ?? null,
        collection: pedido['collection'] ?? null,
        brand: pedido['brand'] ?? null,
        active: typeof ativo === 'boolean' ? ativo : true,
        updated_at: agora,
      };
      if (com049) linha['erp_updated_at'] = carimboNovo(momento, agora);
      paraInserir.push({ codigo, linha });
      grades.push({ codigo, prefixo: codigo, product_id: null, tamanhos, mudou: true });
    }
  }

  // ── 3. Grava os produtos. O insert devolve os ids: a grade precisa deles.
  const inseridos = await inserirTolerante('products', paraInserir, r.ignorados, 'id, erp_id');
  r.criados = inseridos.criados;
  const idPorCodigo = new Map<string, string>();
  for (const linha of inseridos.devolvidas) {
    if (typeof linha['id'] === 'string' && typeof linha['erp_id'] === 'string') idPorCodigo.set(linha['erp_id'], linha['id']);
  }
  const falharam = new Set(r.ignorados.map((i) => i.codigo));
  for (const u of paraAtualizar) {
    const erro = await atualizar('products', company_id, u.id, u.patch);
    if (erro !== null) {
      r.ignorados.push({ codigo: u.codigo, motivo: `falha ao gravar: ${erro}` });
      falharam.add(u.codigo);
    }
  }

  // ── 4. A grade: tamanho novo nasce; existente só troca o ativo.
  const tamanhosParaInserir: ParaInserir[] = [];
  const tamanhosParaAtualizar: Array<{ codigo: string; id: string; patch: Record<string, unknown>; grade: Grade }> = [];
  const semId = new Set<string>();
  for (const grade of grades) {
    if (falharam.has(grade.codigo)) continue;
    const product_id = grade.product_id ?? idPorCodigo.get(grade.codigo) ?? null;
    if (!product_id) {
      if (grade.tamanhos.length > 0) semId.add(grade.codigo);
      continue;
    }
    for (const t of grade.tamanhos) {
      const existente = tamanhoPorChave.get(`${product_id}|${t.tamanho}`);
      if (existente) {
        if (t.ativo !== undefined && t.ativo !== existente.active) {
          tamanhosParaAtualizar.push({ codigo: grade.codigo, id: existente.id, patch: { active: t.ativo, updated_at: agora }, grade });
        }
        continue;
      }
      tamanhosParaInserir.push({
        codigo: grade.codigo,
        linha: {
          company_id,
          product_id,
          erp_sku: `${grade.prefixo}|${t.tamanho}`,
          size: t.tamanho,
          stock_quantity: 0,
          stock_committed: 0,
          active: t.ativo ?? true,
          updated_at: agora,
        },
      });
      grade.mudou = true;
    }
  }
  const avisosDaGrade: Ignorado[] = [];
  r.tamanhos_criados = (await inserirTolerante('product_variants', tamanhosParaInserir, avisosDaGrade)).criados;
  for (const u of tamanhosParaAtualizar) {
    const erro = await atualizar('product_variants', company_id, u.id, u.patch);
    if (erro !== null) avisosDaGrade.push({ codigo: u.codigo, motivo: erro });
    else {
      r.tamanhos_atualizados++;
      u.grade.mudou = true;
    }
  }

  // ── 5. Contagens e avisos.
  for (const grade of grades) {
    if (falharam.has(grade.codigo) || !grade.product_id) continue; // criados já contados
    if (grade.mudou) r.atualizados++;
    else r.sem_mudanca++;
  }
  if (avisosDaGrade.length > 0) {
    r.avisos.push(
      `Tamanho que não deu para gravar (o produto foi gravado): ${listar(avisosDaGrade.map((a) => `${a.codigo ?? '?'} (${a.motivo})`))}.`,
    );
  }
  if (semId.size > 0) {
    r.avisos.push(`O banco não devolveu o id do produto novo — a grade dele fica para o próximo envio: ${listar(semId)}.`);
  }
  if (tamanhosPulados.size > 0) {
    r.avisos.push(`Entrada de "tamanhos" sem tamanho (ou repetida) foi pulada: ${listar(tamanhosPulados)}.`);
  }
  if (adotados > 0) {
    r.avisos.push(`${adotados} produto(s) já existiam sem código (carga do catálogo) e aprenderam o código do Control.`);
  }
  avisarAtivosInvalidos(r.avisos, ativosInvalidos);
  if (precisamDa049) r.avisos.push(AVISO_SEM_049.produtos);
  return r;
}

// ─── (d) Preço por tabela ────────────────────────────────────────────────────

const COLUNAS_DO_PRECO = 'product_id, price_table_id, price';
const COLUNAS_DO_PRECO_049 = 'preco_original, desconto_percentual, erp_updated_at';

type LinhaPreco = { product_id: string; price_table_id: string; price: number | string | null } & Record<string, unknown>;

/**
 * POST /partner/v1/precos. Upsert em `product_prices` por (produto, tabela):
 * o preço do Control SOBRESCREVE o que estava (o do PDF inclusive). Com a 049
 * guarda também o preço original, o desconto e o carimbo. `price_larger` e
 * `variant_id` não são tocados. Tabela ou produto que o app não tem → ignorado.
 */
export async function receberPrecos(company_id: string, precos: readonly unknown[]): Promise<ResultadoCatalogo> {
  const r = resultadoVazio(precos.length);
  const agora = new Date().toISOString();

  // ── 1. Leituras dos cadastros que o preço aponta.
  const com049 = await detectarOuFalhar('product_prices', 'erp_updated_at');
  const tabelas = await buscarTudoOuFalhar<{ id: string; erp_code: string | null }>((de, ate) =>
    supabase.from('price_tables').select('id, erp_code').eq('company_id', company_id).order('id').range(de, ate),
  );
  const indiceDeTabelas = indexarPorMiolo(tabelas, (t) => t.erp_code);
  const indice = indexarProdutos(await lerProdutos(company_id));

  // ── 2. Lê cada registro e resolve os ids.
  interface PrecoLido {
    codigo: string;
    product_id: string;
    price_table_id: string;
    preco: number;
    original: RecebidoOuInvalido<number>;
    desconto: RecebidoOuInvalido<number>;
    momento: Momento;
  }
  const lidos: PrecoLido[] = [];
  const vistosNoLote = new Set<string>();
  const originaisInvalidos = new Set<string>();
  const descontosInvalidos = new Set<string>();
  const tabelasNaoAchadas = new Set<string>();
  const produtosNaoAchados = new Set<string>();
  let precisamDa049 = false;

  for (const raw of precos) {
    if (!ehObjeto(raw)) {
      r.ignorados.push({ codigo: null, motivo: 'registro inválido' });
      continue;
    }
    const produto = grafiaDoProduto(raw['produto']);
    const tabela = textoSimples(raw['tabela']);
    const mioloDoProduto = codigoMiolo(produto);
    const mioloDaTabela = codigoMiolo(tabela);
    if (!produto || !mioloDoProduto) {
      r.ignorados.push({ codigo: produto, motivo: 'sem código do produto' });
      continue;
    }
    if (!tabela || !mioloDaTabela) {
      r.ignorados.push({ codigo: produto, motivo: 'sem código da tabela' });
      continue;
    }
    const chaveNoLote = `${mioloDaTabela}|${mioloDoProduto}`;
    if (vistosNoLote.has(chaveNoLote)) {
      r.ignorados.push({ codigo: produto, motivo: `repetido no lote (tabela ${tabela})` });
      continue;
    }
    vistosNoLote.add(chaveNoLote);
    const preco = lerValor(raw, 'preco', 0);
    if (preco.veio !== true || preco.valor === null || preco.valor <= 0) {
      r.ignorados.push({ codigo: produto, motivo: '"preco" precisa ser um número maior que zero' });
      continue;
    }
    const momento = lerMomento(raw, 'data_update');
    if (momento.veio === 'invalido') {
      r.ignorados.push({ codigo: produto, motivo: momento.motivo });
      continue;
    }
    if (indiceDeTabelas.repetidos.has(mioloDaTabela)) {
      r.ignorados.push({ codigo: produto, motivo: `tabela ${tabela} com mais de um cadastro no app` });
      continue;
    }
    const tabelaAchada = indiceDeTabelas.porMiolo.get(mioloDaTabela);
    if (!tabelaAchada) {
      tabelasNaoAchadas.add(tabela);
      r.ignorados.push({ codigo: produto, motivo: `tabela ${tabela} não encontrada no app` });
      continue;
    }
    const produtoAchado = acharProduto(indice, mioloDoProduto);
    if (produtoAchado === 'ambiguo') {
      r.ignorados.push({ codigo: produto, motivo: 'produto com mais de um cadastro no app' });
      continue;
    }
    if (!produtoAchado) {
      produtosNaoAchados.add(produto);
      r.ignorados.push({ codigo: produto, motivo: 'produto não encontrado no app' });
      continue;
    }
    const original = lerValor(raw, 'preco_original', 0);
    if (original.veio === 'invalido') originaisInvalidos.add(produto);
    const desconto = lerValor(raw, 'desconto_percentual', 0, 100);
    if (desconto.veio === 'invalido') descontosInvalidos.add(produto);
    if (!com049 && (original.veio === true || desconto.veio === true || momento.veio === true)) precisamDa049 = true;

    lidos.push({
      codigo: produto,
      product_id: produtoAchado.id,
      price_table_id: tabelaAchada.id,
      preco: preco.valor,
      original,
      desconto,
      momento,
    });
  }

  // ── 3. O que já está gravado, só das tabelas envolvidas.
  const existentes = new Map<string, LinhaPreco>();
  const tabelasEnvolvidas = [...new Set(lidos.map((l) => l.price_table_id))];
  if (tabelasEnvolvidas.length > 0) {
    const colunas = com049 ? `${COLUNAS_DO_PRECO}, ${COLUNAS_DO_PRECO_049}` : COLUNAS_DO_PRECO;
    const linhas = await buscarTudoOuFalhar<LinhaPreco>((de, ate) =>
      supabase
        .from('product_prices')
        .select(colunas)
        .eq('company_id', company_id)
        .in('price_table_id', tabelasEnvolvidas)
        .order('id')
        .range(de, ate),
    );
    for (const l of linhas) existentes.set(`${l.product_id}|${l.price_table_id}`, l);
  }

  // ── 4. Decide e grava por upsert.
  const paraGravar: ParaInserir[] = [];
  const novos = new Set<ParaInserir>();
  for (const l of lidos) {
    const existente = existentes.get(`${l.product_id}|${l.price_table_id}`);
    const pedido: Record<string, unknown> = { price: l.preco };
    if (com049) {
      if (l.original.veio === true) pedido['preco_original'] = l.original.valor;
      if (l.desconto.veio === true) pedido['desconto_percentual'] = l.desconto.valor;
    }
    if (existente) {
      const patch = fecharPatch(diferencas(existente, pedido), existente, com049 ? 'erp_updated_at' : null, l.momento, agora);
      if (!patch) {
        r.sem_mudanca++;
        continue;
      }
      // O upsert leva a chave inteira; do resto, só o que mudou.
      paraGravar.push({ codigo: l.codigo, linha: { company_id, product_id: l.product_id, price_table_id: l.price_table_id, ...patch } });
    } else {
      const linha: Record<string, unknown> = { company_id, product_id: l.product_id, price_table_id: l.price_table_id, ...pedido, updated_at: agora };
      if (com049) linha['erp_updated_at'] = carimboNovo(l.momento, agora);
      const item = { codigo: l.codigo, linha };
      paraGravar.push(item);
      novos.add(item);
    }
  }
  const gravados = await upsertTolerante('product_prices', 'product_id,price_table_id', paraGravar, r.ignorados);
  r.criados = gravados.filter((g) => novos.has(g)).length;
  r.atualizados = gravados.length - r.criados;

  // ── 5. Avisos.
  if (tabelasNaoAchadas.size > 0) {
    r.avisos.push(`Tabela de preço sem cadastro no app (mande-a em POST /partner/v1/tabelas-preco): ${listar(tabelasNaoAchadas)}.`);
  }
  if (produtosNaoAchados.size > 0) {
    r.avisos.push(`Produto sem cadastro no app (mande-o em POST /partner/v1/produtos): ${listar(produtosNaoAchados)}.`);
  }
  if (originaisInvalidos.size > 0) {
    r.avisos.push(`"preco_original" negativo ou ilegível — não foi mexido: ${listar(originaisInvalidos)}.`);
  }
  if (descontosInvalidos.size > 0) {
    r.avisos.push(`"desconto_percentual" fora de 0 a 100 ou ilegível — não foi mexido: ${listar(descontosInvalidos)}.`);
  }
  if (precisamDa049) r.avisos.push(AVISO_SEM_049.precos);
  return r;
}

// ─── (e) Estoque ─────────────────────────────────────────────────────────────

const COLUNAS_DO_ESTOQUE = 'id, product_id, erp_sku, size, stock_quantity, stock_committed';
const COLUNAS_DO_ESTOQUE_049 = 'stock_updated_at';

type LinhaEstoque = {
  id: string;
  product_id: string;
  erp_sku: string;
  size: string | null;
  stock_quantity: number | string | null;
  stock_committed: number | string | null;
} & Record<string, unknown>;

/**
 * POST /partner/v1/estoque. Sobrescreve `stock_quantity` (e `stock_committed`
 * quando `reservado` vem) da variante (produto, tamanho); com a 049 carimba
 * `stock_updated_at`. Variante que o app não tem → ignorado (a grade nasce
 * em POST /produtos). Upsert por (company_id, erp_sku), só de quem mudou.
 */
export async function receberEstoque(company_id: string, estoque: readonly unknown[]): Promise<ResultadoCatalogo> {
  const r = resultadoVazio(estoque.length);
  const agora = new Date().toISOString();

  const com049 = await detectarOuFalhar('product_variants', 'stock_updated_at');
  const indice = indexarProdutos(await lerProdutos(company_id));
  const colunas = com049 ? `${COLUNAS_DO_ESTOQUE}, ${COLUNAS_DO_ESTOQUE_049}` : COLUNAS_DO_ESTOQUE;
  const variantes = await buscarTudoOuFalhar<LinhaEstoque>((de, ate) =>
    supabase.from('product_variants').select(colunas).eq('company_id', company_id).order('id').range(de, ate),
  );
  const variantePorChave = new Map<string, LinhaEstoque>();
  for (const v of variantes) {
    const chave = `${v.product_id}|${tamanhoNormalizado(v.size) ?? ''}`;
    if (!variantePorChave.has(chave)) variantePorChave.set(chave, v);
  }

  const paraGravar: ParaInserir[] = [];
  const vistosNoLote = new Set<string>();
  const produtosNaoAchados = new Set<string>();
  const tamanhosNaoAchados = new Set<string>();

  for (const raw of estoque) {
    if (!ehObjeto(raw)) {
      r.ignorados.push({ codigo: null, motivo: 'registro inválido' });
      continue;
    }
    const produto = grafiaDoProduto(raw['produto']);
    const tamanho = tamanhoNormalizado(raw['tamanho']);
    const miolo = codigoMiolo(produto);
    const codigo = produto && tamanho ? `${produto}|${tamanho}` : produto;
    if (!produto || !miolo) {
      r.ignorados.push({ codigo, motivo: 'sem código do produto' });
      continue;
    }
    if (!tamanho) {
      r.ignorados.push({ codigo, motivo: 'sem tamanho' });
      continue;
    }
    const chaveNoLote = `${miolo}|${tamanho}`;
    if (vistosNoLote.has(chaveNoLote)) {
      r.ignorados.push({ codigo, motivo: 'repetido no lote' });
      continue;
    }
    vistosNoLote.add(chaveNoLote);
    const quantidade = lerInteiro(raw, 'quantidade');
    if (quantidade.veio !== true || quantidade.valor === null) {
      r.ignorados.push({ codigo, motivo: '"quantidade" precisa ser um número inteiro' });
      continue;
    }
    const reservado = lerInteiro(raw, 'reservado');
    if (reservado.veio === 'invalido') {
      r.ignorados.push({ codigo, motivo: '"reservado" precisa ser um número inteiro' });
      continue;
    }
    const produtoAchado = acharProduto(indice, miolo);
    if (produtoAchado === 'ambiguo') {
      r.ignorados.push({ codigo, motivo: 'produto com mais de um cadastro no app' });
      continue;
    }
    if (!produtoAchado) {
      produtosNaoAchados.add(produto);
      r.ignorados.push({ codigo, motivo: 'produto não encontrado no app' });
      continue;
    }
    const variante = variantePorChave.get(`${produtoAchado.id}|${tamanho}`);
    if (!variante) {
      tamanhosNaoAchados.add(codigo ?? produto);
      r.ignorados.push({ codigo, motivo: 'tamanho não encontrado na grade do app' });
      continue;
    }

    const pedido: Record<string, unknown> = { stock_quantity: quantidade.valor };
    // `null` zera: a coluna é NOT NULL com padrão 0.
    if (reservado.veio === true) pedido['stock_committed'] = reservado.valor ?? 0;
    const patch = diferencas(variante, pedido);
    if (Object.keys(patch).length === 0) {
      r.sem_mudanca++;
      continue;
    }
    // O upsert leva a chave e as colunas NOT NULL da variante como estão.
    const linha: Record<string, unknown> = {
      company_id,
      erp_sku: variante.erp_sku,
      product_id: variante.product_id,
      size: variante.size ?? tamanho,
      stock_quantity: quantidade.valor,
      stock_committed: reservado.veio === true ? (reservado.valor ?? 0) : (Number(variante.stock_committed) || 0),
      updated_at: agora,
    };
    if (com049) linha['stock_updated_at'] = agora;
    paraGravar.push({ codigo: codigo ?? produto, linha });
  }

  r.atualizados = (await upsertTolerante('product_variants', 'company_id,erp_sku', paraGravar, r.ignorados)).length;

  if (produtosNaoAchados.size > 0) {
    r.avisos.push(`Produto sem cadastro no app (mande-o em POST /partner/v1/produtos): ${listar(produtosNaoAchados)}.`);
  }
  if (tamanhosNaoAchados.size > 0) {
    r.avisos.push(`Tamanho fora da grade do app (mande a grade em POST /partner/v1/produtos): ${listar(tamanhosNaoAchados)}.`);
  }
  if (!com049 && r.atualizados > 0) r.avisos.push(AVISO_SEM_049.estoque);
  return r;
}
