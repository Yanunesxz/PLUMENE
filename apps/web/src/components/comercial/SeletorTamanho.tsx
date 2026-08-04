import { useState } from 'react';
import { X, Minus, ImageIcon, Check } from 'lucide-react';
import type { ProductWithPrice } from '@csb/shared';
import { Button } from '../interface/Button.js';
import { ordenarGrade } from './grade.js';
import { cn, formatBRL } from '@/lib/utils';

export interface PickedSize {
  variant_id: string | null;
  size: string;
  quantity: number;
  /** Código da cor no catálogo ("01"). null = peça sem cor cadastrada. */
  color_code?: string | null;
  /** Nome da cor, para a observação do pedido. */
  color_name?: string | null;
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

  // Cores do catálogo impresso desta peça (migração 019). Diferente do
  // `colorGroup`, que são produtos irmãos: aqui é UM produto com N cores.
  const coresCatalogo = active.colors ?? [];
  const temCoresCatalogo = coresCatalogo.length > 0;
  const [corAtiva, setCorAtiva] = useState<string | null>(null);
  const corSelecionada = temCoresCatalogo
    ? (coresCatalogo.find((c) => c.codigo === corAtiva) ?? coresCatalogo[0]!)
    : null;

  // Chave: "productId|codigoDaCor|size" — o lojista monta a grade de uma cor,
  // troca de cor e monta outra sem perder a primeira.
  const [qty, setQty] = useState<Record<string, number>>({});

  const variants = ordenarGrade(active.variants ?? []);
  const key = (size: string) => `${active.id}|${corSelecionada?.codigo ?? '-'}|${size}`;

  const bump = (size: string, delta: number) =>
    setQty((q) => ({ ...q, [key(size)]: Math.max(0, (q[key(size)] ?? 0) + delta) }));

  // Total da peça inteira, somando TODAS as cores — é o que vai para o carrinho.
  const totalPecas = Object.values(qty).reduce((s, n) => s + n, 0);
  const totalValue = totalPecas * (active.price ?? 0);

  /** Quantas peças já marcadas numa cor — para o selo na bolinha. */
  const qtdDaCor = (codigo: string) =>
    variants.reduce((s, v) => s + (qty[`${active.id}|${codigo}|${v.size}`] ?? 0), 0);

