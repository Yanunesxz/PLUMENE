/**
 * Recebe o RETRATO do cliente que o Control empurra (POST /partner/v1/retrato).
 *
 * Até aqui a última compra, o R$ total comprado e o R$ vencido de cada cliente
 * vinham da carga do relatório Curva ABC (036), à mão. Com o canal de retrato
 * em 'api' o Control manda isto direto, uma vez por dia (decisão do Yan,
 * 16/09/2026) — e ainda a pendência financeira (R$ em aberto) e quantos
 * títulos estão vencidos (049). É o que pinta a carteira do representante e o
 * que avisa o financeiro; bloqueio do Control NÃO trava ninguém.
 *
 * Regras (as mesmas mãos dos outros POSTs, com duas particularidades):
 *
 *   • o cliente é achado PRIMEIRO pelo CNPJ (só dígitos) e DEPOIS pelo código
 *     do ERP (miolo) — a chave entre os sistemas é o CNPJ;
 *   • `referencia` é obrigatória e COM fuso: é de quando é o retrato. Fica em
 *     customers.retrato_referencia_em, para a tela dizer "retrato de 16/09" e
 *     um retrato velho nunca enganar. Retrato mais antigo que o guardado é
 *     recusado (motivo), reenviar o mesmo é `sem_mudanca`;
 *   • a última compra só anda PARA FRENTE: o faturamento no app já a empurra, e
 *     um retrato do Control não pode rejuvenescer o cliente. Aceita a data
 *     (AAAA-MM-DD) ou um momento com fuso (vira o dia em Brasília);
 *   • campo ausente não mexe; `null` explícito limpa; registro com valor
 *     ilegível ou negativo é recusado INTEIRO (o Control corrige e reenvia);
 *   • grava só o que mudou, com updated_at (e erp_updated_at, o carimbo da
 *     última mão do Control — é o que tira o cliente do GET ?desde= quando
 *     ninguém mexeu nele depois). O carimbo é o momento de CADA gravação e só
 *     é regravado quando a última mão já era a do Control: se o app mexeu no
 *     cadastro e o Control ainda não puxou, o retrato não esconde essa
 *     mudança do GET (partner.eco.ts). Sem mudança, nada vai ao banco;
 *   • as colunas da 036 e da 049 são sondadas: sem elas, o campo fica de fora
 *     com aviso (e a rota não quebra).
 */
import { apenasDigitos, codigoMiolo } from '@csb/shared';
import { supabase } from '../../config/supabase.js';
import { detectarOuFalhar } from '../../lib/detectarColuna.js';
import { buscarTudoOuFalhar } from '../../lib/paginacao.js';
import { podeCarimbar } from './partner.eco.js';

export interface RetratoParceiro {
  /** Código do cliente no ERP. Um dos dois (com `cnpj`) é obrigatório. */
  codigo?: string | null;
  /** CNPJ/CPF, com ou sem pontuação. Tem precedência sobre o código. */
  cnpj?: string | null;
  /** AAAA-MM-DD ou momento com fuso. Só anda para frente. `null` não mexe. */
  ultima_compra?: string | null;
  total_comprado?: number | string | null;
  valor_vencido?: number | string | null;
  titulos_vencidos?: number | string | null;
  pendencia_financeira?: number | string | null;
  /** De quando é o retrato — momento COM fuso. Obrigatória. */
  referencia?: string | null;
}

export interface ResultadoRetrato {
  recebidos: number;
  atualizados: number;
  /** Retrato igual ao guardado: nada foi gravado. */
  sem_mudanca: number;
  ignorados: Array<{ cliente: string | null; motivo: string }>;
  avisos: string[];
}

// ─── Leitura do que veio ─────────────────────────────────────────────────────

/** Momento com data, hora e fuso: `Z` ou `±hh:mm`. */
const MOMENTO_COM_FUSO = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/i;
const DATA_PURA = /^\d{4}-\d{2}-\d{2}$/;

const DIA_EM_SAO_PAULO = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const ehObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const tem = (obj: Record<string, unknown>, chave: string): boolean =>
  Object.prototype.hasOwnProperty.call(obj, chave) && obj[chave] !== undefined;

