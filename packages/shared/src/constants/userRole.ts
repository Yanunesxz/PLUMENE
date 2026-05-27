export const USER_ROLE = {
  ADMIN: 'admin',
  MANAGER: 'manager',
  REP: 'rep',
} as const;

export type UserRole = (typeof USER_ROLE)[keyof typeof USER_ROLE];

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrador',
  manager: 'Gerente',
  rep: 'Representante',
};
