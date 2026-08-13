import type { CatalogVariant } from '@csb/shared';

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

