import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Minus } from 'lucide-react';
import { quantidadeDigitada } from '../../lib/quantidade.js';
import { cn } from '@/lib/utils';

/** Quanto tempo o dedo fica parado até o campo abrir. */
const SEGURAR_MS = 500;

interface QuadradoDoTamanhoProps {
  size: string;
  quantidade: number;
  emEstoque: boolean;
  /** Soma (ou tira) do que já está marcado. */
  onSomar: (delta: number) => void;
  /** Substitui o valor — é o que o campo faz, e por isso não é `onSomar`. */
  onDefinir: (valor: number) => void;
}

/**
 * Um tamanho da grade.
 *
 * Tocar soma 1, que é como o representante anota no papel — "P:2 M:4" — sem
 * caçar um `+` de 9 pixels por linha. Isso não muda.
 *
 * O que se acrescenta é o caminho para o volume: trinta peças do M eram trinta
 * toques. Segurar o quadrado abre um campo e ele escreve 30.
 */
export function QuadradoDoTamanho({
  size,
  quantidade,
  emEstoque,
  onSomar,
  onDefinir,
}: QuadradoDoTamanhoProps) {
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState('');

  const cronometro = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * O campo abriu por "segurar" — então o clique que vem logo em seguida NÃO
   * pode somar 1. Sem esta trava, quem segura e escreve 30 termina com 31 e só
   * descobre na conferência do pedido.
   */
  const abriuSegurando = useRef(false);
  /** Esc fechou o campo: o `blur` que vem atrás não deve aplicar nada. */
  const cancelou = useRef(false);

  const pararCronometro = () => {
    if (cronometro.current) {
      clearTimeout(cronometro.current);
      cronometro.current = null;
    }
  };

  const comecarASegurar = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!emEstoque || e.button !== 0) return;
    pararCronometro();
    cronometro.current = setTimeout(() => {
      abriuSegurando.current = true;
      setRascunho(quantidade > 0 ? String(quantidade) : '');
      setEditando(true);
    }, SEGURAR_MS);
  };

  const aplicar = () => {
    if (cancelou.current) {
      cancelou.current = false;
      setEditando(false);
      return;
    }
    onDefinir(quantidadeDigitada(rascunho));
    setEditando(false);
  };

  if (editando) {
    return (
      <div className="flex flex-col items-stretch">
        <input
          type="text"
          inputMode="numeric"
          autoFocus
          aria-label={`Quantidade do tamanho ${size}`}
          value={rascunho}
          onChange={(e) => setRascunho(e.target.value)}
          // Todo o valor selecionado: escrever substitui em vez de emendar no
          // que já estava — quem segurou num 4 e digitou 30 quer 30, não 430.
          onFocus={(e) => e.currentTarget.select()}
          onBlur={aplicar}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') {
              cancelou.current = true;
              e.currentTarget.blur();
            }
          }}
          className="tnum flex aspect-square w-full items-center justify-center rounded-lg border-2 border-foreground bg-card text-center text-lg font-bold text-foreground outline-none"
        />
        <span className="mt-1 flex h-7 items-center justify-center text-[10px] font-medium uppercase tracking-wide text-subtle">
          {size}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-stretch">
      {/* A peça inteira é o alvo: toca e soma 1. É como o representante anota no
          papel — "P:2 M:4" — em vez de caçar um "+" de 9px por linha. */}
      <button
        type="button"
        onClick={() => {
          // O clique que fecha o "segurar" não conta como toque.
          if (abriuSegurando.current) {
            abriuSegurando.current = false;
            return;
          }
          onSomar(1);
        }}
        onPointerDown={comecarASegurar}
        // Cancelar em todos os três: sem o `leave`, arrastar a lista com o dedo
        // parado em cima de um tamanho abriria o campo sozinho.
        onPointerUp={pararCronometro}
        onPointerLeave={pararCronometro}
        onPointerCancel={pararCronometro}
        // Segurar no Android abre "copiar/colar" do navegador por cima do campo.
        onContextMenu={(e) => e.preventDefault()}
        disabled={!emEstoque}
        aria-label={`Tamanho ${size}: tocar soma 1, segurar digita a quantidade`}
        className={cn(
          'flex aspect-square select-none flex-col items-center justify-center rounded-lg border transition-colors [-webkit-touch-callout:none]',
          !emEstoque
            ? 'cursor-not-allowed border-dashed border-border bg-transparent text-subtle'
            : quantidade > 0
              ? 'border-foreground bg-foreground text-background'
              : 'border-input bg-card text-foreground hover:border-foreground',
        )}
      >
        <span className={cn('text-sm font-semibold', !emEstoque && 'line-through')}>{size}</span>
        {emEstoque ? (
          quantidade > 0 && <span className="tnum text-lg font-bold leading-none">{quantidade}</span>
        ) : (
          <span className="text-[9px] uppercase tracking-wide">esgot.</span>
        )}
      </button>
      {quantidade > 0 && (
        <button
          type="button"
          onClick={() => onSomar(-1)}
          aria-label={`Remover uma peça do tamanho ${size}`}
          className="mt-1 flex h-7 items-center justify-center rounded text-xs font-medium text-subtle hover:bg-muted hover:text-foreground"
        >
          <Minus className="h-3.5 w-3.5" strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}
