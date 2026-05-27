export interface Product {
  id: string;
  company_id: string;
  erp_id: string | null;
  sku: string;
  name: string;
  description: string | null;
  active: boolean;
  updated_at: string;
}

export interface ProductPrice {
  id: string;
  product_id: string;
  price_table_id: string;
  price: number;
  updated_at: string;
}

export interface ProductWithPrice extends Product {
  price: number | null;
}
