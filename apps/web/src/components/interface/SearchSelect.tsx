import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SearchOption {
  value: string;
  label: string;
  sublabel?: string | undefined;
  disabled?: boolean | undefined;
}

interface SearchSelectProps {
  options: SearchOption[];
  value?: string;
  onSelect: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  /** Modo "adicionar": após escolher, não mantém o valor exibido no botão. */
  resetOnSelect?: boolean;
  disabled?: boolean;
  id?: string;
}

// Combobox com busca embutida — substitui o <select> nativo quando há muitos
// itens (clientes, produtos). Filtra por label e sublabel, fecha ao clicar fora.
export function SearchSelect({
  options,
  value,
  onSelect,
  placeholder = 'Selecione…',
  searchPlaceholder = 'Buscar…',
  emptyText = 'Nada encontrado',
  resetOnSelect = false,
  disabled = false,
  id,
}: SearchSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = value ? options.find((o) => o.value === value) : undefined;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, 50);
    return options
      .filter(
        (o) =>
          o.label.toLowerCase().includes(q) || (o.sublabel?.toLowerCase().includes(q) ?? false),
      )
      .slice(0, 50);
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      clearTimeout(t);
    };
  }, [open]);

  const choose = (v: string) => {
    onSelect(v);
    setOpen(false);
    setQuery('');
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        id={id}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex h-11 w-full items-center justify-between gap-2 rounded-lg border border-input bg-background px-3 text-left text-sm',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
      >
        <span className={cn('truncate', (resetOnSelect || !selected) && 'text-muted-foreground')}>
          {resetOnSelect ? placeholder : selected ? selected.label : placeholder}
        </span>
        <ChevronDown
          className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
          strokeWidth={2}
        />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border border-border bg-card shadow-lg">
          <div className="relative border-b border-border p-2">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="h-9 w-full rounded-md bg-muted/50 pl-8 pr-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
          </div>
          <ul className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-3 text-center text-sm text-muted-foreground">{emptyText}</li>
            ) : (
              filtered.map((o) => (
                <li key={o.value}>
                  <button
                    type="button"
                    disabled={o.disabled}
                    onClick={() => choose(o.value)}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted disabled:opacity-40',
                      o.value === value && 'bg-primary-soft',
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-foreground">{o.label}</span>
                      {o.sublabel && (
                        <span className="block truncate text-xs text-muted-foreground">{o.sublabel}</span>
                      )}
                    </span>
                    {o.value === value && <Check className="h-4 w-4 shrink-0 text-primary" />}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
