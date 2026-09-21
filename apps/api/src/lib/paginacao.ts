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
 * Igual a `buscarTudo`, mas uma página que falha LANÇA em vez de devolver o
 * que juntou até ali.
 *
 * Existe por causa da API de Parceiro: lá, erro do banco precisa virar 500
 * para o robô do ERP tentar de novo na próxima rodada. Engolir o erro viraria
 * "200 com a lista pela metade" — e o ERP concluiria que o resto dos pedidos
 * não existe. `buscarTudo` continua engolindo de propósito para as telas, que
 * preferem mostrar o que veio a ficar em branco.
 */
export async function buscarTudoOuFalhar<T>(
  consulta: (de: number, ate: number) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<T[]> {
  const tudo: T[] = [];
  for (let de = 0; ; de += LIMITE_POSTGREST) {
    const ate = de + LIMITE_POSTGREST - 1;
    const { data, error } = await consulta(de, ate);
    if (error) {
      const mensagem = (error as { message?: string }).message ?? 'erro desconhecido';
      throw new Error(`Falha ao buscar as linhas ${de}-${ate}: ${mensagem}`);
    }
    // Resposta que não é lista não é "página que falhou": encerra em vez de
    // girar para sempre (mesma proteção do `buscarTudo`).
    if (!Array.isArray(data)) break;
    const linhas = data as T[];
    tudo.push(...linhas);
    if (linhas.length < LIMITE_POSTGREST) break;
  }
  return tudo;
}

/** A chave de uma linha na ordem (`updated_at`, `id`). */
export interface ChaveDeAtualizacao {
  id: string;
  updated_at?: string | null;
}

/**
 * O filtro `or` do PostgREST para "as linhas DEPOIS desta" na ordem
 * (`updated_at` crescente, `id` crescente), com os nulos no fim — a ordem do
 * Postgres. Os valores vão entre aspas: a hora tem ".", ":" e "+", que o
 * PostgREST reserva dentro de `or`.
 */
export function depoisDaChave(chave: ChaveDeAtualizacao): string {
  const id = `"${chave.id}"`;
  if (chave.updated_at == null) return `and(updated_at.is.null,id.gt.${id})`;
  const hora = `"${chave.updated_at}"`;
  return `updated_at.gt.${hora},and(updated_at.eq.${hora},id.gt.${id}),updated_at.is.null`;
}

/**
 * Percorre uma listagem ordenada por (`updated_at`, `id`) PELA CHAVE da última
 * linha lida, e não pela posição (revisão de 17/09/2026). LANÇA como
 * `buscarTudoOuFalhar`.
 *
 * Existe pelos GET ?desde= da API de Parceiro. Com `range`, uma linha de uma
 * página JÁ LIDA que é gravada de novo no meio da leitura vai para o fim da
 * ordem — e todas as outras recuam uma posição: a da fronteira cai na página
 * já lida e não sai em lugar nenhum (e, com `updated_at` antes do
 * `servidor_hora`, nem na próxima puxada). Pela chave, quem não mudou nunca
 * muda de lugar. A linha gravada de novo pode sair duas vezes; fica a versão
 * mais nova, na posição dela.
 *
 * `pagina(ultima, limite)`: a consulta com `.limit(limite)`, a ordem acima e,
 * quando `ultima` veio, o filtro `depoisDaChave(ultima)` (ou `id > ultima.id`,
 * para uma lista ordenada só por id).
 */
export async function buscarPelaChaveOuFalhar<T extends ChaveDeAtualizacao>(
  pagina: (ultima: T | null, limite: number) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<T[]> {
  const tudo: T[] = [];
  let ultima: T | null = null;
  for (let n = 1; ; n++) {
    const { data, error } = await pagina(ultima, LIMITE_POSTGREST);
    if (error) {
      const mensagem = (error as { message?: string }).message ?? 'erro desconhecido';
      throw new Error(`Falha ao buscar a página ${n}: ${mensagem}`);
    }
    if (!Array.isArray(data)) break;
    const linhas = data as T[];
    tudo.push(...linhas);
    if (linhas.length < LIMITE_POSTGREST) break;
    const nova = linhas[linhas.length - 1]!;
    // Pela chave, a página seguinte SEMPRE termina depois da anterior. Se não
    // andou (o filtro da chave não foi aplicado), o laço giraria para sempre
    // devolvendo a mesma página: lança em vez de travar o servidor.
    if (ultima && nova.id === ultima.id && (nova.updated_at ?? null) === (ultima.updated_at ?? null)) {
      throw new Error(`Falha ao buscar a página ${n + 1}: a paginação pela chave não avançou`);
    }
    ultima = nova;
  }
  // A mesma linha duas vezes (gravada de novo durante a leitura): vale a última.
  const vistas = new Set<string>();
  const unicas: T[] = [];
  for (let i = tudo.length - 1; i >= 0; i--) {
    const linha = tudo[i]!;
    if (vistas.has(linha.id)) continue;
    vistas.add(linha.id);
    unicas.push(linha);
  }
  return unicas.reverse();
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
