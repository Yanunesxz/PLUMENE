import { NavLink } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore.js';
import { usePedidosEsperando } from '../../hooks/usePedidosEsperando.js';
import { useAlertas } from '../../hooks/useAlertas.js';
import { navItemsForRole } from './navItems.js';
import { cn } from '../../lib/utils.js';

export function BottomNav() {
  const { user } = useAuthStore();
  const items = navItemsForRole(user?.role, user?.permissions ?? null);
  const esperando = usePedidosEsperando();
  const alertas = useAlertas();
  // Com 5+ itens (gerente/admin) o espaço por item encolhe: fonte menor e
  // rótulo curto quando existir, para os textos nunca se encostarem.
  const crowded = items.length >= 5;

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-card/95 backdrop-blur safe-bottom md:hidden">
      <div className="mx-auto flex max-w-md items-stretch">
        {items.map(({ to, label, short, icon: Icon, end, fila }) => {
          const aguardando = fila === 'alertas' ? alertas.contagem : fila ? esperando[fila] : 0;
          const urgente = fila === 'alertas' && alertas.temUrgente;
          return (
            <NavLink
              key={to}
              to={to}
              end={end ?? false}
              className={({ isActive }) =>
                cn(
                  'flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-0.5 pb-1.5 pt-2 font-medium transition-colors',
                  crowded ? 'text-[11px]' : 'text-[11px]',
                  isActive ? 'text-primary' : 'text-muted-foreground',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {/* O número fica sobre o ícone: em tela estreita não sobra
                      largura ao lado do rótulo sem espremer os outros itens. */}
                  <span className="relative shrink-0">
                    <Icon className="h-5 w-5" strokeWidth={isActive ? 2.5 : 2} />
                    {aguardando > 0 && (
                      <span
                        aria-label={`${aguardando} aguardando você`}
                        className={cn(
                          'absolute -right-2 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none text-primary-foreground',
                          // Com urgente pendente, o número fica VERMELHO — a
                          // regra do Yan: esse só sai quando a pessoa resolve.
                          urgente ? 'bg-danger' : 'bg-primary',
                        )}
                      >
                        {aguardando > 9 ? '9+' : aguardando}
                      </span>
                    )}
                  </span>
                  <span className="w-full truncate text-center leading-tight">
                    {crowded ? (short ?? label) : label}
                  </span>
                </>
              )}
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
