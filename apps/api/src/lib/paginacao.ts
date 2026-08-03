/**
 * Buscar mais de 1.000 linhas no PostgREST.
 *
 * O PostgREST corta a resposta em 1.000 linhas e NÃO avisa: vem um array
 * completo, só que menor do que a verdade. Nada estoura, nada loga — o dado
 * simplesmente some. `customers.service.ts` já paginava por isso, e
 * `import.service.ts` já fatiava por isso; este módulo é o mesmo remédio num
 * lugar só.
 */

/** Teto por requisição do PostgREST. */
export const LIMITE_POSTGREST = 1000;

/** Quantos ids cabem num `.in(...)` sem a URL ficar absurda. */
const IDS_POR_LOTE = 300;

export function emLotes<T>(itens: T[], tamanho = IDS_POR_LOTE): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) lotes.push(itens.slice(i, i + tamanho));
  return lotes;
}

/**
 * Percorre uma listagem inteira, página a página, até acabar.
 *
 * Para consultas sem `.in(...)` — a lista toda de uma tabela.
 */
export async function buscarTudo<T>(
  consulta: (de: number, ate: number) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<T[]> {
  const tudo: T[] = [];
  for (let de = 0; ; de += LIMITE_POSTGREST) {
    const { data, error } = await consulta(de, de + LIMITE_POSTGREST - 1);
    // `!Array.isArray` não é zelo: sem ele, uma resposta que não seja lista
    // deixaria `length` indefinido, a comparação daria falso e o laço giraria
    // para sempre — servidor travado, não erro.
    if (error || !Array.isArray(data)) break;
    const linhas = data as T[];
    tudo.push(...linhas);
    if (linhas.length < LIMITE_POSTGREST) break;
  }
  return tudo;
}

/**
 * Roda a consulta uma vez por lote de ids e junta tudo.
 *
 * Dois cortes acontecem aqui: o número de ids na URL (`.in`) e o número de
 * linhas que voltam. Por isso cada lote também é paginado por dentro — 300
 * pedidos podem trazer 4.000 itens.
 */
export async function buscarPorIds<T>(
  ids: string[],
  consulta: (lote: string[], de: number, ate: number) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<T[]> {
  const tudo: T[] = [];

  for (const lote of emLotes(ids)) {
    for (let de = 0; ; de += LIMITE_POSTGREST) {
      const { data, error } = await consulta(lote, de, de + LIMITE_POSTGREST - 1);
      if (error || !data) break;
      const linhas = data as T[];
      tudo.push(...linhas);
      // Página incompleta = acabou. Só continua quando veio exatamente o teto,
      // que é o único sinal de que pode haver mais.
      if (linhas.length < LIMITE_POSTGREST) break;
    }
  }

  return tudo;
}
