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

/**
 * `tabela` + `coluna` identificam a pergunta e a chave do cache. Sem `coluna`,
 * pergunta se a TABELA existe.
 */
export async function detectar(tabela: string, coluna?: string): Promise<boolean> {
  const chave = coluna ? `${tabela}.${coluna}` : tabela;
  const lembrado = memoria.get(chave);
  if (lembrado && lembrado.ate > Date.now()) return lembrado.existe;

  const { error } = await supabase.from(tabela).select(coluna ?? 'id').limit(1);
  if (!error) {
    memoria.set(chave, { existe: true, ate: Number.POSITIVE_INFINITY });
    return true;
  }

  // Ausência de verdade: guarda por pouco tempo — o SQL pode rodar a qualquer
  // momento e o app tem de perceber sozinho.
  const codigo = (error as { code?: string }).code ?? '';
  if (CODIGOS_DE_AUSENCIA.has(codigo) || /does not exist|schema cache/i.test(error.message ?? '')) {
    memoria.set(chave, { existe: false, ate: Date.now() + VALIDADE_DO_NAO_MS });
    return false;
  }

  // Rede, timeout, 503: não é resposta sobre o schema. Não memoriza nada —
  // responde "não" desta vez (o chamador degrada) e pergunta de novo na
  // próxima, em vez de desligar o recurso até o fim do processo.
  return false;
}
