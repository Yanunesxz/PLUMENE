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
  /** Endereço completo */
  address: string | null;
  updated_at: string;
}

/**
 * Cliente como a lista do app recebe. Subconjunto deliberado de `Customer`: são
 * os campos que as telas realmente usam. A lista completa (1.353 clientes em
 * produção) vai inteira para o cache offline, então cada coluna a mais é peso
 * no 3G do representante — mandar `Customer` inteiro custava 5× isto.
 */
export interface CustomerListItem
  extends Pick<
    Customer,
    | 'id'
    | 'name'
    | 'trade_name'
    | 'cnpj'
    | 'blocked'
    | 'block_reason'
    | 'credit_limit'
    | 'whatsapp'
    // Qual tabela precifica este cliente. Custa 36 caracteres por linha e evita
    // uma segunda requisição por cartão; o rep com duas tabelas ou mais precisa
    // ver isso na lista para saber o que está prestes a mudar.
    | 'price_table_id'
  > {}

/** Dados mínimos para um representante cadastrar um cliente no app. */
export interface CreateCustomerRequest {
  name: string;
  trade_name?: string | null;
  cnpj?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  address?: string | null;
  /**
   * Tabela do cliente. Só quem tem duas ou mais escolhe — para os outros o
   * servidor usa a única que o rep tem. Sempre revalidada contra o conjunto
   * dele: o que vem daqui é pedido, não permissão.
   */
  price_table_id?: string | null;
}

/**
 * A única edição de cliente que o app permite hoje.
 *
 * Deliberadamente estreita: trocar a tabela muda o preço de tudo que a loja
 * comprar dali para frente, e é um risco diferente do de corrigir um telefone.
 */
export interface UpdateCustomerTableRequest {
  price_table_id: string;
}
