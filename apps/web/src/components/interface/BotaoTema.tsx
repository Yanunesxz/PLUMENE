import { useState, useCallback } from 'react';
import { Sun, Moon, MonitorSmartphone } from 'lucide-react';
import { applyTheme, getTheme, nextTheme, type Theme } from '../../lib/theme.js';
import { cn } from '../../lib/utils.js';

const ICON: Record<Theme, typeof Sun> = {
  system: MonitorSmartphone,
  light: Sun,
  dark: Moon,
};

const LABEL: Record<Theme, string> = {
  system: 'Tema: automático',
  light: 'Tema: claro',
  dark: 'Tema: escuro',
};

/** Alterna automático → claro → escuro. Um toque só, sem menu. */
export function BotaoTema({ className }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>(getTheme);
  const Icon = ICON[theme];

  const cycle = useCallback(() => {
    setTheme((atual) => {
      const proximo = nextTheme(atual);
      applyTheme(proximo);
      return proximo;
    });
  }, []);

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={LABEL[theme]}
      title={LABEL[theme]}
      className={cn(
        'flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
        className,
      )}
    >
      <Icon className="h-[18px] w-[18px]" />
    </button>
  );
}
