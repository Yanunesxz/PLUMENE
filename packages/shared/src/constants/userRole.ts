export const USER_ROLE = {
  ADMIN: 'admin',
  MANAGER: 'manager',
  REP: 'rep',
  /** Loja: o cliente logado, comprando por conta própria. */
  STORE: 'store',
  /**
   * Financeiro: recebe o que a fábrica aprovou e cuida do faturamento.
   * É "quase gerente" — cria e altera pedido, vê todos os clientes e o
   * catálogo — mas sem a parte de representantes (migração 030).
   */
  FINANCEIRO: 'financeiro',
} as const;

export type UserRole = (typeof USER_ROLE)[keyof typeof USER_ROLE];

/**
 * Papel dentro do token.
 *
 * `guest` NÃO é papel de banco: é a sessão de quem abriu uma vitrine
 * temporária. Não existe usuário, não existe senha, e o token morre junto com o
 * link. Por isso ele vive aqui e não em `UserRole`, que continua sendo só o que
 * a coluna `users.role` aceita.
 */
export type AuthRole = UserRole | 'guest';

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrador',
  manager: 'Gerente',
  rep: 'Representante',
  store: 'Loja',
  financeiro: 'Financeiro',
};

/**
 * Os papéis da FÁBRICA que enxergam e mexem em pedido de qualquer
 * representante. O financeiro entra aqui: ele decide sobre faturamento, não
 * sobre carteira — a parte de representantes continua fora do alcance dele.
 */
export const PAPEIS_DA_FABRICA: readonly AuthRole[] = ['admin', 'manager', 'financeiro'];

/** Compram, mas não decidem: o pedido deles sempre vai para aprovação. */
export const PAPEIS_COMPRADORES: readonly AuthRole[] = ['store', 'guest'];

export const ehComprador = (papel: AuthRole): boolean => PAPEIS_COMPRADORES.includes(papel);
