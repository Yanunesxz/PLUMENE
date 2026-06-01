// ─── Produto base (família de produto, sem grade) ────────────────────────────
export interface Product {
  id: string;
  company_id: string;
  /** Código ERP: campo PRODUTO da tabela PRODUTO */
  erp_id: string | null;
  /** Mesmo que erp_id — código curto ex: "PIJ001" */
  sku: string;
  name: string;
  description: string | null;
  /** Coleção / Catálogo vindo do ERP */
  collection: string | null;
  /** Marca do ERP */
  brand: string | null;
  /** Grupo de produto (ex: Pijama Adulto, Infantil…) */
  group_name: string | null;
  active: boolean;
  updated_at: string;
}

// ─── Variante = (produto × tamanho × cor) ────────────────────────────────────
export interface ProductVariant {
  id: string;
  product_id: string;
  company_id: string;
  /**
   * SKU único da variante.
   * Formato: "{PRODUTO}|{TAMANHO}|{COR}" — espelha a PK do ERP Firebird.
   * Ex: "PIJ001|M|00001"
   */
  erp_sku: string;
  size: string;
  color: string;
  /** Descrição legível da cor (COR.DESCRICAO) */
  color_description: string | null;
  /** Hex para exibição na UI, ex: "#FF5733" */
  color_hex: string | null;
  /** Estoque de prateleira — ESTOQUE_PRODUTO.ESTOQUE_PRATELEIRA */
  stock_quantity: number;
  /** Estoque reservado em pedidos — ESTOQUE_PRODUTO.ESTOQUE_PEDIDO */
  stock_committed: number;
  /** Código de barras — ESTOQUE_PRODUTO.CODIGO_BARRAS */
  barcode: string | null;
  active: boolean;
  updated_at: string;
}

// ─── Preço de variante por tabela ─────────────────────────────────────────────
export interface ProductPrice {
  id: string;
  product_id: string;
  /** Referência à variante (tamanho específico) — pode ser NULL para preço genérico */
  variant_id: string | null;
  price_table_id: string;
  price: number;
  updated_at: string;
}

// ─── Helpers de exibição ──────────────────────────────────────────────────────
export interface ProductWithPrice extends Product {
  price: number | null;
  variants?: ProductVariant[];
}

export interface ProductVariantWithPrice extends ProductVariant {
  price: number | null;
}

/**
 * Payload de catálogo enviado ao frontend.
 * Um produto com todas as suas variantes e respectivos preços
 * filtrados pela tabela de preço do cliente.
 */
export interface CatalogProduct extends Product {
  variants: ProductVariantWithPrice[];
}
