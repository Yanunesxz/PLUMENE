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

// ─── Variante como o catálogo entrega ────────────────────────────────────────
/**
 * Grade que o app recebe. NÃO é a linha do banco: o quanto a fábrica tem em
 * estoque é informação de gerente. O representante recebe só `in_stock` — o
 * bastante para saber se pode vender o tamanho, sem ver a posição da fábrica.
 */
export interface CatalogVariant {
  id: string;
  size: string;
  /** Há peça disponível neste tamanho. Chega para todos os papéis. */
  in_stock: boolean;
  /** Disponível = estoque − comprometido. Só gerente/admin recebem. */
  available?: number;
}

// ─── O que o catálogo entrega ao app ─────────────────────────────────────────
/**
 * Produto como o app recebe e guarda no cache offline. É um subconjunto
 * deliberado de `Product`: `company_id`, `description`, `updated_at`, `erp_id` e
 * `group_name` ficam de fora porque ninguém os usa na tela e multiplicam por 313
 * no payload.
 */
export interface ProductWithPrice
  extends Pick<
    Product,
    | 'id'
    | 'sku'
    | 'name'
    | 'collection'
    | 'brand'
    | 'image_url'
    | 'variant_group'
    | 'color_name'
    | 'color_hex'
    | 'active'
  > {
  /** Preço na tabela consultada. `null` = sem preço nessa tabela. */
  price: number | null;
  variants?: CatalogVariant[];
  /** Cores do catálogo impresso (migração 019). Vazio = peça sem cor definida. */
  colors?: CatalogColor[];
}

// ─── Cor do catálogo impresso ────────────────────────────────────────────────
/**
 * As cores NÃO existem no ERP — lá a fábrica trabalha só com sortido. Elas vêm
 * do catálogo impresso e servem para o lojista pedir "3 na azul". O pedido
 * continua indo ao ERP como sortido; a cor viaja na observação.
 */
export interface CatalogColor {
  /** Número da bolinha no catálogo ("01"). É por ele que a fábrica confere. */
  codigo: string;
  /** Nome legível: "azul marinho", "Cor única", "Variadas", "Cores variadas". */
  nome: string | null;
  /** Cor da bolinha. `null` quando é Variadas — ali a cor não significa peça. */
  hex: string | null;
  /** Bolinha rotulada VARIADAS no catálogo. Nunca chamar de "sortidas". */
  variadas: boolean;
}
