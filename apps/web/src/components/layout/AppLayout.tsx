import { useState, useCallback, useEffect, useRef } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { LogOut, WifiOff } from 'lucide-react';
import { BottomNav } from './BottomNav.js';
import { SideNav } from './SideNav.js';
import { ReconnectBanner } from './ReconnectBanner.js';
import { AvisoDeAtualizacao } from './AvisoDeAtualizacao.js';
import { Logo } from '../interface/Logo.js';
import { Toast } from '../interface/Toast.js';
import { useAuthStore } from '../../store/authStore.js';
import { useSyncOnReconnect } from '../../hooks/useSyncOnReconnect.js';
import { useOnlineStatus } from '../../hooks/useOnlineStatus.js';
import { MARCA } from '../../lib/marca.js';

export function AppLayout() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const isOnline = useOnlineStatus();
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [reconnect, setReconnect] = useState<{ title: string; detail?: string } | null>(null);
  const dismissReconnect = useCallback(() => setReconnect(null), []);

  // Mostra o card de reconexão assim que volta a ficar online (mesmo sem pedidos
  // pendentes). Se houver pedidos na fila, o detalhe é preenchido pelo onSynced.
  const wasOffline = useRef(!isOnline);
  useEffect(() => {
    if (isOnline && wasOffline.current) {
      setReconnect((prev) => prev ?? { title: 'Você está online novamente' });
    }
    wasOffline.current = !isOnline;
  }, [isOnline]);

  const handleSynced = useCallback((count: number) => {
    setReconnect({
      title: 'Você está online novamente',
      detail: `${count} pedido${count > 1 ? 's' : ''} enviado${count > 1 ? 's' : ''} com sucesso`,
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
    <div className="flex min-h-screen bg-background">
      <SideNav />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar (apenas mobile — no desktop a marca fica na sidebar) */}
        <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-border bg-card px-4 safe-top md:hidden">
          <div className="flex items-center gap-2">
            <Logo className="h-11 w-11 shrink-0" />
            <span className="titulo text-[20px] leading-none text-foreground">{MARCA.nome}</span>
            {!isOnline && (
              <span className="inline-flex items-center gap-1 rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-medium text-warn-soft-foreground">
                <WifiOff className="h-3 w-3" strokeWidth={2.5} />
                Offline
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-soft text-sm font-semibold text-primary-soft-foreground">
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

        {/* Em todas as telas: versão nova baixada = um toque e ela entra. */}
        <AvisoDeAtualizacao />

        <main className="min-w-0 flex-1 overflow-x-hidden pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-0">
          <div className="mx-auto w-full max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>

      <BottomNav />

      {reconnect && (
        <ReconnectBanner title={reconnect.title} detail={reconnect.detail} onDone={dismissReconnect} />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onDone={() => setToast(null)} />}
    </div>
  );
}
