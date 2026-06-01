/**
 * ErpSyncService — Firebird → Supabase
 *
 * Lê dados do ERP (Firebird 2.5) e faz upsert no Supabase.
 * Executa em modo delta: só sincroniza registros alterados após a última sync.
 *
 * Fluxo:
 *  1. Ler tabelas de preço
 *  2. Ler produtos + variantes (cor × tamanho) + estoque
 *  3. Ler clientes + bloqueios
 *  4. Calcular preços por variante × tabela
 */
import { supabase } from '../../config/supabase.js';
import { withFirebird, query } from './connection.js';
import {
  QUERY_PRICE_TABLES,
  QUERY_PRODUCTS_WITH_STOCK,
  QUERY_PRODUCT_PRICES,
  QUERY_CUSTOMERS,
  QUERY_STOCK_SNAPSHOT,
  getPriceFromColumn,
} from './queries.js';
import type {
  ErpPriceTable,
  ErpProductColor,
  ErpProductPrice,
  ErpCustomer,
  ErpStock,
} from './types.js';

type SyncType = 'price_tables' | 'products' | 'stock' | 'customers' | 'prices';

interface SyncResult {
  type: SyncType;
  records: number;
  duration_ms: number;
  error?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Chunked upsert para não explodir o payload do Supabase (máx 500/lote) */
async function upsertBatch<T extends object>(
  table: string,
  rows: T[],
  chunkSize = 500,
): Promise<void> {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await supabase.from(table).upsert(chunk);
    if (error) throw new Error(`Upsert ${table} falhou: ${error.message}`);
  }
}

function now(): number {
  return Date.now();
}

// ─── Sync de Tabelas de Preço ─────────────────────────────────────────────────

