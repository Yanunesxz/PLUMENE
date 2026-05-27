import { useState, useCallback } from 'react';
import { Outlet } from 'react-router-dom';
import { BottomNav } from './BottomNav.js';
import { Toast } from '../ui/Toast.js';
import { useAuthStore } from '../../store/authStore.js';
import { useSyncOnReconnect } from '../../hooks/useSyncOnReconnect.js';
import { useOnlineStatus } from '../../hooks/useOnlineStatus.js';

export function AppLayout() {
  const { user } = useAuthStore();
  const isOnline = useOnlineStatus();
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  const handleSynced = useCallback((count: number) => {
    setToast({ message: `${count} pedido${count > 1 ? 's' : ''} sincronizado${count > 1 ? 's' : ''}!`, type: 'success' });
  }, []);

  const handleFailed = useCallback((count: number) => {
    setToast({ message: `${count} pedido${count > 1 ? 's' : ''} não puderam ser sincronizados.`, type: 'error' });
  }, []);

  useSyncOnReconnect({ onSynced: handleSynced, onFailed: handleFailed });

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-brand-700 text-white px-4 py-3 flex items-center justify-between shadow-md">
        <span className="font-bold text-lg tracking-wide">Corpo Sensual</span>
        <div className="flex items-center gap-2">
          {!isOnline && (
            <span className="text-xs bg-yellow-500 text-yellow-900 font-medium px-2 py-0.5 rounded-full">
              Offline
            </span>
          )}
          <span className="text-sm opacity-80">{user?.name}</span>
        </div>
      </header>

      <main className="flex-1 pb-16 md:pb-0 overflow-auto">
        <Outlet />
      </main>

      <BottomNav />

      {toast && (
        <Toast message={toast.message} type={toast.type} onDone={() => setToast(null)} />
      )}
    </div>
  );
}
