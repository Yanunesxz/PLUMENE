import { Moon, Sun } from 'lucide-react';
import { alternarTema } from '../../lib/tema.js';
import { cn } from '../../lib/utils.js';

/**
 * Lua/sol da barra do topo (Padrão Yan Nunes v0.2.0): a lua aparece no tema
 * claro e o sol no escuro — quem decide é o CSS (`yn-only-light`/`yn-only-dark`),
 * para o ícone certo já sair na primeira pintura.
 */
export function BotaoDeTema({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={alternarTema}
      aria-label="Alternar tema claro e escuro"
      className={cn(
        'flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
        className,
      )}
    >
      <Moon className="yn-only-light h-[18px] w-[18px]" />
      <Sun className="yn-only-dark h-[18px] w-[18px]" />
    </button>
  );
}