export async function syncPriceTables(company_id: string): Promise<SyncResult> {
  const t0 = now();
  try {
    const erpRows = await withFirebird((db) =>
      query<ErpPriceTable>(db, QUERY_PRICE_TABLES),
    );

    const rows = erpRows.map((r) => ({
      company_id,
      erp_code: r.TABELA_PRECO?.trim(),
      name: r.DESCRICAO?.trim() ?? r.TABELA_PRECO?.trim(),
      price_column: 1, // padrão; ajustável por cliente
      // Armazena descrições das colunas como JSON para uso futuro
      col_descriptions: {
        1: r.DESCRICAO_COLUNA1,
        2: r.DESCRICAO_COLUNA2,
        3: r.DESCRICAO_COLUNA3,
        4: r.DESCRICAO_COLUNA4,
        5: r.DESCRICAO_COLUNA5,
        6: r.DESCRICAO_COLUNA6,
      },
      updated_at: new Date().toISOString(),
    }));

    await upsertBatch('price_tables', rows);

    return { type: 'price_tables', records: rows.length, duration_ms: now() - t0 };
  } catch (err) {
    return {
      type: 'price_tables',
      records: 0,
      duration_ms: now() - t0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Sync de Produtos + Variantes ─────────────────────────────────────────────

export async function syncProducts(company_id: string): Promise<SyncResult[]> {
  const t0 = now();
  try {
    // Tipo da query combinada produto+cor+estoque
    type ProductRow = {
      PRODUTO: string; TAMANHO: string; DESCRICAO: string; ATIVO: string;
      COLECAO: string | null; CATALOGO: string | null; MARCA: string | null;
      GRUPO_PRODUTO: string | null; GRADE_TAMANHO: string | null;
      COR: string; COR_DESCRICAO: string | null; COR_HEXADECIMAL: string | null;
      ESTOQUE_PRATELEIRA: number; ESTOQUE_PEDIDO: number; ESTOQUE_PRE_PRODUZIDO: number;
      CODIGO_BARRAS: string | null;
    };

    const erpRows = await withFirebird((db) =>
      query<ProductRow>(db, QUERY_PRODUCTS_WITH_STOCK),
    );

    // Deduplica produtos (um produto = vários tamanhos × cores no Firebird)
    const productMap = new Map<string, object>();
    const variantRows: Record<string, unknown>[] = [];

    for (const r of erpRows) {
      const sku = r.PRODUTO.trim();
      if (!productMap.has(sku)) {
        productMap.set(sku, {
          company_id,
          erp_id: sku,
          sku,
          name: r.DESCRICAO?.trim() ?? sku,
          description: null,
          collection: r.COLECAO?.trim() ?? null,
          brand: r.MARCA?.trim() ?? null,
          group_name: r.GRUPO_PRODUTO?.trim() ?? null,
          active: r.ATIVO === 'S',
          updated_at: new Date().toISOString(),
        });
      }

      // Cada (produto × tamanho × cor) = 1 variante
      variantRows.push({
        company_id,
        erp_sku: `${r.PRODUTO.trim()}|${r.TAMANHO.trim()}|${r.COR.trim()}`,
        size: r.TAMANHO.trim(),
        color: r.COR.trim(),
        color_description: r.COR_DESCRICAO?.trim() ?? null,
        color_hex: r.COR_HEXADECIMAL?.trim() ?? null,
        stock_quantity: r.ESTOQUE_PRATELEIRA,
        stock_committed: r.ESTOQUE_PEDIDO,
        barcode: r.CODIGO_BARRAS?.trim() ?? null,
        active: r.ATIVO === 'S',
        updated_at: new Date().toISOString(),
        // product_id será preenchido abaixo após upsert dos produtos
        _sku: r.PRODUTO.trim(), // campo temporário para lookup
      });
    }

    // 1. Upsert produtos
    const products = Array.from(productMap.values());
    await upsertBatch('products', products);

    // 2. Busca IDs dos produtos inseridos
    const { data: dbProducts } = await supabase
      .from('products')
      .select('id, erp_id')
      .eq('company_id', company_id);

    const productIdMap = new Map(
      (dbProducts ?? []).map((p: { id: string; erp_id: string | null }) => [p.erp_id, p.id]),
    );

    // 3. Enriquece variantes com product_id e remove campo temporário
    const variants = variantRows
      .map((v) => {
        const pid = productIdMap.get(v['_sku'] as string);
        if (!pid) return null;
        const { _sku: _skip, ...rest } = v;
        void _skip;
        return { ...rest, product_id: pid };
      })
      .filter(Boolean);

    await upsertBatch('product_variants', variants as object[]);

    return [
      { type: 'products', records: products.length, duration_ms: now() - t0 },
      { type: 'stock', records: variants.length, duration_ms: now() - t0 },
    ];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return [
      { type: 'products', records: 0, duration_ms: now() - t0, error: msg },
    ];
  }
}

// ─── Sync de Preços ───────────────────────────────────────────────────────────

export async function syncPrices(company_id: string): Promise<SyncResult> {
  const t0 = now();
  try {
    const erpPrices = await withFirebird((db) =>
      query<ErpProductPrice>(db, QUERY_PRODUCT_PRICES),
    );

    // Busca mapeamentos do Supabase
    const [{ data: dbTables }, { data: dbProducts }] = await Promise.all([
      supabase.from('price_tables').select('id, erp_code, price_column').eq('company_id', company_id),
      supabase.from('products').select('id, erp_id').eq('company_id', company_id),
    ]);

    const tableMap = new Map(
      (dbTables ?? []).map((t: { id: string; erp_code: string | null; price_column: number }) => [
        t.erp_code,
        { id: t.id, price_column: t.price_column ?? 1 },
      ]),
    );
    const productMap = new Map(
      (dbProducts ?? []).map((p: { id: string; erp_id: string | null }) => [p.erp_id, p.id]),
    );

    const priceRows: object[] = [];

    for (const r of erpPrices) {
      const table = tableMap.get(r.TABELA_PRECO?.trim());
      const productId = productMap.get(r.PRODUTO?.trim());
      if (!table || !productId) continue;

      const price = getPriceFromColumn(r, table.price_column);
      if (price == null || price <= 0) continue;

      // Preço por produto (sem variante específica — usa PRECO1 da tabela + tamanho)
      priceRows.push({
        company_id,
        product_id: productId,
        price_table_id: table.id,
        price,
        updated_at: new Date().toISOString(),
      });
    }

    await upsertBatch('product_prices', priceRows);

    return { type: 'prices', records: priceRows.length, duration_ms: now() - t0 };
  } catch (err) {
    return {
      type: 'prices',
      records: 0,
      duration_ms: now() - t0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Sync de Clientes ─────────────────────────────────────────────────────────

export async function syncCustomers(company_id: string): Promise<SyncResult> {
  const t0 = now();
  try {
    const erpCustomers = await withFirebird((db) =>
      query<ErpCustomer>(db, QUERY_CUSTOMERS),
    );

    // Busca tabelas de preço para mapear erp_code → id
    const { data: dbTables } = await supabase
      .from('price_tables')
      .select('id, erp_code')
      .eq('company_id', company_id);

    const tableMap = new Map(
      (dbTables ?? []).map((t: { id: string; erp_code: string | null }) => [t.erp_code?.trim(), t.id]),
    );

    const rows = erpCustomers.map((c) => ({
      company_id,
      erp_id: c.CLIENTE?.trim(),
      name: c.RAZAO_SOCIAL?.trim() ?? c.CLIENTE?.trim(),
      trade_name: c.NOME_FANTASIA?.trim() ?? null,
      cnpj: c.CNPJ_CPF?.trim() ?? null,
      rep_erp_id: c.REPRESENTANTE?.trim() ?? null,
      price_table_id: tableMap.get(c.TABELA_PRECO?.trim()) ?? null,
      blocked: c.BLOQUEADO?.trim() === 'S',
      block_reason: null, // BLOB — lido separadamente se necessário
      credit_limit: c.LIMITE_CREDITO ?? null,
      whatsapp: c.WHATSAPP1?.trim() ?? null,
      email: c.EMAIL?.trim() ?? null,
      updated_at: c.DATA_UPDATE ? new Date(c.DATA_UPDATE).toISOString() : new Date().toISOString(),
    }));

    await upsertBatch('customers', rows);

    return { type: 'customers', records: rows.length, duration_ms: now() - t0 };
  } catch (err) {
    return {
      type: 'customers',
      records: 0,
      duration_ms: now() - t0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Sync de Estoque (incremental) ───────────────────────────────────────────

export async function syncStock(company_id: string): Promise<SyncResult> {
  const t0 = now();
  try {
    const erpStock = await withFirebird((db) =>
      query<ErpStock>(db, QUERY_STOCK_SNAPSHOT),
    );

    // Busca IDs das variantes
    const { data: dbVariants } = await supabase
      .from('product_variants')
      .select('id, erp_sku')
      .eq('company_id', company_id);

    const variantMap = new Map(
      (dbVariants ?? []).map((v: { id: string; erp_sku: string }) => [v.erp_sku, v.id]),
    );

    const updates: object[] = [];
    for (const s of erpStock) {
      const erp_sku = `${s.PRODUTO.trim()}|${s.TAMANHO.trim()}|${s.COR.trim()}`;
      const variantId = variantMap.get(erp_sku);
      if (!variantId) continue;

      updates.push({
        id: variantId,
        stock_quantity: s.ESTOQUE_PRATELEIRA,
        stock_committed: s.ESTOQUE_PEDIDO,
        updated_at: new Date().toISOString(),
      });
    }

    await upsertBatch('product_variants', updates);

    return { type: 'stock', records: updates.length, duration_ms: now() - t0 };
  } catch (err) {
    return {
      type: 'stock',
      records: 0,
      duration_ms: now() - t0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Full Sync ────────────────────────────────────────────────────────────────

export async function runFullSync(company_id: string): Promise<SyncResult[]> {
  const results: SyncResult[] = [];

  // Ordem importa: tabelas → produtos → preços → clientes
  results.push(await syncPriceTables(company_id));

  const productResults = await syncProducts(company_id);
  results.push(...productResults);

  results.push(await syncPrices(company_id));
  results.push(await syncCustomers(company_id));

  return results;
}

// ─── Sync somente de estoque (rápido, frequente) ──────────────────────────────

export async function runStockSync(company_id: string): Promise<SyncResult> {
  return syncStock(company_id);
}
