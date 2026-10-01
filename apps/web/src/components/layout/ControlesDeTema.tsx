import { Monitor, Moon, Sun } from 'lucide-react';
import { alternarTema, definirTema, useEscolhaDeTema, type EscolhaDeTema } from '../../lib/tema.js';
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

const OPCOES: Array<{ valor: EscolhaDeTema; rotulo: string; Icone: typeof Monitor }> = [
  { valor: '', rotulo: 'Aparelho', Icone: Monitor },
  { valor: 'light', rotulo: 'Claro', Icone: Sun },
  { valor: 'dark', rotulo: 'Escuro', Icone: Moon },
];

/** Aparelho · Claro · Escuro — a escolha fica guardada neste aparelho. */
export function EscolhaDeTemaSegmentada({ className }: { className?: string }) {
  const atual = useEscolhaDeTema();
  return (
    <div role="group" aria-label="Tema" className={cn('inline-flex rounded-lg border border-border bg-muted p-0.5', className)}>
      {OPCOES.map(({ valor, rotulo, Icone }) => (
        <button
          key={rotulo}
          type="button"
          aria-pressed={atual === valor}
          onClick={() => definirTema(valor)}
          className={cn(
            'flex min-h-touch items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors',
            atual === valor ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Icone className="h-3.5 w-3.5" />
          {rotulo}
        </button>
      ))}
    </div>
  );
}

/** "Criado por Yan Nunes" — uma linha pequena, como marca d'água (sistema de cliente). */
export function Credito({ className }: { className?: string }) {
  return (
    <footer className={cn('flex justify-center px-4 py-3 text-xs text-muted-foreground', className)}>
      <span>
        Criado por{' '}
        <a href="https://github.com/Yanunesxz" rel="noopener noreferrer" target="_blank" className="font-medium">
          Yan Nunes
        </a>
      </span>
    </footer>
  );
}
