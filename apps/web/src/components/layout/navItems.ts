import { ShoppingBag, ClipboardList, Users, LayoutDashboard, Contact, Wallet, Gauge, UploadCloud, KeyRound, Store } from 'lucide-react';
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
  /**
   * Fila de decisão que este item abre. Quando há pedido parado nela, o menu
   * mostra o número — é assim que o representante descobre que chegou algo sem
   * precisar abrir a tela para conferir.
   */
  fila?: 'triagem' | 'aprovacao';
}

const repItems: NavItem[] = [
  { to: '/minha-area', label: 'Minha área', icon: Gauge, fila: 'triagem' },
  { to: '/catalog', label: 'Catálogo', icon: ShoppingBag },
  { to: '/orders', label: 'Pedidos', icon: ClipboardList },
  { to: '/customers', label: 'Clientes', icon: Users },
  { to: '/acessos', label: 'Acessos', icon: KeyRound },
];

// A loja compra e acompanha. Nada de carteira, comissão ou aprovação.
const storeItems: NavItem[] = [
  { to: '/minha-area', label: 'Minha área', short: 'Área', icon: Store },
  { to: '/catalog', label: 'Catálogo', icon: ShoppingBag },
  { to: '/orders', label: 'Meus pedidos', short: 'Pedidos', icon: ClipboardList },
];

const managerItems: NavItem[] = [
  { to: '/dashboard', label: 'Painel', icon: LayoutDashboard, fila: 'aprovacao' },
  { to: '/catalog', label: 'Catálogo', icon: ShoppingBag },
  { to: '/orders', label: 'Pedidos', icon: ClipboardList },
  { to: '/customers', label: 'Clientes', icon: Users },
  { to: '/representantes', label: 'Representantes', short: 'Reps', icon: Contact },
  { to: '/comissoes', label: 'Comissões', icon: Wallet },
  { to: '/acessos', label: 'Acessos', icon: KeyRound },
];

const adminItems: NavItem[] = [
  ...managerItems,
  { to: '/importar', label: 'Importar produtos', short: 'Importar', icon: UploadCloud },
];

export function navItemsForRole(role: UserRole | undefined): NavItem[] {
  if (role === 'admin') return adminItems;
  if (role === 'manager') return managerItems;
  if (role === 'store') return storeItems;
  return repItems;
}
