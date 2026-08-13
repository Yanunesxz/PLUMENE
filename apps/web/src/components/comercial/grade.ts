import type { CatalogVariant, ProductWithPrice } from '@csb/shared';
import { faixaDoTamanho } from '@csb/shared';

const SIZE_RANK: Record<string, number> = { PP: 0, P: 1, M: 2, G: 3, GG: 4, EG: 5, EGG: 6, EGGG: 7 };

/**
 * Ordena a grade: números (juvenil/infantil) em ordem numérica; letras de adulto
 * na ordem PP→EGGG; o resto alfabético.
 */
export function compararTamanho(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  const ra = SIZE_RANK[a.toUpperCase()];
  const rb = SIZE_RANK[b.toUpperCase()];
  if (ra != null && rb != null) return ra - rb;
  if (ra != null) return -1;
  if (rb != null) return 1;
  return a.localeCompare(b, 'pt-BR', { numeric: true });
}

export function ordenarGrade(variants: CatalogVariant[]): CatalogVariant[] {
  return [...variants].sort((a, b) => compararTamanho(a.size, b.size));
}

/** "LD" não é tamanho de venda — não entra em rótulo de faixa nem em preço. */
const FORA_DA_GRADE = new Set(['LD']);

export interface FaixaDePreco {
  /** Como a tabela da fábrica chama a faixa: "P AO GG", "EG", "48 AO 54". */
  rotulo: string;
  preco: number;
}

/** "P" e "GG" viram "P AO GG"; um tamanho sozinho fica ele mesmo. */
function rotuloDaFaixa(sizes: string[]): string {
  const primeiro = sizes[0]!;
  const ultimo = sizes[sizes.length - 1]!;
  return primeiro === ultimo ? primeiro : `${primeiro} AO ${ultimo}`;
}

/**
 * As faixas de preço do produto, como a tabela oficial as apresenta:
 *
 *     P AO GG      R$ 41,90
 *     48 AO 54     R$ 52,90
 *
 * Devolve UMA faixa quando a peça tem preço único — que é o caso dos infantis e
 * juvenis, e de tudo enquanto a migração 026 não rodar. Nesse caso quem desenha
 * mostra só o preço, sem rótulo: rotular uma faixa só não informa nada.
 *
 * Vazio quando não há preço na tabela consultada ("Sob consulta").
 */
export function faixasDePreco(product: ProductWithPrice): FaixaDePreco[] {
  if (product.price == null) return [];

  const sizes = ordenarGrade(product.variants ?? [])
    .map((v) => v.size)
    .filter((s) => !FORA_DA_GRADE.has(s.trim().toUpperCase()));

  const maiores = sizes.filter((s) => faixaDoTamanho(s) === 'maior');
  const normais = sizes.filter((s) => faixaDoTamanho(s) !== 'maior');

  // Sem preço maior cadastrado, ou sem grade que o alcance, a peça tem um preço
  // só — mesmo que o cadastro tenha um EG solto sem preço próprio.
  if (product.price_larger == null || maiores.length === 0 || normais.length === 0) {
    return [{ rotulo: rotuloDaFaixa(sizes.length > 0 ? sizes : ['']), preco: product.price }];
  }

  return [
    { rotulo: rotuloDaFaixa(normais), preco: product.price },
    { rotulo: rotuloDaFaixa(maiores), preco: product.price_larger },
  ];
}
