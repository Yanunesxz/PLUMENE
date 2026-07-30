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
  const faltando = grade.filter((v) => !v.in_stock);
  const outOfStock = temGrade && faltando.length === grade.length;
  const available = grade.reduce((sum, v) => sum + (v.available ?? 0), 0);

  return (
    <div
      role={onClick ? 'button' : undefined}
      onClick={onClick ? () => onClick(product) : undefined}
      className={cn('group flex flex-col gap-2', onClick && 'cursor-pointer')}
    >
      {/* Sem cartão, sem borda, sem sombra: a peça é a unidade. O poço cinza
          existe só para conter o fundo branco de estúdio da foto — sem ele a
          modelo flutuaria no papel. */}
      <div className="relative overflow-hidden rounded-lg bg-sunken">
        {/* 3:4 é a proporção NATIVA de todas as fotos (750×1000). Qualquer outra
            corta: em quadrado, sumiam 125px em cima e 125px embaixo — ou seja, a
            cabeça e os pés da modelo. */}
        <div className="aspect-[3/4] w-full">
          {product.image_url ? (
            <img
              src={product.image_url}
              alt={product.name}
              loading="lazy"
              decoding="async"
              className={cn(
                'h-full w-full object-cover transition-opacity duration-200',
                outOfStock && 'opacity-45',
              )}
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-subtle">
              <ImageIcon className="h-7 w-7" strokeWidth={1.25} />
              <span className="tnum font-mono text-[11px] font-semibold">{product.sku}</span>
            </div>
          )}
        </div>

        {outOfStock && (
          <span className="absolute left-2 top-2 rounded bg-foreground px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-background">
            Esgotado
          </span>
        )}
        {!product.active && !outOfStock && (
          <span className="absolute left-2 top-2 rounded bg-foreground px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-background">
            Inativo
          </span>
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
              'absolute bottom-2 right-2 flex h-9 w-9 items-center justify-center rounded-full shadow-sm transition-colors disabled:opacity-0',
              inOrder
                ? 'bg-foreground text-background'
                : 'bg-card text-foreground hover:bg-foreground hover:text-background',
            )}
          >
            {inOrder ? <Check className="h-4 w-4" strokeWidth={2.5} /> : <Plus className="h-4 w-4" strokeWidth={2.5} />}
          </button>
        )}
      </div>

      <div className="flex flex-col gap-0.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="tnum font-mono text-[11px] font-semibold tracking-wide text-subtle">
            {product.sku}
          </span>
          {showStock && available > 0 && (
            <span className="tnum text-[11px] font-medium text-subtle">{available} un.</span>
          )}
        </div>

        <p className="line-clamp-2 text-[13px] leading-snug text-muted-foreground">{product.name}</p>

        <div className="flex items-center justify-between gap-2 pt-0.5">
          {product.price != null ? (
            <p className="tnum text-[15px] font-semibold tracking-tight text-foreground">
              {formatBRL(product.price)}
            </p>
          ) : (
            <p className="text-xs text-subtle">Sob consulta</p>
          )}

          {hasColors && (
            <div className="flex items-center gap-1">
              {swatches!.slice(0, 4).map((hex, i) => (
                <span
                  key={i}
                  className="h-3 w-3 rounded-full ring-1 ring-inset ring-foreground/15"
                  style={{ backgroundColor: hex ?? FALLBACK_HEX }}
                />
              ))}
              {swatches!.length > 4 && (
                <span className="tnum text-[10px] font-medium text-subtle">+{swatches!.length - 4}</span>
              )}
            </div>
          )}
        </div>

        {/* A grade só aparece quando tem NOTÍCIA. Grade completa não vira linha:
            a ausência já diz "tem tudo". Antes eram 6 chips repetidos em cada
            um dos 160 produtos, dizendo nada na maioria das vezes. */}
        {temGrade && faltando.length > 0 && !outOfStock && (
          <p className="text-[11px] leading-tight text-subtle">
            Sem {faltando.map((v) => v.size).join(', ')}
          </p>
        )}
      </div>
    </div>
  );
}
