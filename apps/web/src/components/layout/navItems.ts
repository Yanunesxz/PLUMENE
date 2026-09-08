import { ShoppingBag, ClipboardList, Users, LayoutDashboard, Contact, Gauge, UploadCloud, KeyRound, Store, ShieldCheck, CalendarClock, BellRing } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { temPermissao } from '@csb/shared';
import type { UserRole, PermissaoGerente } from '@csb/shared';

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
   * precisar abrir a tela para conferir. `alertas` é o número da central de
   * Alertas do rep (urgentes + não vistos).
   */
  fila?: 'triagem' | 'aprovacao' | 'alertas';
  /** Tecla do gerente que abre esta tela. Sem isto, todo gerente vê o item. */
  permissao?: PermissaoGerente;
}

const repItems: NavItem[] = [
  { to: '/minha-area', label: 'Minha área', short: 'Área', icon: Gauge, fila: 'triagem' },
  { to: '/alertas', label: 'Alertas', icon: BellRing, fila: 'alertas' },
  { to: '/catalog', label: 'Catálogo', icon: ShoppingBag },
  { to: '/orders', label: 'Pedidos', icon: ClipboardList },
  { to: '/customers', label: 'Clientes', icon: Users },
  { to: '/acessos', label: 'Acessos', icon: KeyRound },
];

// A loja compra e acompanha. Nada de carteira nem aprovação.
const storeItems: NavItem[] = [
  { to: '/minha-area', label: 'Minha área', short: 'Área', icon: Store },
  { to: '/catalog', label: 'Catálogo', icon: ShoppingBag },
  { to: '/orders', label: 'Meus pedidos', short: 'Pedidos', icon: ClipboardList },
];

const managerItems: NavItem[] = [
  // Sem número no Painel: a fila de aceite é do financeiro, não do gerente.
  { to: '/dashboard', label: 'Painel', icon: LayoutDashboard },
  { to: '/catalog', label: 'Catálogo', icon: ShoppingBag },
  { to: '/orders', label: 'Pedidos', icon: ClipboardList },
  { to: '/customers', label: 'Clientes', icon: Users },
  // As tarefas que o escritório marcou e o andamento (OK do rep, feitas).
  { to: '/atividades', label: 'Atividades', short: 'Ativ.', icon: CalendarClock },
  { to: '/representantes', label: 'Representantes', short: 'Reps', icon: Contact, permissao: 'gerenciar_representantes' },
  { to: '/acessos', label: 'Acessos', icon: KeyRound },
  // Importar era exclusiva do admin — que continua vendo sempre, porque tecla
  // não se aplica a ele. O gerente só vê se o admin ligar a dele.
  { to: '/importar', label: 'Importar produtos', short: 'Importar', icon: UploadCloud, permissao: 'importar_produtos' },
];

// Controle de logins não tem tecla: é do admin e ponto.
const adminItems: NavItem[] = [
  ...managerItems,
  { to: '/logins', label: 'Logins', icon: ShieldCheck },
];

// O financeiro recebe o que a fábrica aprovou: fatura, ajusta pedido quando
// precisa e confere cadastros. Clientes e representantes são LEITURA (a API
// nega escrita); a área dele traz o botão de atualizar o app.
const financeiroItems: NavItem[] = [
  { to: '/minha-area', label: 'Minha área', short: 'Área', icon: Gauge },
  // O número no menu é a fila "Chegaram": pedidos aguardando o aceite dele.
  { to: '/orders', label: 'Pedidos', icon: ClipboardList, fila: 'aprovacao' },
  { to: '/catalog', label: 'Catálogo', icon: ShoppingBag },
  { to: '/customers', label: 'Clientes', icon: Users },
  { to: '/representantes', label: 'Representantes', short: 'Reps', icon: Contact },
];

// O relacionamento (Bruna) seleciona o cliente e encaminha pro rep — e
// acompanha o OK. Duas telas, de propósito: o resto do sistema não é dela.
const relacionamentoItems: NavItem[] = [
  { to: '/atividades', label: 'Atividades', icon: CalendarClock },
  { to: '/customers', label: 'Clientes', icon: Users },
];

export function navItemsForRole(
  role: UserRole | undefined,
  permissions?: PermissaoGerente[] | null,
): NavItem[] {
  const daFabrica = role === 'admin' ? adminItems : role === 'manager' ? managerItems : null;
  if (daFabrica && role) {
    return daFabrica.filter((i) => !i.permissao || temPermissao(role, permissions ?? null, i.permissao));
  }
  if (role === 'financeiro') return financeiroItems;
  if (role === 'relacionamento') return relacionamentoItems;
  if (role === 'store') return storeItems;
  return repItems;
}
