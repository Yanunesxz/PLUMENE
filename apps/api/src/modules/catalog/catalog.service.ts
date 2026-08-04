import { supabase } from '../../config/supabase.js';
import { buscarPorIds, buscarTudo } from '../../lib/paginacao.js';
import type { CatalogColor, CatalogVariant, ProductWithPrice } from '@csb/shared';

/** Tabelas de preço da empresa (id + nome) — para o seletor de consulta no catálogo. */
export async function listCompanyPriceTables(
  company_id: string,
): Promise<{ id: string; name: string }[]> {
  const { data, error } = await supabase
    .from('price_tables')
    .select('id, name')
    .eq('company_id', company_id)
    .order('name');

  if (error || !data) return [];
  return data as { id: string; name: string }[];
}

/** Garante que a tabela de preço pertence à empresa (evita consultar tabela de outra empresa). */
export async function priceTableBelongsToCompany(
  price_table_id: string,
  company_id: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('price_tables')
    .select('id')
    .eq('id', price_table_id)
    .eq('company_id', company_id)
    .maybeSingle();
  return !!data;
}

export interface CatalogOptions {
  price_table_id?: string | undefined;
  /**
   * Envia a quantidade disponível por tamanho. Só gerente/admin: a posição de
   * estoque da fábrica não é informação do representante.
   */
  includeStock?: boolean;
  /**
   * Descarta o que não tem preço na tabela consultada. Ligado para o
   * representante: produto sem preço entrava no carrinho a R$ 0 e o pedido
   * inteiro era recusado no servidor com PRICE_NOT_FOUND.
   */
  onlyPriced?: boolean;
}

// Colunas que o app realmente usa. `select('*')` arrastava company_id,
// description e updated_at em 313 produtos — peso morto no 3G do representante.
//
// `erp_id` e `group_name` saíram na mesma linha de raciocínio: nenhuma tela lê
// os dois. Iam junto em todo produto, em toda abertura do catálogo, para nada.
const PRODUCT_COLUMNS =
  'id, sku, name, collection, brand, image_url, variant_group, color_name, color_hex, active';

export async function getProducts(
  company_id: string,
  options: CatalogOptions = {},
): Promise<ProductWithPrice[]> {
  const { price_table_id, includeStock = false, onlyPriced = false } = options;

  const products = await buscarTudo<Record<string, unknown>>((de, ate) =>
    supabase
      .from('products')
      .select(PRODUCT_COLUMNS)
      .eq('company_id', company_id)
      .eq('active', true)
      .order('name')
      .range(de, ate),
  );

  if (products.length === 0) return [];

  const productIds = products.map((p) => p.id as string);

  // Variantes (tamanhos) de cada produto — a grade vem do ERP (adulto P/M/G…,
  // juvenil/infantil em números). Cores são sortidas, então é só (produto×tamanho).
  //
  // PAGINADO, e não é zelo à toa: são ~5 tamanhos para cada um dos 313 produtos,
  // ou seja ~1.500 linhas contra o teto de 1.000 do PostgREST. Numa consulta só,
  // um terço do catálogo voltava SEM grade — e produto sem grade não abre o
  // seletor de tamanho, então simplesmente não dava para vender. O corte é
  // silencioso: vem um array menor, sem erro nenhum.
  const variants = await buscarPorIds<{
    id: string;
    product_id: string;
    size: string;
    stock_quantity: number;
    stock_committed: number;
  }>(productIds, (lote, de, ate) =>
    supabase
      .from('product_variants')
      .select('id, product_id, size, stock_quantity, stock_committed')
      .in('product_id', lote)
      .eq('active', true)
      .range(de, ate),
  );

  const variantsByProduct = new Map<string, CatalogVariant[]>();
  for (const v of variants) {
    const pid = v.product_id;
    // O ERP às vezes devolve estoque negativo (baixa lançada antes da entrada).
    // Piso em zero: negativo não é "menos que esgotado", é esgotado.
    const available = Math.max(0, v.stock_quantity - v.stock_committed);
    const arr = variantsByProduct.get(pid) ?? [];
    arr.push({
      id: v.id,
      size: v.size,
      in_stock: available > 0,
      ...(includeStock ? { available } : {}),
    });
    variantsByProduct.set(pid, arr);
  }

  // Cores do catálogo impresso (migração 019). Paginado pelo mesmo motivo das
  // variantes: são ~3 cores para cada um dos 152 produtos que têm.
  //
  // A migração pode não estar aplicada — nesse caso o PostgREST recusa e o
  // catálogo segue sem cor, em vez de abrir vazio.
  const coresPorProduto = new Map<string, CatalogColor[]>();
  try {
    const cores = await buscarPorIds<{
      product_id: string;
      codigo: string;
      nome: string | null;
      hex: string | null;
      variadas: boolean;
      ordem: number;
    }>(productIds, (lote, de, ate) =>
      supabase
        .from('product_colors')
        .select('product_id, codigo, nome, hex, variadas, ordem')
        .in('product_id', lote)
        .order('ordem')
        .range(de, ate),
    );
    for (const c of cores) {
      const arr = coresPorProduto.get(c.product_id) ?? [];
      arr.push({ codigo: c.codigo, nome: c.nome, hex: c.hex, variadas: c.variadas });
      coresPorProduto.set(c.product_id, arr);
    }
  } catch {
    /* sem a 019 o catálogo continua funcionando, só sem bolinha de cor */
  }

  const priceMap = new Map<string, number>();
  if (price_table_id) {
    // Uma linha por produto nesta tabela, então hoje cabe folgado — mas paginado
    // pelo mesmo motivo: o dia em que o catálogo passar de 1.000 itens, o preço
    // sumiria em silêncio e metade do catálogo abriria vazia.
    const prices = await buscarPorIds<{ product_id: string; price: number }>(
      productIds,
      (lote, de, ate) =>
        supabase
          .from('product_prices')
          .select('product_id, price')
          .eq('price_table_id', price_table_id)
          .in('product_id', lote)
          .range(de, ate),
    );
    for (const pp of prices) priceMap.set(pp.product_id, pp.price);
  }

  const withPrice = products.map((p) => ({
    ...p,
    price: priceMap.get(p.id as string) ?? null,
    variants: variantsByProduct.get(p.id as string) ?? [],
    colors: coresPorProduto.get(p.id as string) ?? [],
  })) as ProductWithPrice[];

  return onlyPriced ? withPrice.filter((p) => p.price != null) : withPrice;
}
