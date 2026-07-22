import { useState } from 'react';
import { X, Minus, Plus, ImageIcon, Check } from 'lucide-react';
import type { ProductWithPrice } from '@csb/shared';
import { Button } from '../interface/Button.js';
import { cn, formatBRL } from '@/lib/utils';

export interface PickedSize {
  variant_id: string | null;
  size: string;
  quantity: number;
}

interface SeletorTamanhoProps {
  /** Cor inicialmente selecionada (ou o produto isolado, sem cor). */
  product: ProductWithPrice;
  /** Todas as cores do mesmo modelo (inclui `product`). Se ≤1, não mostra cores. */
  colorGroup?: ProductWithPrice[] | undefined;
  onClose: () => void;
  /** Devolve a cor escolhida (produto) + os tamanhos selecionados. */
  onConfirm: (chosen: ProductWithPrice, lines: PickedSize[]) => void;
}

const SIZE_RANK: Record<string, number> = { PP: 0, P: 1, M: 2, G: 3, GG: 4, EG: 5, EGG: 6, EGGG: 7 };

// Ordena a grade: números (juvenil/infantil) em ordem numérica; letras de adulto
// na ordem PP→EGGG; o resto alfabético.
function sizeCompare(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  const ra = SIZE_RANK[a.toUpperCase()];
  const rb = SIZE_RANK[b.toUpperCase()];
  if (ra != null && rb != null) return ra - rb;
  if (ra != null) return -1;
  if (rb != null) return 1;
  return a.localeCompare(b, 'pt-BR', { numeric: true });
}

const FALLBACK_HEX = '#D1D5DB'; // cinza neutro quando a cor não foi extraída da foto
// Bolinha "arco-íris" para produtos sem cor específica (cores sortidas).
const SORTIDO_GRADIENT =
  'conic-gradient(from 90deg, #ef4444, #f59e0b, #22c55e, #3b82f6, #a855f7, #ef4444)';

export function SeletorTamanho({ product, colorGroup, onClose, onConfirm }: SeletorTamanhoProps) {
  const colors = (colorGroup ?? []).filter((c) => (c.variants?.length ?? 0) >= 0);
  const hasColors = colors.length > 1;

  // Cor ativa (produto). Trocar a cor troca grade, preço e foto. A quantidade é
  // guardada por (cor × tamanho) para não perder o que já foi marcado ao trocar.
  const [activeId, setActiveId] = useState(product.id);
  const active = colors.find((c) => c.id === activeId) ?? product;
  const [qty, setQty] = useState<Record<string, number>>({}); // chave: "productId|size"

  const variants = [...(active.variants ?? [])].sort((a, b) => sizeCompare(a.size, b.size));
  const key = (size: string) => `${active.id}|${size}`;

  const bump = (size: string, delta: number) =>
    setQty((q) => ({ ...q, [key(size)]: Math.max(0, (q[key(size)] ?? 0) + delta) }));

  const activeQty = variants.reduce((s, v) => s + (qty[key(v.size)] ?? 0), 0);
  const totalValue = activeQty * (active.price ?? 0);

  const confirm = () => {
    const lines: PickedSize[] = variants
      .filter((v) => (qty[key(v.size)] ?? 0) > 0)
      .map((v) => ({ variant_id: v.id, size: v.size, quantity: qty[key(v.size)] ?? 0 }));
    if (lines.length > 0) onConfirm(active, lines);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-foreground/40" onClick={onClose} aria-hidden />
      <div className="animate-slide-up relative flex max-h-[85vh] w-full max-w-md flex-col rounded-t-2xl bg-card shadow-xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-muted">
              {active.image_url ? (
                <img src={active.image_url} alt={active.name} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-brand-300">
                  <ImageIcon className="h-6 w-6" strokeWidth={1.5} />
                </div>
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">{active.name}</p>
              <p className="text-xs text-muted-foreground">
                {active.sku}
                {active.price != null ? ` · ${formatBRL(active.price)}` : ''}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {/* Cor: sempre visível. Com variações → bolinhas de cor; sem cor → "Sortido". */}
          <div className="mb-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Cor: <span className="text-foreground">{hasColors ? (active.color_name ?? '—') : 'Sortido'}</span>
            </p>
            {hasColors ? (
              <div className="flex flex-wrap gap-2.5">
                {colors.map((c) => {
                  const selected = c.id === active.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      title={c.color_name ?? c.sku}
                      onClick={() => setActiveId(c.id)}
                      aria-label={`Cor ${c.color_name ?? c.sku}`}
                      aria-pressed={selected}
                      className={cn(
                        'relative flex h-9 w-9 items-center justify-center rounded-full border transition',
                        selected ? 'border-brand-600 ring-2 ring-brand-200' : 'border-border hover:border-brand-300',
                      )}
                      style={{ backgroundColor: c.color_hex ?? FALLBACK_HEX }}
                    >
                      {selected && <Check className="h-4 w-4 text-white drop-shadow" strokeWidth={3} />}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span
                  aria-label="Cores sortidas"
                  className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-brand-600 ring-2 ring-brand-200"
                  style={{ background: SORTIDO_GRADIENT }}
                >
                  <Check className="h-4 w-4 text-white drop-shadow" strokeWidth={3} />
                </span>
                <span className="text-sm font-medium text-foreground">Sortido</span>
              </div>
            )}
          </div>

          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Escolha os tamanhos
          </p>
          {variants.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Esta cor não tem grade de tamanhos cadastrada.
            </p>
          ) : (
            <ul className="space-y-2">
              {variants.map((v) => (
                <li
                  key={v.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
                >
                  <span className="text-sm font-medium text-foreground">Tam {v.size}</span>
                  <div className="flex items-center">
                    <button
                      type="button"
                      onClick={() => bump(v.size, -1)}
                      aria-label={`Diminuir ${v.size}`}
                      className="flex h-9 w-9 items-center justify-center rounded-l-lg border border-input text-foreground transition-colors hover:bg-muted disabled:opacity-40"
                      disabled={(qty[key(v.size)] ?? 0) === 0}
                    >
                      <Minus className="h-3.5 w-3.5" strokeWidth={2.5} />
                    </button>
                    <span className="flex h-9 w-10 items-center justify-center border-y border-input bg-background text-sm font-medium text-foreground">
                      {qty[key(v.size)] ?? 0}
                    </span>
                    <button
                      type="button"
                      onClick={() => bump(v.size, 1)}
                      aria-label={`Aumentar ${v.size}`}
                      className="flex h-9 w-9 items-center justify-center rounded-r-lg border border-input text-foreground transition-colors hover:bg-muted"
                    >
                      <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div
          className="border-t border-border p-4"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
        >
          <div className="mb-3 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {activeQty} {activeQty === 1 ? 'peça' : 'peças'}
              {hasColors ? (active.color_name ? ` · ${active.color_name}` : '') : ' · Sortido'}
            </span>
            {active.price != null && <span className="font-semibold text-foreground">{formatBRL(totalValue)}</span>}
          </div>
          <Button size="lg" className="w-full" disabled={activeQty === 0} onClick={confirm}>
            Adicionar ao pedido
          </Button>
        </div>
      </div>
    </div>
  );
}
