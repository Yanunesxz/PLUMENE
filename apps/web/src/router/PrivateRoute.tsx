import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '../store/authStore.js';
import type { AuthRole } from '@csb/shared';

interface PrivateRouteProps {
  roles?: AuthRole[];
}

export function PrivateRoute({ roles }: PrivateRouteProps) {
  const { isAuthenticated, hasRole } = useAuthStore();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (roles && !hasRole(...roles)) {
    return <Navigate to="/unauthorized" replace />;
  }

  return <Outlet />;
}
