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

  if (!price_table_id) {
    return products.map((p) => ({ ...p, price: null }));
  }

  const productIds = products.map((p) => p.id as string);
  const { data: prices } = await supabase
    .from('product_prices')
    .select('product_id, price')
    .eq('price_table_id', price_table_id)
    .in('product_id', productIds);

  const priceMap = new Map<string, number>(
    (prices ?? []).map((pp) => [pp.product_id as string, pp.price as number]),
  );

  return products.map((p) => ({
    ...p,
    price: priceMap.get(p.id as string) ?? null,
  }));
}
