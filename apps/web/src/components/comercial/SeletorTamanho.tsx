import { useState } from 'react';
import { X, Minus, Plus } from 'lucide-react';
import type { ProductWithPrice } from '@csb/shared';
import { Button } from '../interface/Button.js';
import { formatBRL } from '@/lib/utils';

export interface PickedSize {
  variant_id: string | null;
  size: string;
  quantity: number;
}

interface SeletorTamanhoProps {
  product: ProductWithPrice;
  onClose: () => void;
  onConfirm: (lines: PickedSize[]) => void;
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

export function SeletorTamanho({ product, onClose, onConfirm }: SeletorTamanhoProps) {
  const variants = [...(product.variants ?? [])].sort((a, b) => sizeCompare(a.size, b.size));
  const [qty, setQty] = useState<Record<string, number>>({});

  const bump = (size: string, delta: number) =>
    setQty((q) => ({ ...q, [size]: Math.max(0, (q[size] ?? 0) + delta) }));

  const totalQty = Object.values(qty).reduce((s, n) => s + n, 0);
  const totalValue = totalQty * (product.price ?? 0);

  const confirm = () => {
    const lines: PickedSize[] = variants
      .filter((v) => (qty[v.size] ?? 0) > 0)
      .map((v) => ({ variant_id: v.id, size: v.size, quantity: qty[v.size] ?? 0 }));
    if (lines.length > 0) onConfirm(lines);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-foreground/40" onClick={onClose} aria-hidden />
      <div className="animate-slide-up relative flex max-h-[85vh] w-full max-w-md flex-col rounded-t-2xl bg-card shadow-xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{product.name}</p>
            <p className="text-xs text-muted-foreground">
              {product.sku}
              {product.price != null ? ` · ${formatBRL(product.price)}` : ''}
            </p>
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
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Escolha os tamanhos
          </p>
          {variants.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Este produto não tem grade de tamanhos cadastrada.
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
                      disabled={(qty[v.size] ?? 0) === 0}
                    >
                      <Minus className="h-3.5 w-3.5" strokeWidth={2.5} />
                    </button>
                    <span className="flex h-9 w-10 items-center justify-center border-y border-input bg-background text-sm font-medium text-foreground">
                      {qty[v.size] ?? 0}
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
              {totalQty} {totalQty === 1 ? 'peça' : 'peças'}
            </span>
            {product.price != null && <span className="font-semibold text-foreground">{formatBRL(totalValue)}</span>}
          </div>
          <Button size="lg" className="w-full" disabled={totalQty === 0} onClick={confirm}>
            Adicionar ao pedido
          </Button>
        </div>
      </div>
    </div>
  );
}
