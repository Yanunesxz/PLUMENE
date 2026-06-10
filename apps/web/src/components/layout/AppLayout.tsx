import { useState, useCallback } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { LogOut, WifiOff } from 'lucide-react';
import { BottomNav } from './BottomNav.js';
import { SideNav } from './SideNav.js';
import { Toast } from '../ui/Toast.js';
import { useAuthStore } from '../../store/authStore.js';
import { useSyncOnReconnect } from '../../hooks/useSyncOnReconnect.js';
import { useOnlineStatus } from '../../hooks/useOnlineStatus.js';
import { USER_ROLE_LABELS } from '@csb/shared';

export function AppLayout() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const isOnline = useOnlineStatus();
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  const handleSynced = useCallback((count: number) => {
    setToast({
      message: `${count} pedido${count > 1 ? 's' : ''} sincronizado${count > 1 ? 's' : ''}!`,
      type: 'success',
    });
  }, []);

  const handleFailed = useCallback((count: number) => {
    setToast({
      message: `${count} pedido${count > 1 ? 's' : ''} não puderam ser sincronizados.`,
      type: 'error',
    });
  }, []);

  useSyncOnReconnect({ onSynced: handleSynced, onFailed: handleFailed });

  const handleLogout = useCallback(() => {
    logout();
    navigate('/login', { replace: true });
  }, [logout, navigate]);

  const initials = user?.name?.trim().charAt(0).toUpperCase() || '?';

  return (
    <div className="flex min-h-screen flex-col bg-muted/20">
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-brand-800/40 bg-brand-700 px-4 text-white safe-top">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold tracking-tight">Corpo Sensual</span>
          {!isOnline && (
            <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-medium">
              <WifiOff className="h-3 w-3" strokeWidth={2.5} />
              Offline
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden text-right leading-tight sm:block">
            <p className="text-sm font-medium">{user?.name}</p>
            {user?.role && <p className="text-[11px] text-white/70">{USER_ROLE_LABELS[user.role]}</p>}
          </div>
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-sm font-semibold">
            {initials}
          </span>
          <button
            type="button"
            onClick={handleLogout}
            aria-label="Sair"
            className="flex h-11 w-11 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/15 hover:text-white"
          >
            <LogOut className="h-[18px] w-[18px]" />
          </button>
        </div>
      </header>

      <div className="flex flex-1">
        <SideNav />
        <main className="min-w-0 flex-1 overflow-x-hidden pb-20 md:pb-8">
          <div className="mx-auto w-full max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>

      <BottomNav />

      {toast && <Toast message={toast.message} type={toast.type} onDone={() => setToast(null)} />}
    </div>
  );
}
