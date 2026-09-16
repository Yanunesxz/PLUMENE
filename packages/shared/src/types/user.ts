import type { AuthRole, UserRole } from '../constants/userRole.js';
import type { PermissaoGerente } from '../constants/permissoes.js';

export interface Company {
  id: string;
  name: string;
  created_at: string;
  /**
   * "Sincronizar agora" (migração 049): quando alguém pediu ao Control que
   * puxe tudo já, e quem. GET /partner/v1/status devolve sincronizar_agora
   * enquanto isto for mais novo que a última passada do Control.
   */
  sync_solicitado_em?: string | null;
  sync_solicitado_por?: string | null;
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
  /**
   * Código do representante no ERP (ex.: "00779"). É o que casa com
   * `customers.rep_erp_id` e define a carteira dele. Sem isto, o rep só vê os
   * clientes que ele mesmo cadastrou no app.
   */
  erp_rep_id?: string | null;
  /**
   * O e-mail do representante NO Control (migração 049). Coluna própria:
   * `email` é o login do app e não muda por causa do ERP.
   */
  erp_email?: string | null;
  /** Venda interna (migração 031): pedido nasce aprovado e ele mesmo fatura. */
  venda_interna?: boolean;
  /** Loja: o cliente que este login representa. Nulo nos demais papéis. */
  customer_id?: string | null;
  /** Loja: o representante que convidou e que recebe os pedidos dela. */
  rep_id?: string | null;
  /**
   * Teclas do gerente. Nulo = padrão do papel (ver `temPermissao`). Só o papel
   * `manager` usa isto: admin tem tudo, rep e loja são delimitados pelo papel.
   */
  permissions?: PermissaoGerente[] | null;
  /** Último login bem-sucedido. Nulo em quem nunca entrou. */
  last_login_at?: string | null;
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
  /** Código ERP do representante — resolve a carteira de clientes. */
  erp_rep_id?: string | null;
  /** Loja: o cliente que este login representa. */
  customer_id?: string | null;
  /**
   * Loja e vitrine: o representante dono, que recebe o pedido para aprovar.
   * Para admin/manager/rep é nulo — o dono é o próprio `sub`.
   */
  rep_id?: string | null;
  /**
   * Representante de VENDA INTERNA (migração 031): o pedido dele nasce
   * aprovado — venda de balcão não pede aprovação da fábrica — e ele mesmo
   * marca o faturado. Ausente/false = representante comum.
   */
  venda_interna?: boolean;
  /** Teclas do gerente, para o guard não precisar ir ao banco a cada requisição. */
  permissions?: PermissaoGerente[] | null;
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
  /** Tabela do catálogo dele — a que vale quando não há cliente em jogo. */
  price_table_id: string | null;
  price_table_name: string | null;
  /**
   * Tabelas que ele PODE atribuir a um cliente ou a uma vitrine (migração 018).
   * Sempre contém `price_table_id`. Com um item só, o rep não escolhe nada e
   * nenhuma rota revela a existência das outras.
   */
  price_table_ids: string[];
  /** Código do rep no ERP — define a carteira de clientes que ele enxerga. */
  erp_rep_id: string | null;
  /** Venda interna: pedido nasce aprovado e ele mesmo fatura (migração 031). */
  venda_interna?: boolean;
  created_at: string;
}

/** Dados mínimos para o gerente cadastrar um representante. */
export interface CreateRepRequest {
  name: string;
  email: string;
  password: string;
  cpf: string;
  /** Tabela do catálogo dele. Se `price_table_ids` vier, precisa estar dentro. */
  price_table_id: string;
  /** Tabelas que ele pode atribuir. Omitido = só a `price_table_id`. */
  price_table_ids?: string[];
  legal_name?: string | null;
  phone?: string | null;
  /** Código do rep no ERP (ex.: "00779"). Sem ele, o rep não recebe carteira. */
  erp_rep_id?: string | null;
  /** Venda interna: pedido nasce aprovado, sem passar pela fábrica. */
  venda_interna?: boolean;
}

/** Edição de representante — todos os campos opcionais (envia só o que mudou). */
export interface UpdateRepRequest {
  name?: string;
  email?: string;
  cpf?: string;
  price_table_id?: string;
  /** Substitui o conjunto inteiro. Ausente = conjunto não muda. */
  price_table_ids?: string[];
  legal_name?: string | null;
  phone?: string | null;
  active?: boolean;
  erp_rep_id?: string | null;
  /** Venda interna: pedido nasce aprovado, sem passar pela fábrica. */
  venda_interna?: boolean;
  /** Se preenchida, redefine a senha; em branco/ausente, mantém a atual. */
  password?: string;
}

// ─── Controle de logins (admin) ───────────────────────────────────────────────
// Papéis que o admin cria por aqui. Representante nasce em `/reps` (precisa de
// CPF, tabela e código ERP) e loja nasce por convite — ter dois lugares
// criando a mesma coisa é como um deles fica esquecido. O financeiro entrou
// na migração 030: login da fábrica, criado como os outros.
export type PapelGerenciavel = Extract<UserRole, 'admin' | 'manager' | 'financeiro' | 'relacionamento'>;

/** Um login na tela do admin. Nunca carrega hash de senha. */
export interface UsuarioListItem {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  last_login_at: string | null;
  /** Só faz sentido em gerente. Nulo = padrão do papel. */
  permissions: PermissaoGerente[] | null;
  created_at: string;
}

export interface CriarUsuarioRequest {
  name: string;
  email: string;
  password: string;
  role: PapelGerenciavel;
  /** Omitido em gerente = padrão do papel. Ignorado quando o papel é admin. */
  permissions?: PermissaoGerente[];
}

/** Edição — só o que veio no corpo muda. */
export interface AtualizarUsuarioRequest {
  name?: string;
  email?: string;
  /** Preenchida, redefine a senha. Ausente ou vazia, mantém a atual. */
  password?: string;
  active?: boolean;
  /** Troca de papel só entre admin e gerente. */
  role?: PapelGerenciavel;
  permissions?: PermissaoGerente[] | null;
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