  const confirm = () => {
    const lines: PickedSize[] = [];
    // Percorre TODAS as cores, não só a que está na tela: o lojista pode ter
    // marcado 3 na azul, trocado para a rosa e marcado mais 2.
    const cores = temCoresCatalogo ? coresCatalogo : [null];
    for (const cor of cores) {
      for (const v of variants) {
        const n = qty[`${active.id}|${cor?.codigo ?? '-'}|${v.size}`] ?? 0;
        if (n > 0) {
          lines.push({
            variant_id: v.id,
            size: v.size,
            quantity: n,
            color_code: cor?.codigo ?? null,
            color_name: cor?.nome ?? null,
          });
        }
      }
    }
    if (lines.length > 0) onConfirm(active, lines);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-foreground/40" onClick={onClose} aria-hidden />
      <div className="animate-slide-up relative flex max-h-[85vh] w-full max-w-md flex-col rounded-t-2xl bg-card shadow-xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="h-[90px] w-[54px] shrink-0 overflow-hidden rounded-lg bg-sunken">
              {active.image_url ? (
                <img src={active.image_url} alt={active.name} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-primary/40">
                  <ImageIcon className="h-6 w-6" strokeWidth={1.5} />
                </div>
              )}
            </div>
            <div className="min-w-0">
              <p className="line-clamp-2 text-[15px] leading-snug text-foreground">{active.name}</p>
              <p className="mt-1 flex items-baseline gap-2">
                <span className="tnum font-mono text-[11px] font-semibold tracking-wide text-subtle">
                  {active.sku}
                </span>
                {active.price != null && (
                  <span className="tnum text-sm font-semibold text-foreground">{formatBRL(active.price)}</span>
                )}
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
          {/* Cores do catálogo impresso: o lojista escolhe uma, monta a grade,
              troca e monta outra. O que já marcou fica guardado por cor. */}
          {temCoresCatalogo ? (
            <div className="mb-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Cores / Estampas:{' '}
                <span className="text-foreground">{corSelecionada?.nome ?? '—'}</span>
              </p>
              <div className="flex flex-wrap gap-2.5">
                {coresCatalogo.map((c) => {
                  const selecionada = c.codigo === (corSelecionada?.codigo ?? '');
                  const marcadas = qtdDaCor(c.codigo);
                  return (
                    <button
                      key={c.codigo}
                      type="button"
                      title={c.nome ?? c.codigo}
                      onClick={() => setCorAtiva(c.codigo)}
                      aria-label={`Cor ${c.nome ?? c.codigo}`}
                      aria-pressed={selecionada}
                      className={cn(
                        'relative flex h-11 w-11 flex-col items-center justify-center rounded-full border text-[10px] font-semibold transition',
                        selecionada
                          ? 'border-foreground ring-2 ring-foreground/25'
                          : 'border-border hover:border-foreground/50',
                      )}
                      style={
                        c.variadas
                          ? { background: SORTIDO_GRADIENT }
                          : { backgroundColor: c.hex ?? FALLBACK_HEX }
                      }
                    >
                      {/* O número é o que a fábrica confere na separação. */}
                      <span className="rounded bg-card/85 px-1 text-foreground">{c.codigo}</span>
                      {marcadas > 0 && (
                        <span className="tnum absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-foreground px-1 text-[10px] font-bold text-background">
                          {marcadas}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* Cor: sempre visível. Com variações → bolinhas de cor; sem cor → "Sortido". */}
          <div className={cn('mb-4', temCoresCatalogo && 'hidden')}>
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
                        selected ? 'border-primary ring-2 ring-primary/30' : 'border-border hover:border-primary/50',
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
                  className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-primary ring-2 ring-primary/30"
                  style={{ background: SORTIDO_GRADIENT }}
                >
                  <Check className="h-4 w-4 text-white drop-shadow" strokeWidth={3} />
                </span>
                <span className="text-sm font-medium text-foreground">Sortido</span>
              </div>
            )}
          </div>

          <p className="mb-2.5 text-xs font-medium text-muted-foreground">
            {corSelecionada
              ? `Quantidade por tamanho — ${corSelecionada.nome ?? corSelecionada.codigo}`
              : 'Quantidade por tamanho'}
          </p>
          {variants.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Esta cor não tem grade de tamanhos cadastrada.
            </p>
          ) : (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
              {variants.map((v) => {
                const q = qty[key(v.size)] ?? 0;
                return (
                  <div key={v.id} className="flex flex-col items-stretch">
                    {/* A peça inteira é o alvo: toca e soma 1. É como o
                        representante anota no papel — "P:2 M:4" — em vez de
                        caçar um "+" de 9px por linha. */}
                    <button
                      type="button"
                      onClick={() => bump(v.size, 1)}
                      disabled={!v.in_stock}
                      aria-label={`Adicionar tamanho ${v.size}`}
                      className={cn(
                        'flex aspect-square flex-col items-center justify-center rounded-lg border transition-colors',
                        !v.in_stock
                          ? 'cursor-not-allowed border-dashed border-border bg-transparent text-subtle'
                          : q > 0
                            ? 'border-foreground bg-foreground text-background'
                            : 'border-input bg-card text-foreground hover:border-foreground',
                      )}
                    >
                      <span className={cn('text-sm font-semibold', !v.in_stock && 'line-through')}>{v.size}</span>
                      {v.in_stock ? (
                        q > 0 && <span className="tnum text-lg font-bold leading-none">{q}</span>
                      ) : (
                        <span className="text-[9px] uppercase tracking-wide">esgot.</span>
                      )}
                    </button>
                    {q > 0 && (
                      <button
                        type="button"
                        onClick={() => bump(v.size, -1)}
                        aria-label={`Remover uma peça do tamanho ${v.size}`}
                        className="mt-1 flex h-7 items-center justify-center rounded text-xs font-medium text-subtle hover:bg-muted hover:text-foreground"
                      >
                        <Minus className="h-3.5 w-3.5" strokeWidth={2.5} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div
          className="border-t border-border p-4"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
        >
          <div className="mb-3 flex items-center justify-between text-sm">
            <span className="tnum text-muted-foreground">
              {totalPecas} {totalPecas === 1 ? 'peça' : 'peças'}
              {temCoresCatalogo
                ? ''
                : hasColors
                  ? active.color_name
                    ? ` · ${active.color_name}`
                    : ''
                  : ' · Sortido'}
            </span>
            {active.price != null && (
              <span className="tnum text-base font-semibold text-foreground">{formatBRL(totalValue)}</span>
            )}
          </div>
          {/* Resumo por cor: sem ele o lojista que marcou 3 azuis e trocou para
              a rosa não tem como conferir o que já pediu sem voltar bolinha a
              bolinha. */}
          {temCoresCatalogo && totalPecas > 0 && (
            <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
              {coresCatalogo
                .filter((c) => qtdDaCor(c.codigo) > 0)
                .map((c) => `${qtdDaCor(c.codigo)} ${c.nome ?? c.codigo}`)
                .join(' · ')}
            </p>
          )}
          <Button size="lg" className="w-full" disabled={totalPecas === 0} onClick={confirm}>
            Adicionar ao pedido
          </Button>
        </div>
      </div>
    </div>
  );
}