const textoSimples = (v: unknown): string | null => {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

/** CNPJ/CPF só dígitos — 11 (CPF) ou mais; menos que isso é lixo de digitação. */
const digitosDoDocumento = (v: unknown): string | null => {
  const s = textoSimples(v);
  if (!s) return null;
  const d = apenasDigitos(s);
  return d.length >= 11 ? d : null;
};

type Leitura<T> = { veio: false } | { veio: true; valor: T | null } | { veio: 'invalido' };

const NAO_VEIO = { veio: false } as const;

/** Valor em reais: número ou texto numérico ("1500.50", "1.500,50"); `null` limpa; negativo é inválido. */
function lerValor(obj: Record<string, unknown>, chave: string): Leitura<number> {
  if (!tem(obj, chave)) return NAO_VEIO;
  const v = obj[chave];
  if (v === null) return { veio: true, valor: null };
  let n: number;
  if (typeof v === 'number') n = v;
  else {
    const s = textoSimples(v);
    if (s === null) return NAO_VEIO;
    n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
  }
  if (!Number.isFinite(n) || n < 0) return { veio: 'invalido' };
  return { veio: true, valor: Math.round(n * 100) / 100 };
}

/** Contagem: inteiro não negativo, número ou texto. `null` limpa. */
function lerInteiro(obj: Record<string, unknown>, chave: string): Leitura<number> {
  if (!tem(obj, chave)) return NAO_VEIO;
  const v = obj[chave];
  if (v === null) return { veio: true, valor: null };
  const s = textoSimples(v);
  if (s === null) return NAO_VEIO;
  const n = Number(s);
  if (!Number.isInteger(n) || n < 0) return { veio: 'invalido' };
  return { veio: true, valor: n };
}

/**
 * O DIA da última compra: a data pura vale como veio; um momento com fuso
 * vira o dia em Brasília (faturado às 22h de 13/08 em São Paulo é 01h de
 * 14/08 em UTC). Momento sem fuso é inválido. `null` NÃO limpa: a última
 * compra só anda para frente, e "o Control não sabe" não apaga uma compra.
 */
function lerDia(obj: Record<string, unknown>, chave: string): Leitura<string> {
  if (!tem(obj, chave)) return NAO_VEIO;
  const s = textoSimples(obj[chave]);
  if (s === null) return NAO_VEIO;
  if (DATA_PURA.test(s)) return Number.isNaN(Date.parse(s)) ? { veio: 'invalido' } : { veio: true, valor: s };
  if (!MOMENTO_COM_FUSO.test(s)) return { veio: 'invalido' };
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) return { veio: 'invalido' };
  return { veio: true, valor: DIA_EM_SAO_PAULO.format(new Date(ms)) };
}

/** "Não é data" e "é data sem fuso" são dois motivos diferentes. */
function problemaDaReferencia(v: unknown): string | null {
  const s = textoSimples(v);
  if (s === null) return '"referencia" é obrigatória (momento com fuso, ex.: 2026-09-16T06:00:00-03:00)';
  if (Number.isNaN(Date.parse(s))) return '"referencia" não é uma data ISO';
  if (!MOMENTO_COM_FUSO.test(s)) return '"referencia" precisa de fuso (Z ou -03:00)';
  return null;
}

