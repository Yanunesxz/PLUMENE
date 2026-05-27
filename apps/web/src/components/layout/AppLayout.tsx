import { Outlet } from 'react-router-dom';
import { BottomNav } from './BottomNav.js';
import { useAuthStore } from '../../store/authStore.js';

export function AppLayout() {
  const { user } = useAuthStore();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-brand-700 text-white px-4 py-3 flex items-center justify-between shadow-md">
        <span className="font-bold text-lg tracking-wide">Corpo Sensual</span>
        <span className="text-sm opacity-80">{user?.name}</span>
      </header>

      <main className="flex-1 pb-16 md:pb-0 overflow-auto">
        <Outlet />
      </main>

      <BottomNav />
    </div>
  );
}
