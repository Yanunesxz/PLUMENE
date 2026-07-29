import { NavLink, useNavigate } from 'react-router-dom';
import { LogOut, WifiOff } from 'lucide-react';
import { Logo } from '../interface/Logo.js';
import { BotaoTema } from '../interface/BotaoTema.js';
import { useAuthStore } from '../../store/authStore.js';
import { useOnlineStatus } from '../../hooks/useOnlineStatus.js';
import { navItemsForRole } from './navItems.js';
import { USER_ROLE_LABELS } from '@csb/shared';
import { cn } from '../../lib/utils.js';

export function SideNav() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const isOnline = useOnlineStatus();
  const items = navItemsForRole(user?.role);
  const initials = user?.name?.trim().charAt(0).toUpperCase() || '?';

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-card md:flex">
      {/* Marca */}
      <div className="flex items-center gap-2.5 px-5 py-5">
        <Logo className="h-11 w-11 shrink-0" />
        <div className="leading-tight">
          <p className="text-sm font-bold text-foreground">Corpo Sensual</p>
          <p className="text-[11px] font-medium text-muted-foreground">Representantes</p>
        </div>
      </div>

      {!isOnline && (
        <div className="mx-3 mb-1 flex items-center gap-1.5 rounded-lg bg-warn-soft px-3 py-1.5 text-[11px] font-medium text-warn-soft-foreground">
          <WifiOff className="h-3.5 w-3.5" strokeWidth={2.5} />
          Modo offline
        </div>
      )}

      {/* Navegação */}
      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-2">
        {items.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end ?? false}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary-soft text-primary-soft-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon className="h-[18px] w-[18px]" strokeWidth={isActive ? 2.5 : 2} />
                <span>{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Usuário */}
      <div className="border-t border-border p-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-sm font-semibold text-primary-soft-foreground">
            {initials}
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-sm font-medium text-foreground">{user?.name}</p>
            {user?.role && (
              <p className="truncate text-[11px] text-muted-foreground">{USER_ROLE_LABELS[user.role]}</p>
            )}
          </div>
          <BotaoTema className="h-9 w-9 shrink-0" />
          <button
            type="button"
            onClick={handleLogout}
            aria-label="Sair"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <LogOut className="h-[18px] w-[18px]" />
          </button>
        </div>
      </div>
    </aside>
  );
}