/** Centavos, como o NUMERIC(12,2) guarda; o banco pode devolver texto. */
function centavos(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function mesmoMomento(a: unknown, b: unknown): boolean {
  if (a == null || b == null) return a == null && b == null;
  return Date.parse(String(a)) === Date.parse(String(b));
}

// ─── O cliente no banco ──────────────────────────────────────────────────────

interface LinhaCliente {
  id: string;
  erp_id: string | null;
  cnpj: string | null;
  last_purchase_at?: string | null;
  total_purchased?: number | string | null;
  overdue_amount?: number | string | null;
  pendencia_financeira?: number | string | null;
  titulos_vencidos?: number | null;
  retrato_referencia_em?: string | null;
  /** Para decidir o carimbo do Control (049). */
  updated_at?: string | null;
  erp_updated_at?: string | null;
}

/** As colunas da 036 (retrato) existem? Nascem juntas; a sonda é uma. */
const detectarRetrato = () => detectarOuFalhar('customers', 'last_purchase_at');
/** As colunas da 049 em customers existem? Nascem juntas; a sonda é uma. */
const detectarClienteDa049 = () => detectarOuFalhar('customers', 'retrato_referencia_em');

export const AVISO_SEM_036 = 'última compra, total comprado e vencido ficam guardados depois da migração 036';
export const AVISO_SEM_049 =
  'pendência financeira, títulos vencidos e a referência do retrato ficam guardados depois da migração 049';

export async function receberRetrato(company_id: string, lista: readonly unknown[]): Promise<ResultadoRetrato> {
  const ignorados: ResultadoRetrato['ignorados'] = [];
  const avisos = new Set<string>();
  const agora = new Date().toISOString();

  // ── 1. Leituras, todas antes da primeira gravação (falhou, lança: 500 e
  // nada gravado — o robô tenta de novo).
  const com036 = await detectarRetrato();
  const com049 = await detectarClienteDa049();

  const colunas = [
    'id, erp_id, cnpj',
    com036 ? 'last_purchase_at, total_purchased, overdue_amount' : null,
    com049 ? 'pendencia_financeira, titulos_vencidos, retrato_referencia_em, updated_at, erp_updated_at' : null,
  ]
    .filter(Boolean)
    .join(', ');
  // Paginado e ordenado por id: o PostgREST corta em 1.000 linhas sem avisar.
  const existentes = await buscarTudoOuFalhar<LinhaCliente>((de, ate) =>
    supabase.from('customers').select(colunas).eq('company_id', company_id).order('id').range(de, ate),
  );
  const porCnpj = new Map<string, LinhaCliente[]>();
  const porMiolo = new Map<string, LinhaCliente>();
  const mioloComDoisCadastros = new Set<string>();
  for (const c of existentes) {
    const d = digitosDoDocumento(c.cnpj);
    if (d) porCnpj.set(d, [...(porCnpj.get(d) ?? []), c]);
    const m = codigoMiolo(c.erp_id);
    if (!m) continue;
    if (porMiolo.has(m)) mioloComDoisCadastros.add(m);
    else porMiolo.set(m, c);
  }

  // ── 2. Registro a registro.
  const alvosNoLote = new Set<string>();
  let atualizados = 0;
  let semMudanca = 0;

  for (const raw of lista) {
    if (!ehObjeto(raw)) {
      ignorados.push({ cliente: null, motivo: 'registro inválido' });
      continue;
    }
    const codigo = textoSimples(raw['codigo']);
    const documento = digitosDoDocumento(raw['cnpj']);
    const referenciaDoCliente = documento ?? codigo;
    if (!documento && !codigoMiolo(codigo)) {
      ignorados.push({ cliente: referenciaDoCliente, motivo: 'informe "cnpj" ou "codigo"' });
      continue;
    }

    const problema = problemaDaReferencia(raw['referencia']);
    if (problema) {
      ignorados.push({ cliente: referenciaDoCliente, motivo: problema });
      continue;
    }
    const referencia = String(raw['referencia']).trim();

    // O cliente: primeiro pelo CNPJ, depois pelo código.
    let cliente: LinhaCliente | undefined;
    if (documento) {
      const candidatos = porCnpj.get(documento) ?? [];
      if (candidatos.length === 1) cliente = candidatos[0];
      else if (candidatos.length > 1) {
        const miolo = codigoMiolo(codigo);
        cliente = miolo ? candidatos.find((c) => codigoMiolo(c.erp_id) === miolo) : undefined;
        if (!cliente) {
          ignorados.push({ cliente: referenciaDoCliente, motivo: 'CNPJ com mais de um cadastro no app' });
          continue;
        }
      }
    }
    if (!cliente) {
      const miolo = codigoMiolo(codigo);
      if (miolo && mioloComDoisCadastros.has(miolo)) {
        ignorados.push({ cliente: referenciaDoCliente, motivo: 'código com mais de um cadastro no app' });
        continue;
      }
      cliente = miolo ? porMiolo.get(miolo) : undefined;
    }
    if (!cliente) {
      ignorados.push({ cliente: referenciaDoCliente, motivo: 'cliente não encontrado nesta empresa' });
      continue;
    }
    if (alvosNoLote.has(cliente.id)) {
      ignorados.push({ cliente: referenciaDoCliente, motivo: 'cliente repetido no lote' });
      continue;
    }
    alvosNoLote.add(cliente.id);

    // Retrato mais velho que o guardado não sobrescreve o mais novo.
    if (com049 && cliente.retrato_referencia_em && Date.parse(referencia) < Date.parse(cliente.retrato_referencia_em)) {
      ignorados.push({ cliente: referenciaDoCliente, motivo: 'referência mais antiga que o retrato guardado' });
      continue;
    }

    // Os valores, todos lidos antes de decidir: um ruim recusa o registro inteiro.
    const ultimaCompra = lerDia(raw, 'ultima_compra');
    const totalComprado = lerValor(raw, 'total_comprado');
    const valorVencido = lerValor(raw, 'valor_vencido');
    const titulos = lerInteiro(raw, 'titulos_vencidos');
    const pendencia = lerValor(raw, 'pendencia_financeira');
    const invalido =
      ultimaCompra.veio === 'invalido'
        ? '"ultima_compra" precisa ser AAAA-MM-DD ou um momento com fuso (Z ou -03:00)'
        : totalComprado.veio === 'invalido'
          ? '"total_comprado" precisa ser um número maior ou igual a zero'
          : valorVencido.veio === 'invalido'
            ? '"valor_vencido" precisa ser um número maior ou igual a zero'
            : titulos.veio === 'invalido'
              ? '"titulos_vencidos" precisa ser um inteiro maior ou igual a zero'
              : pendencia.veio === 'invalido'
                ? '"pendencia_financeira" precisa ser um número maior ou igual a zero'
                : null;
    if (invalido) {
      ignorados.push({ cliente: referenciaDoCliente, motivo: invalido });
      continue;
    }

    const patch: Record<string, unknown> = {};
    if (com036) {
      // Só para frente: a última compra nunca recua.
      if (ultimaCompra.veio === true && ultimaCompra.valor) {
        const guardado = cliente.last_purchase_at ? String(cliente.last_purchase_at).slice(0, 10) : null;
        if (!guardado || ultimaCompra.valor > guardado) patch['last_purchase_at'] = ultimaCompra.valor;
      }
      if (totalComprado.veio === true && totalComprado.valor !== centavos(cliente.total_purchased)) {
        patch['total_purchased'] = totalComprado.valor;
      }
      if (valorVencido.veio === true && valorVencido.valor !== centavos(cliente.overdue_amount)) {
        patch['overdue_amount'] = valorVencido.valor;
      }
    } else if (ultimaCompra.veio === true || totalComprado.veio === true || valorVencido.veio === true) {
      avisos.add(AVISO_SEM_036);
    }
    if (com049) {
      if (pendencia.veio === true && pendencia.valor !== centavos(cliente.pendencia_financeira)) {
        patch['pendencia_financeira'] = pendencia.valor;
        patch['pendencia_financeira_em'] = agora;
      }
      if (titulos.veio === true && titulos.valor !== (cliente.titulos_vencidos ?? null)) {
        patch['titulos_vencidos'] = titulos.valor;
      }
      if (!mesmoMomento(referencia, cliente.retrato_referencia_em)) patch['retrato_referencia_em'] = referencia;
    } else {
      avisos.add(AVISO_SEM_049);
    }

    if (Object.keys(patch).length === 0) {
      semMudanca++;
      continue;
    }
    // O momento DESTA gravação (não o do começo do lote): a trigger da 013 só
    // o ultrapassa pela folga. A última mão passa a ser a do Control — o
    // cliente não volta no GET ?desde= até o app mexer nele de novo — só se já
    // era: mudança do app ainda não puxada continua saindo no GET.
    const momento = new Date().toISOString();
    patch['updated_at'] = momento;
    if (com049 && podeCarimbar(cliente.updated_at, cliente.erp_updated_at)) patch['erp_updated_at'] = momento;

    const { error } = await supabase.from('customers').update(patch).eq('id', cliente.id).eq('company_id', company_id);
    if (error) {
      ignorados.push({ cliente: referenciaDoCliente, motivo: `falha ao gravar: ${error.message}` });
      continue;
    }
    atualizados++;
  }

  return {
    recebidos: lista.length,
    atualizados,
    sem_mudanca: semMudanca,
    ignorados,
    avisos: [...avisos],
  };
}
