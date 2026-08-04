import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Junta classes Tailwind resolvendo conflitos (shadcn-style). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Formata valor em Real (R$ 1.234,56). Null/undefined → travessão. */
export function formatBRL(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

/**
 * Real sem os centavos (R$ 1.235), para meta e bônus.
 *
 * Em valor de meta o centavo não é informação, é ruído: ocupa quatro caracteres
 * numa etiqueta de 11px e ninguém persegue R$ 50.000,00 — persegue 50 mil.
 */
export function formatBRLCurto(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  }).format(value);
}
