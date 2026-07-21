import { supabase } from '../../config/supabase.js';

// ─────────────────────────────────────────────────────────────────────────────
// Importação de catálogo por empresa (multi-fábrica).
// Upsert de produtos por (company_id, sku), variantes por tamanho e preço na
// tabela informada (ou na primeira tabela da empresa; cria TABELA PADRÃO se
// não houver nenhuma). Nunca toca em dados de outras empresas.
// ─────────────────────────────────────────────────────────────────────────────

export interface ImportSizeInput {
  size: string;
  stock?: number | undefined;
}

export interface ImportProductInput {
  sku: string;
  name: string;
  price?: number | undefined;
  sizes?: ImportSizeInput[] | undefined;
  image_url?: string | undefined;
  group?: string | undefined;
  /** Cor desta variante (ex.: "Azul"). Vazio = produto sem cor. */
  color?: string | undefined;
  /** Agrupador das cores do mesmo modelo (ex.: "0172"). Vazio = produto isolado. */
  variant_group?: string | undefined;
}

export interface ImportSummary {
  products_created: number;
  products_updated: number;
  variants_upserted: number;
  prices_set: number;
  price_table: string;
  warnings: string[];
}

const CHUNK = 400;

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function resolvePriceTable(company_id: string): Promise<{ id: string; name: string }> {
  const { data } = await supabase
    .from('price_tables')
    .select('id, name')
    .eq('company_id', company_id)
    .order('name')
    .limit(1)
    .maybeSingle();
  if (data) return data as { id: string; name: string };

  const { data: created, error } = await supabase
    .from('price_tables')
    .insert({ company_id, name: 'TABELA PADRÃO' })
    .select('id, name')
    .single();
  if (error || !created) throw new Error(`Não foi possível criar a tabela de preço: ${error?.message}`);
  return created as { id: string; name: string };
}

export async function importProducts(
  company_id: string,
  items: ImportProductInput[],
): Promise<ImportSummary> {
  const warnings: string[] = [];

  // Normaliza e deduplica por SKU (o último da planilha vence).
  const bySku = new Map<string, ImportProductInput>();
  for (const raw of items) {
    const sku = raw.sku.trim().toUpperCase();
    if (bySku.has(sku)) warnings.push(`SKU duplicado na planilha: ${sku} (mantida a última linha)`);
    bySku.set(sku, { ...raw, sku });
  }
  const products = [...bySku.values()];

  const table = await resolvePriceTable(company_id);

  // Quem já existe? (para contar criado × atualizado)
  const skus = products.map((p) => p.sku);
  const existing = new Set<string>();
  for (const part of chunks(skus, CHUNK)) {
    const { data } = await supabase
      .from('products')
      .select('sku')
      .eq('company_id', company_id)
      .in('sku', part);
    for (const r of data ?? []) existing.add((r as { sku: string }).sku);
  }

  // Upsert dos produtos em lote — UNIQUE(company_id, sku) garante o merge.
  // erp_id NÃO entra no payload: importação nunca mexe no vínculo com ERP.
  for (const part of chunks(products, CHUNK)) {
    const payload = part.map((p) => ({
      company_id,
      sku: p.sku,
      name: p.name.trim(),
      image_url: p.image_url?.trim() || null,
      group_name: p.group?.trim() || null,
      color_name: p.color?.trim() || null,
      variant_group: p.variant_group?.trim() || null,
      active: true,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await supabase
      .from('products')
      .upsert(payload, { onConflict: 'company_id,sku' });
    if (error) throw new Error(`Falha ao gravar produtos: ${error.message}`);
  }

  // Mapa sku → id (pós-upsert).
  const idBySku = new Map<string, string>();
  for (const part of chunks(skus, CHUNK)) {
    const { data } = await supabase
      .from('products')
      .select('id, sku')
      .eq('company_id', company_id)
      .in('sku', part);
    for (const r of data ?? []) idBySku.set((r as { sku: string }).sku, (r as { id: string }).id);
  }

  // Variantes (grade de tamanhos). Sem tamanhos informados → tamanho único "U",
  // senão o produto não teria como entrar num pedido.
  let variants_upserted = 0;
  const variantRows: Record<string, unknown>[] = [];
  for (const p of products) {
    const product_id = idBySku.get(p.sku);
    if (!product_id) continue;
    const sizes = p.sizes?.length ? p.sizes : [{ size: 'U', stock: 0 }];
    if (!p.sizes?.length) warnings.push(`${p.sku}: sem tamanhos na planilha — criado tamanho único "U"`);
    for (const s of sizes) {
      variantRows.push({
        company_id,
        product_id,
        erp_sku: `${p.sku}|${s.size.trim().toUpperCase()}`,
        size: s.size.trim().toUpperCase(),
        stock_quantity: s.stock ?? 0,
        active: true,
        updated_at: new Date().toISOString(),
      });
    }
  }
  for (const part of chunks(variantRows, CHUNK)) {
    const { error } = await supabase
      .from('product_variants')
      .upsert(part, { onConflict: 'company_id,erp_sku' });
    if (error) throw new Error(`Falha ao gravar variantes: ${error.message}`);
    variants_upserted += part.length;
  }

  // Preços na tabela resolvida (product_prices não tem índice único → merge manual).
  const productIds = products
    .filter((p) => p.price != null)
    .map((p) => ({ id: idBySku.get(p.sku), price: p.price as number }))
    .filter((x): x is { id: string; price: number } => !!x.id);

  const existingPrice = new Map<string, string>(); // product_id → price row id
  for (const part of chunks(productIds.map((x) => x.id), CHUNK)) {
    const { data } = await supabase
      .from('product_prices')
      .select('id, product_id')
      .eq('price_table_id', table.id)
      .in('product_id', part);
    for (const r of data ?? [])
      existingPrice.set((r as { product_id: string }).product_id, (r as { id: string }).id);
  }

  let prices_set = 0;
  const toInsert = productIds.filter((x) => !existingPrice.has(x.id));
  for (const part of chunks(toInsert, CHUNK)) {
    const { error } = await supabase.from('product_prices').insert(
      part.map((x) => ({
        product_id: x.id,
        price_table_id: table.id,
        company_id,
        price: x.price,
        updated_at: new Date().toISOString(),
      })),
    );
    if (error) throw new Error(`Falha ao gravar preços: ${error.message}`);
    prices_set += part.length;
  }
  for (const x of productIds.filter((x) => existingPrice.has(x.id))) {
    const { error } = await supabase
      .from('product_prices')
      .update({ price: x.price, updated_at: new Date().toISOString() })
      .eq('id', existingPrice.get(x.id) as string);
    if (!error) prices_set += 1;
  }

  const noPrice = products.filter((p) => p.price == null).length;
  if (noPrice > 0) warnings.push(`${noPrice} produto(s) sem preço na planilha — aparecem como "sob consulta"`);

  return {
    products_created: products.filter((p) => !existing.has(p.sku)).length,
    products_updated: products.filter((p) => existing.has(p.sku)).length,
    variants_upserted,
    prices_set,
    price_table: table.name,
    warnings: warnings.slice(0, 30),
  };
}
