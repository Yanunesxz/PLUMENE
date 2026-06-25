import { ShoppingBag, ClipboardList, Users, LayoutDashboard, Contact, Wallet } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { UserRole } from '@csb/shared';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Casa exata da rota (evita "ativo" em sub-rotas). */
  end?: boolean;
}

const repItems: NavItem[] = [
  { to: '/catalog', label: 'Catálogo', icon: ShoppingBag },
  { to: '/orders', label: 'Pedidos', icon: ClipboardList },
  { to: '/customers', label: 'Clientes', icon: Users },
];

const managerItems: NavItem[] = [
  { to: '/dashboard', label: 'Painel', icon: LayoutDashboard },
  { to: '/catalog', label: 'Catálogo', icon: ShoppingBag },
  { to: '/orders', label: 'Pedidos', icon: ClipboardList },
  { to: '/customers', label: 'Clientes', icon: Users },
  { to: '/representantes', label: 'Representantes', icon: Contact },
  { to: '/comissoes', label: 'Comissões', icon: Wallet },
];

export function navItemsForRole(role: UserRole | undefined): NavItem[] {
  return role === 'manager' || role === 'admin' ? managerItems : repItems;
}
