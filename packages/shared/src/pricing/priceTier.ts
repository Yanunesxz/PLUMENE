// ─── Preço escalonado por valor do pedido ────────────────────────────────────
// Regra de negócio (definida pelo usuário em 2026-06-03):
//   pedido  <  R$ 500          → Tabela 3 (preço mais alto / base de varejo)
//   pedido  R$ 500 a R$ 1200   → Tabela 2 (intermediário)
//   pedido  >  R$ 1200         → Tabela 1 (preço mais vantajoso / atacado)
// Quanto MAIOR o pedido, MELHOR o preço (Tabela 1 é a mais barata).
//
// Verbatim do usuário: "se a pessoa comprar abaixo de 500 reais vai pagar
// tabela 3 se for 500 a 1200 vai ser tabela 2 e se for acima de 1200 vai ser
// tabela 1".

/** As 3 tabelas comerciais. 1 = mais barata (atacado), 3 = mais cara (base). */
export const PRICE_TIER = {
  TABLE_1: 1,
  TABLE_2: 2,
  TABLE_3: 3,
} as const;

export type PriceTier = (typeof PRICE_TIER)[keyof typeof PRICE_TIER];

export const PRICE_TIER_LABELS: Record<PriceTier, string> = {
  1: 'Tabela 1 — Atacado',
  2: 'Tabela 2 — Intermediária',
  3: 'Tabela 3 — Base',
};

/**
 * Limiares (em R$) que definem a faixa pelo total de referência do pedido.
 * Bordas: exatamente 500 e exatamente 1200 caem na Tabela 2 ("500 a 1200").
 */
export const PRICE_TIER_THRESHOLDS = {
  /** Acima deste valor → Tabela 1 */
  TABLE_1_MIN: 1200,
  /** A partir deste valor (inclusive) → Tabela 2 */
  TABLE_2_MIN: 500,
} as const;

/**
 * Resolve qual tabela aplicar dado o total de REFERÊNCIA do pedido.
 *
 * Importante: `referenceTotal` deve ser calculado num preço FIXO (ver
 * {@link computeTieredPricing}), nunca no preço já descontado — senão o total
 * muda junto com a tabela e a faixa oscila perto das bordas.
 */
export function resolvePriceTier(referenceTotal: number): PriceTier {
  if (referenceTotal > PRICE_TIER_THRESHOLDS.TABLE_1_MIN) return PRICE_TIER.TABLE_1;
  if (referenceTotal >= PRICE_TIER_THRESHOLDS.TABLE_2_MIN) return PRICE_TIER.TABLE_2;
  return PRICE_TIER.TABLE_3;
}

/** Arredonda para 2 casas (centavos), evitando erro de ponto flutuante. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Item do pedido com o preço unitário em cada uma das 3 tabelas. */
export interface TieredLineInput {
  quantity: number;
  /** Preço unitário por tabela: { 1: atacado, 2: intermediário, 3: base }. */
  price: Record<PriceTier, number>;
}

export interface TieredLineResult {
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface TieredPricingResult {
  /** Tabela escolhida para o pedido inteiro. */
  tier: PriceTier;
  /** Total no preço de referência que definiu a faixa (não é o cobrado). */
  referenceTotal: number;
  /** Total final, já na tabela do `tier`. É o valor cobrado. */
  total: number;
  lines: TieredLineResult[];
}

/**
 * Calcula a tabela do pedido e reprecifica todas as linhas nela.
 *
 * Resolve o "ovo e galinha" (a faixa depende do total, que depende do preço)
 * medindo o total numa tabela de REFERÊNCIA fixa — por padrão a Tabela 3
 * (preço base/cheio): o cliente cruza R$ 500 / R$ 1200 em valor de catálogo e
 * aí desbloqueia o desconto. Troque `referenceTier` para mudar essa política.
 *
 * @example
 *   computeTieredPricing([
 *     { quantity: 30, price: { 1: 21.9, 2: 24.5, 3: 26.9 } },
 *   ]);
 *   // referenceTotal = 30 * 26.9 = 807  → faixa 500–1200 → Tabela 2
 *   // total = 30 * 24.5 = 735
 */
export function computeTieredPricing(
  lines: TieredLineInput[],
  options?: { referenceTier?: PriceTier },
): TieredPricingResult {
  const referenceTier = options?.referenceTier ?? PRICE_TIER.TABLE_3;

  const referenceTotal = lines.reduce(
    (sum, line) => sum + line.quantity * line.price[referenceTier],
    0,
  );

  const tier = resolvePriceTier(referenceTotal);

  const resultLines: TieredLineResult[] = lines.map((line) => {
    const unitPrice = line.price[tier];
    return {
      quantity: line.quantity,
      unitPrice,
      lineTotal: round2(line.quantity * unitPrice),
    };
  });

  const total = round2(resultLines.reduce((sum, line) => sum + line.lineTotal, 0));

  return { tier, referenceTotal: round2(referenceTotal), total, lines: resultLines };
}
