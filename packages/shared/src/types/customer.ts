export interface PriceTable {
  id: string;
  company_id: string;
  name: string;
}

export interface Customer {
  id: string;
  company_id: string;
  erp_id: string | null;
  name: string;
  cnpj: string | null;
  price_table_id: string | null;
  blocked: boolean;
  block_reason: string | null;
  updated_at: string;
}

export interface CustomerWithPriceTable extends Customer {
  price_table: PriceTable | null;
}
