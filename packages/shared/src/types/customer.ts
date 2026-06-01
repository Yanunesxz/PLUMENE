// ─── Tabela de preço ──────────────────────────────────────────────────────────
export interface PriceTable {
  id: string;
  company_id: string;
  /** Código ERP — TABELA_PRECO.TABELA_PRECO */
  erp_code: string | null;
  name: string;
  /**
   * Coluna de preço a usar (1–6) — campo COLUNA_TABELA_PRECO do pedido ERP.
   * Corresponde a PRECO1…PRECO6 na ITENS_TABELA_PRECO.
   * Padrão: 1
   */
  price_column: number;
}

// ─── Cliente ──────────────────────────────────────────────────────────────────
export interface Customer {
  id: string;
  company_id: string;
  /** Código ERP — CLIENTE.CLIENTE (CHAR 5) */
  erp_id: string | null;
  /** Razão Social — CLIENTE.RAZAO_SOCIAL */
  name: string;
  /** Nome Fantasia — CLIENTE.NOME_FANTASIA */
  trade_name: string | null;
  /** CNPJ ou CPF */
  cnpj: string | null;
  /** Código do representante vinculado — CLIENTE.REPRESENTANTE */
  rep_erp_id: string | null;
  price_table_id: string | null;
  /** CLIENTE.BLOQUEADO = 'S' */
  blocked: boolean;
  /** CLIENTE.TEXTO_BLOQUEIO (blob) */
  block_reason: string | null;
  /** Limite de crédito — CLIENTE.LIMITE_CREDITO */
  credit_limit: number | null;
  /** WhatsApp principal */
  whatsapp: string | null;
  /** E-mail */
  email: string | null;
  updated_at: string;
}

export interface CustomerWithPriceTable extends Customer {
  price_table: PriceTable | null;
}
