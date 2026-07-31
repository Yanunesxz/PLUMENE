export const USER_ROLE = {
  ADMIN: 'admin',
  MANAGER: 'manager',
  REP: 'rep',
  /** Loja: o cliente logado, comprando por conta própria. */
  STORE: 'store',
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
};

/** Compram, mas não decidem: o pedido deles sempre vai para aprovação. */
export const PAPEIS_COMPRADORES: readonly AuthRole[] = ['store', 'guest'];

export const ehComprador = (papel: AuthRole): boolean => PAPEIS_COMPRADORES.includes(papel);
