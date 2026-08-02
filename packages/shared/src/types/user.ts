import type { AuthRole, UserRole } from '../constants/userRole.js';

export interface Company {
  id: string;
  name: string;
  created_at: string;
}

export interface User {
  id: string;
  company_id: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  created_at: string;
  /** Representante: CPF, razão social, telefone e tabela de preço atribuída. */
  cpf?: string | null;
  legal_name?: string | null;
  phone?: string | null;
  price_table_id?: string | null;
  /** Percentual de comissão do representante (ex.: 10 = 10%). */
  commission_rate?: number | null;
  /**
   * Código do representante no ERP (ex.: "00779"). É o que casa com
   * `customers.rep_erp_id` e define a carteira dele. Sem isto, o rep só vê os
   * clientes que ele mesmo cadastrou no app.
   */
  erp_rep_id?: string | null;
  /** Loja: o cliente que este login representa. Nulo nos demais papéis. */
  customer_id?: string | null;
  /** Loja: o representante que convidou e que recebe os pedidos dela. */
  rep_id?: string | null;
}

export interface AuthPayload {
  /** Usuário logado. Na vitrine, o id do próprio link — não há usuário. */
  sub: string;
  email: string;
  role: AuthRole;
  company_id: string;
  name: string;
  /** Tabela de preço do representante logado (usada para precificar o catálogo). */
  price_table_id?: string | null;
  /** Percentual de comissão do representante (ex.: 10 = 10%). */
  commission_rate?: number | null;
  /** Código ERP do representante — resolve a carteira de clientes. */
  erp_rep_id?: string | null;
  /** Loja: o cliente que este login representa. */
  customer_id?: string | null;
  /**
   * Loja e vitrine: o representante dono, que recebe o pedido para aprovar.
   * Para admin/manager/rep é nulo — o dono é o próprio `sub`.
   */
  rep_id?: string | null;
}

// (commission_rate em User e AuthPayload são usados pela área do representante)

/** Representante na listagem (gerente/admin), com o nome da tabela resolvido. */
export interface RepListItem {
  id: string;
  name: string;
  email: string;
  cpf: string | null;
  legal_name: string | null;
  phone: string | null;
  active: boolean;
  price_table_id: string | null;
  price_table_name: string | null;
  commission_rate: number;
  /** Código do rep no ERP — define a carteira de clientes que ele enxerga. */
  erp_rep_id: string | null;
  created_at: string;
}

/** Dados mínimos para o gerente cadastrar um representante. */
export interface CreateRepRequest {
  name: string;
  email: string;
  password: string;
  cpf: string;
  price_table_id: string;
  legal_name?: string | null;
  phone?: string | null;
  /** Percentual de comissão (ex.: 10 = 10%). Padrão 10 se omitido. */
  commission_rate?: number;
  /** Código do rep no ERP (ex.: "00779"). Sem ele, o rep não recebe carteira. */
  erp_rep_id?: string | null;
}

/** Edição de representante — todos os campos opcionais (envia só o que mudou). */
export interface UpdateRepRequest {
  name?: string;
  email?: string;
  cpf?: string;
  price_table_id?: string;
  legal_name?: string | null;
  phone?: string | null;
  active?: boolean;
  commission_rate?: number;
  erp_rep_id?: string | null;
  /** Se preenchida, redefine a senha; em branco/ausente, mantém a atual. */
  password?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  refresh_token: string;
  user: Omit<User, 'created_at'>;
}
