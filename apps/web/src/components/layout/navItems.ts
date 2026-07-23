import { ShoppingBag, ClipboardList, Users, LayoutDashboard, Contact, Wallet, Gauge, UploadCloud } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { UserRole } from '@csb/shared';

export interface NavItem {
  to: string;
  label: string;
  /** Rótulo curto para o menu inferior do celular (6 itens em tela estreita). */
  short?: string;
  icon: LucideIcon;
  /** Casa exata da rota (evita "ativo" em sub-rotas). */
  end?: boolean;
}

// Assistente de IA está EM DESENVOLVIMENTO: fora do menu do representante por ora.
const repItems: NavItem[] = [
  { to: '/minha-area', label: 'Minha área', icon: Gauge },
  { to: '/catalog', label: 'Catálogo', icon: ShoppingBag },
  { to: '/orders', label: 'Pedidos', icon: ClipboardList },
  { to: '/customers', label: 'Clientes', icon: Users },
];

const managerItems: NavItem[] = [
  { to: '/dashboard', label: 'Painel', icon: LayoutDashboard },
  { to: '/catalog', label: 'Catálogo', icon: ShoppingBag },
  { to: '/orders', label: 'Pedidos', icon: ClipboardList },
  { to: '/customers', label: 'Clientes', icon: Users },
  { to: '/representantes', label: 'Representantes', short: 'Reps', icon: Contact },
  { to: '/comissoes', label: 'Comissões', icon: Wallet },
];

const adminItems: NavItem[] = [
  ...managerItems,
  { to: '/importar', label: 'Importar produtos', short: 'Importar', icon: UploadCloud },
];

export function navItemsForRole(role: UserRole | undefined): NavItem[] {
  if (role === 'admin') return adminItems;
  if (role === 'manager') return managerItems;
  return repItems;
}
