import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '../store/authStore.js';
import { temPermissao } from '@csb/shared';
import type { AuthRole, PermissaoGerente } from '@csb/shared';

interface PrivateRouteProps {
  roles?: AuthRole[];
  /** Tecla do gerente exigida pela tela. Admin passa sempre. */
  permissao?: PermissaoGerente;
}

export function PrivateRoute({ roles, permissao }: PrivateRouteProps) {
  const { isAuthenticated, hasRole, user } = useAuthStore();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (roles && !hasRole(...roles)) {
    return <Navigate to="/unauthorized" replace />;
  }

  // O menu já esconde a tela; isto é para quem chega pelo endereço direto ou
  // por um link salvo de quando ainda tinha a tecla.
  if (permissao && user && !temPermissao(user.role, user.permissions ?? null, permissao)) {
    return <Navigate to="/unauthorized" replace />;
  }

  return <Outlet />;
}
