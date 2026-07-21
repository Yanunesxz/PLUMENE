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
  /** URL da foto do modelo (vinda dos catálogos PDF). Null até ser vinculada. */
  image_url: string | null;
  /**
   * Agrupamento de variações de COR: produtos com o mesmo `variant_group`
   * (na mesma empresa) são o mesmo modelo em cores diferentes — o catálogo
   * mostra um card único com as bolinhas de cor. NULL = produto isolado.
   */
  variant_group: string | null;
  /** Nome da cor desta variante (ex.: "Azul"). NULL = produto sem cor. */
  color_name: string | null;
  /** Cor da bolinha (hex), calculada a partir da foto no upload. NULL = fallback. */
  color_hex: string | null;
  active: boolean;
  updated_at: string;
}

// ─── Variante = (produto × tamanho) ──────────────────────────────────────────
// Cores são sempre sortidas: o estoque é somado entre todas as cores do tamanho.
export interface ProductVariant {
  id: string;
  product_id: string;
  company_id: string;
  /**
   * SKU único da variante.
   * Formato: "{PRODUTO}|{TAMANHO}" — cor é sortida, não entra na chave.
   * Ex: "PIJ001|M"
   */
  erp_sku: string;
  size: string;
  /** Estoque de prateleira somado de todas as cores — SUM(ESTOQUE_PRATELEIRA) */
  stock_quantity: number;
  /** Reservado em pedidos somado de todas as cores — SUM(ESTOQUE_PEDIDO) */
  stock_committed: number;
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
