import { supabase } from '../config/supabase.js';

/**
 * "Esta coluna/tabela já existe?" — a pergunta que todo serviço faz porque as
 * migrações rodam À MÃO no Supabase, e o código sobe antes do SQL.
 *
 * O jeito ingênuo (memorizar o resultado para sempre) tem dois furos que só
 * aparecem no pior dia:
 *
 *   1. O Yan roda a migração às 14h. A API está de pé desde as 9h e já
 *      respondeu "não existe" uma vez — ela vai continuar dizendo isso até
 *      alguém reiniciar o Railway. Todo cadastro feito no meio disso grava sem
 *      as colunas novas e o dado digitado se perde EM SILÊNCIO.
 *   2. Um soluço do Supabase no arranque (timeout, 503, ou o schema cache do
 *      PostgREST ainda recarregando depois do ALTER TABLE) é lido como "a
 *      coluna não existe" e desliga o recurso para sempre naquele processo.
 *
 * Então: `true` vale para sempre (coluna não desaparece), "não existe" vale por
 * pouco tempo (a migração pode ter acabado de rodar) e erro transitório não
 * vale nada — pergunta de novo na próxima vez.
 */

/** Quanto tempo confiar num "ainda não existe" antes de perguntar de novo. */
const VALIDADE_DO_NAO_MS = 30_000;

/** Postgres 42703 = undefined_column; PGRST204 = coluna fora do schema cache. */
const CODIGOS_DE_AUSENCIA = new Set(['42703', '42P01', 'PGRST204', 'PGRST205']);

interface Memoria {
  existe: boolean;
  /** Quando esta resposta expira. `Infinity` para o "sim". */
  ate: number;
}

const memoria = new Map<string, Memoria>();

/** Para os testes: esquece tudo que foi detectado (o estado é de processo). */
export function esquecerDeteccoes(): void {
  memoria.clear();
}

/** O que a sonda descobriu: uma resposta sobre o schema, ou nenhuma (rede, timeout, 503). */
type Sondagem = 'existe' | 'nao_existe' | 'sem_resposta';

/**
 * `tabela` + `coluna` identificam a pergunta e a chave do cache. Sem `coluna`,
 * pergunta se a TABELA existe.
 */
async function sondar(tabela: string, coluna?: string): Promise<Sondagem> {
  const chave = coluna ? `${tabela}.${coluna}` : tabela;
  const lembrado = memoria.get(chave);
  if (lembrado && lembrado.ate > Date.now()) return lembrado.existe ? 'existe' : 'nao_existe';

  const { error } = await supabase.from(tabela).select(coluna ?? 'id').limit(1);
  if (!error) {
    memoria.set(chave, { existe: true, ate: Number.POSITIVE_INFINITY });
    return 'existe';
  }

  // Ausência de verdade: guarda por pouco tempo — o SQL pode rodar a qualquer
  // momento e o app tem de perceber sozinho.
  const codigo = (error as { code?: string }).code ?? '';
  if (CODIGOS_DE_AUSENCIA.has(codigo) || /does not exist|schema cache/i.test(error.message ?? '')) {
    memoria.set(chave, { existe: false, ate: Date.now() + VALIDADE_DO_NAO_MS });
    return 'nao_existe';
  }

  // Rede, timeout, 503: não é resposta sobre o schema. Não memoriza nada —
  // pergunta de novo na próxima vez, em vez de desligar o recurso até o fim
  // do processo.
  return 'sem_resposta';
}

/**
 * "Existe?" — e, quando o banco não respondeu sobre o schema, responde "não"
 * desta vez (o chamador degrada: o campo sai null, a coluna nova não é
 * gravada). É a resposta certa para SELECT e para gravação opcional.
 */
export async function detectar(tabela: string, coluna?: string): Promise<boolean> {
  return (await sondar(tabela, coluna)) === 'existe';
}

/**
 * Igual a `detectar`, mas LANÇA quando a sonda não foi resposta sobre o schema.
 *
 * Para quando degradar é perigoso: um FILTRO que existe para impedir
 * lançamento duplicado (o `invoiced` da fila do parceiro) não pode sumir em
 * silêncio porque o Supabase soluçou no arranque — a fila sairia com os
 * pedidos faturados à mão dentro, e o ERP os importaria de novo. Aqui o erro
 * sobe (vira 500 na API) e o robô tenta de novo na próxima rodada. A memória
 * é a mesma de `detectar`: o "sim" lembrado vale para os dois.
 */
export async function detectarOuFalhar(tabela: string, coluna?: string): Promise<boolean> {
  const sondagem = await sondar(tabela, coluna);
  if (sondagem === 'sem_resposta') {
    const alvo = coluna ? `${tabela}.${coluna}` : tabela;
    throw new Error(`Falha ao sondar ${alvo}: o banco não respondeu sobre o schema`);
  }
  return sondagem === 'existe';
}
