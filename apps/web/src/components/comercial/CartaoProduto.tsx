import { ImageIcon, Plus, Check } from 'lucide-react';
import type { ProductWithPrice } from '@csb/shared';
import { cn, formatBRL } from '@/lib/utils';
import { ordenarGrade } from './grade.js';

interface CartaoProdutoProps {
  product: ProductWithPrice;
  /** Abre o detalhe / seleção de tamanhos. */
  onClick?: (product: ProductWithPrice) => void;
  /** Adiciona rápido ao pedido (mostra o botão +). */
  onAdd?: (product: ProductWithPrice) => void;
  /** Item já está no pedido em montagem. */
  inOrder?: boolean;
  /**
   * Exibe a quantidade em estoque. Só gerente/admin — a API nem manda o número
   * para o representante, então isto só surte efeito quando ele existe.
   */
  showStock?: boolean;
  /** Cores disponíveis (hex das bolinhas). Mais de uma → mostra as opções de cor. */
  swatches?: (string | null)[] | undefined;
}

const FALLBACK_HEX = '#D1D5DB';

export function CartaoProduto({ product, onClick, onAdd, inOrder, showStock = true, swatches }: CartaoProdutoProps) {
  const hasColors = (swatches?.length ?? 0) > 1;
  const grade = ordenarGrade(product.variants ?? []);
  const temGrade = grade.length > 0;
  const outOfStock = temGrade && grade.every((v) => !v.in_stock);
  // A soma só existe para quem recebe `available` (gerente/admin).
  const available = grade.reduce((sum, v) => sum + (v.available ?? 0), 0);
  const clickable = !!onClick;

  return (
    <div
      role={clickable ? 'button' : undefined}
      onClick={onClick ? () => onClick(product) : undefined}
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-primary/40',
        clickable && 'cursor-pointer',
      )}
    >
      {/* 1:1 em vez de 4:5: cabe mais produto na dobra, que é o que importa
          quando o representante rola a lista na frente do lojista. */}
      <div className="relative aspect-square w-full overflow-hidden bg-sunken">
        {product.image_url ? (
          <img
            src={product.image_url}
            alt={product.name}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-primary-soft text-primary/40">
            <ImageIcon className="h-9 w-9" strokeWidth={1.5} />
            <span className="text-xs font-semibold text-primary/50">{product.sku}</span>
          </div>
        )}
        {!product.active && (
          <span className="absolute left-2 top-2 rounded bg-foreground/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-background">
            Inativo
          </span>
        )}
        {outOfStock && (
          <span className="absolute inset-x-0 bottom-0 bg-foreground/75 py-1 text-center text-[11px] font-semibold uppercase tracking-wide text-background">
            Esgotado
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="tnum font-mono text-[11px] font-semibold text-subtle">{product.sku}</span>
          {showStock && available > 0 && (
            <span className="tnum inline-flex items-center rounded bg-primary-soft px-1.5 py-0.5 text-[10px] font-semibold text-primary-soft-foreground">
              {available} un.
            </span>
          )}
        </div>

        <p className="line-clamp-2 text-[13px] font-medium leading-snug text-foreground">{product.name}</p>

        {/* Régua de tamanhos: o esgotado sai riscado. O representante decide se
            vale tocar ANTES de tocar. */}
        {temGrade && (
          <div className="flex flex-wrap gap-1">
            {grade.map((v) => (
              <span
                key={v.id}
                className={cn(
                  'tnum rounded px-1 py-px text-[10px] font-semibold leading-tight',
                  v.in_stock
                    ? 'bg-muted text-muted-foreground'
                    : 'text-subtle line-through decoration-subtle/70',
                )}
              >
                {v.size}
              </span>
            ))}
          </div>
        )}

        {hasColors && (
          <div className="flex items-center gap-1">
            {swatches!.slice(0, 5).map((hex, i) => (
              <span
                key={i}
                className="h-3.5 w-3.5 rounded-full border border-foreground/10"
                style={{ backgroundColor: hex ?? FALLBACK_HEX }}
              />
            ))}
            {swatches!.length > 5 && (
              <span className="tnum text-[10px] font-medium text-subtle">+{swatches!.length - 5}</span>
            )}
          </div>
        )}

        <div className="mt-auto flex items-end justify-between gap-2 pt-1">
          {product.price != null ? (
            <p className="tnum text-[15px] font-bold tracking-tight text-foreground">
              {formatBRL(product.price)}
            </p>
          ) : (
            <p className="text-xs font-medium text-subtle">Sob consulta</p>
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
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-primary/30 bg-primary-soft text-primary-soft-foreground hover:border-primary hover:bg-primary hover:text-primary-foreground',
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
