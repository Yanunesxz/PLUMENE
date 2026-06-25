import { ImageIcon, Plus, Check } from 'lucide-react';
import type { ProductWithPrice } from '@csb/shared';
import { cn, formatBRL } from '@/lib/utils';

interface ProductCardProps {
  product: ProductWithPrice;
  /** Abre o detalhe / seleção de tamanhos. */
  onClick?: (product: ProductWithPrice) => void;
  /** Adiciona rápido ao pedido (mostra o botão +). */
  onAdd?: (product: ProductWithPrice) => void;
  /** Item já está no pedido em montagem. */
  inOrder?: boolean;
  /** Exibe a quantidade em estoque (oculto para representantes). */
  showStock?: boolean;
}

export function ProductCard({ product, onClick, onAdd, inOrder, showStock = true }: ProductCardProps) {
  const available = product.variants?.reduce(
    (sum, v) => sum + Math.max(0, v.stock_quantity - v.stock_committed),
    0,
  );
  const hasStock = available != null && (product.variants?.length ?? 0) > 0;
  const outOfStock = hasStock && available === 0;
  const clickable = !!onClick;

  return (
    <div
      role={clickable ? 'button' : undefined}
      onClick={clickable ? () => onClick!(product) : undefined}
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-shadow hover:shadow-md',
        clickable && 'cursor-pointer',
      )}
    >
      <div className="relative aspect-[4/5] w-full overflow-hidden bg-muted">
        {product.image_url ? (
          <img
            src={product.image_url}
            alt={product.name}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-brand-50 to-brand-100 text-brand-300">
            <ImageIcon className="h-9 w-9" strokeWidth={1.5} />
            <span className="text-xs font-semibold text-brand-400">{product.sku}</span>
          </div>
        )}
        {!product.active && (
          <span className="absolute left-2 top-2 rounded-full bg-foreground/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
            Inativo
          </span>
        )}
        {outOfStock && (
          <span className="absolute inset-x-0 bottom-0 bg-foreground/70 py-1 text-center text-[11px] font-semibold uppercase tracking-wide text-white">
            Esgotado
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[11px] font-semibold text-muted-foreground">{product.sku}</span>
          {showStock && hasStock && !outOfStock && (
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-700">
              {available} un.
            </span>
          )}
        </div>

        <p className="line-clamp-2 text-sm font-medium leading-snug text-foreground">{product.name}</p>
        {product.collection && (
          <p className="truncate text-xs text-muted-foreground">Coleção: {product.collection}</p>
        )}

        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          {product.price != null ? (
            <p className="text-base font-bold tracking-tight text-foreground">{formatBRL(product.price)}</p>
          ) : (
            <p className="text-xs font-medium text-muted-foreground">Sob consulta</p>
          )}

          {onAdd && (
            <button
              type="button"
              aria-label={inOrder ? 'Adicionado ao pedido' : 'Adicionar ao pedido'}
              disabled={outOfStock}
              onClick={(e) => {
                e.stopPropagation();
                onAdd(product);
              }}
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors disabled:opacity-40',
                inOrder
                  ? 'border-brand-600 bg-brand-600 text-white'
                  : 'border-brand-200 bg-brand-50 text-brand-700 hover:border-brand-600 hover:bg-brand-600 hover:text-white',
              )}
            >
              {inOrder ? (
                <Check className="h-4 w-4" strokeWidth={2.5} />
              ) : (
                <Plus className="h-4 w-4" strokeWidth={2.5} />
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
