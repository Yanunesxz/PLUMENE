import { NavLink } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore.js';

const repLinks = [
  { to: '/catalog', label: 'Catálogo', icon: '🛍️' },
  { to: '/orders', label: 'Pedidos', icon: '📋' },
  { to: '/customers', label: 'Clientes', icon: '👥' },
];

const managerLinks = [
  { to: '/dashboard', label: 'Painel', icon: '📊' },
  { to: '/orders', label: 'Pedidos', icon: '📋' },
  { to: '/customers', label: 'Clientes', icon: '👥' },
];

export function BottomNav() {
  const { user } = useAuthStore();
  const links = user?.role === 'manager' || user?.role === 'admin' ? managerLinks : repLinks;

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 safe-bottom z-50 md:hidden">
      <div className="flex">
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center justify-center min-h-[56px] text-xs gap-1 transition-colors ${
                isActive ? 'text-brand-600 font-semibold' : 'text-gray-500'
              }`
            }
          >
            <span className="text-xl leading-none">{link.icon}</span>
            <span>{link.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
