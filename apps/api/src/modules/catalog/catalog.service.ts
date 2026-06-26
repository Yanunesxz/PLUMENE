import { supabase } from '../../config/supabase.js';
import type { ProductWithPrice } from '@csb/shared';

export async function getProducts(
  company_id: string,
  price_table_id?: string,
): Promise<ProductWithPrice[]> {
  const { data: products, error } = await supabase
    .from('products')
    .select('*')
    .eq('company_id', company_id)
    .eq('active', true)
    .order('name');

  if (error || !products) return [];

  const productIds = products.map((p) => p.id as string);

  // Variantes (tamanhos) de cada produto — a grade vem do ERP (adulto P/M/G…,
  // juvenil/infantil em números). Cores são sortidas, então é só (produto×tamanho).
  const { data: variants } = await supabase
    .from('product_variants')
    .select('id, product_id, company_id, erp_sku, size, stock_quantity, stock_committed, active, updated_at')
    .in('product_id', productIds)
    .eq('active', true);

  const variantsByProduct = new Map<string, NonNullable<typeof variants>>();
  for (const v of variants ?? []) {
    const pid = v.product_id as string;
    const arr = variantsByProduct.get(pid) ?? [];
    arr.push(v);
    variantsByProduct.set(pid, arr);
  }

  const priceMap = new Map<string, number>();
  if (price_table_id) {
    const { data: prices } = await supabase
      .from('product_prices')
      .select('product_id, price')
      .eq('price_table_id', price_table_id)
      .in('product_id', productIds);
    for (const pp of prices ?? []) priceMap.set(pp.product_id as string, pp.price as number);
  }

  return products.map((p) => ({
    ...p,
    price: priceMap.get(p.id as string) ?? null,
    variants: (variantsByProduct.get(p.id as string) ?? []) as ProductWithPrice['variants'],
  }));
}
