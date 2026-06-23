import { useState, useCallback } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { Sparkles, LogOut, WifiOff } from 'lucide-react';
import { BottomNav } from './BottomNav.js';
import { SideNav } from './SideNav.js';
import { Toast } from '../ui/Toast.js';
import { useAuthStore } from '../../store/authStore.js';
import { useSyncOnReconnect } from '../../hooks/useSyncOnReconnect.js';
import { useOnlineStatus } from '../../hooks/useOnlineStatus.js';

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
    <div className="flex min-h-screen bg-muted/30">
      <SideNav />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar (apenas mobile — no desktop a marca fica na sidebar) */}
        <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-border bg-card px-4 safe-top md:hidden">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-700 text-white">
              <Sparkles className="h-4 w-4" strokeWidth={2} />
            </span>
            <span className="text-base font-bold tracking-tight text-foreground">Corpo Sensual</span>
            {!isOnline && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                <WifiOff className="h-3 w-3" strokeWidth={2.5} />
                Offline
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">
              {initials}
            </span>
            <button
              type="button"
              onClick={handleLogout}
              aria-label="Sair"
              className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <LogOut className="h-[18px] w-[18px]" />
            </button>
          </div>
        </header>

        <main className="min-w-0 flex-1 overflow-x-hidden pb-20 md:pb-0">
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
