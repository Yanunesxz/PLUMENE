import type { UserRole } from '../constants/userRole.js';

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
}

export interface AuthPayload {
  sub: string;
  email: string;
  role: UserRole;
  company_id: string;
  name: string;
  /** Tabela de preço do representante logado (usada para precificar o catálogo). */
  price_table_id?: string | null;
}

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
