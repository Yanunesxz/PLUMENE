import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Scissors } from 'lucide-react';
import { formatBRL } from '../../lib/utils.js';
import { compararComOOriginal, type ItemDaFoto, type PedidoOriginal as Foto } from '@csb/shared';

interface Props {
  /** A cópia guardada pela migração 044. */
  original: Foto;
  /** As peças do pedido HOJE, já com referência e tamanho resolvidos. */
  itensAtuais: ItemDaFoto[];
  /** O total do pedido hoje. */
  totalAtual: number | null;
  /** O valor que a nota fechou, quando o Control informou (027). */
  invoicedTotal?: number | null | undefined;
  faturado: boolean;
}

/**
 * "Veio assim, foi faturado assado" — o pedido que o representante montou ao
 * lado do que a fábrica realmente faturou.
 *
 * Pedido do Yan (11/09/2026): "depois que a gente fatura pode tirar algumas
 * peças que não temos e o pedido vem com menos; precisamos deixar uma cópia do
 * pedido original e como que o pedido foi faturado".
 *
 * O bloco só aparece quando há o que comparar. Um pedido que saiu inteiro não
 * ganha um aviso dizendo que está inteiro — exceto depois da nota, onde a
 * confirmação de que nada foi cortado é justamente a informação.
 */
export function PedidoOriginal({ original, itensAtuais, totalAtual, invoicedTotal, faturado }: Props) {
  const [aberto, setAberto] = useState(false);

  const d = useMemo(
    () => compararComOOriginal(original.snapshot.items ?? [], itensAtuais),
    [original, itensAtuais],
  );

  const totalOriginal = original.total ?? null;
  const valorDeHoje = invoicedTotal ?? totalAtual ?? null;
  const diferencaEmReais =
    totalOriginal != null && valorDeHoje != null
      ? Number((totalOriginal - valorDeHoje).toFixed(2))
      : null;

  // Nada mudou e nem a nota fechou por menos: não há comparação a fazer.
  if (!d.mudou && !(diferencaEmReais && Math.abs(diferencaEmReais) >= 0.01) && !faturado) return null;

  const encolheu = d.pecasAntes > d.pecasDepois || (diferencaEmReais ?? 0) > 0;

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Scissors className="h-4 w-4 text-muted-foreground" strokeWidth={2} />
          Pedido original {faturado ? '× faturado' : '× como está hoje'}
        </h2>
        {d.mudou && (
          <button
            type="button"
            onClick={() => setAberto((a) => !a)}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary transition-colors hover:opacity-80"
          >
            {aberto ? 'Fechar' : `Ver o que mudou (${d.linhas.length})`}
            {aberto ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>

      <div className="px-4 py-3">
        {/* Duas colunas, uma frase cada: é a leitura que o representante faz
            ao telefone com o lojista — "seu pedido veio X, faturou Y". */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Original</p>
            <p className="tnum mt-0.5 text-sm font-semibold text-foreground">
              {d.pecasAntes} peças
            </p>
            {totalOriginal != null && (
              <p className="tnum text-xs text-muted-foreground">{formatBRL(totalOriginal)}</p>
            )}
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {faturado ? 'Faturado' : 'Hoje'}
            </p>
            <p className="tnum mt-0.5 text-sm font-semibold text-foreground">
              {d.pecasDepois} peças
            </p>
            {valorDeHoje != null && (
              <p className="tnum text-xs text-muted-foreground">{formatBRL(valorDeHoje)}</p>
            )}
          </div>
        </div>

        {d.mudou || (diferencaEmReais != null && Math.abs(diferencaEmReais) >= 0.01) ? (
          <p
            className={`mt-3 rounded-lg px-3 py-2 text-xs ${
              encolheu
                ? 'bg-warn-soft text-warn-soft-foreground'
                : 'bg-positive-soft text-positive-soft-foreground'
            }`}
          >
            {d.pecasAntes !== d.pecasDepois && (
              <>
                {encolheu
                  ? `Saíram ${d.pecasAntes - d.pecasDepois} peças do pedido`
                  : `Entraram ${d.pecasDepois - d.pecasAntes} peças no pedido`}
                {diferencaEmReais != null && Math.abs(diferencaEmReais) >= 0.01
                  ? ` · ${formatBRL(Math.abs(diferencaEmReais))} ${encolheu ? 'a menos' : 'a mais'}`
                  : ''}
                .{' '}
              </>
            )}
            {d.pecasAntes === d.pecasDepois &&
              diferencaEmReais != null &&
              Math.abs(diferencaEmReais) >= 0.01 && (
                <>
                  As mesmas peças, mas a nota fechou {formatBRL(Math.abs(diferencaEmReais))}{' '}
                  {encolheu ? 'abaixo' : 'acima'} do pedido.{' '}
                </>
              )}
            {faturado ? 'É o que a nota levou.' : 'O pedido ainda pode mudar até a nota.'}
          </p>
        ) : (
          <p className="mt-3 rounded-lg bg-positive-soft px-3 py-2 text-xs text-positive-soft-foreground">
            Faturado igual ao pedido original — nenhuma peça foi cortada.
          </p>
        )}

        {aberto && d.mudou && (
          <ul className="mt-3 divide-y divide-border border-t border-border">
            {d.linhas.map((l) => (
              <li key={l.chave} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm text-foreground">
                    <span className="font-mono font-semibold">{l.ref || '—'}</span>
                    {l.tamanho ? <span className="text-muted-foreground"> · {l.tamanho}</span> : null}
                  </p>
                  {l.nome && <p className="truncate text-xs text-muted-foreground">{l.nome}</p>}
                </div>
                <div className="shrink-0 text-right">
                  <p className="tnum text-sm text-foreground">
                    {l.antes} <span className="text-muted-foreground">→</span>{' '}
                    <span className={l.depois < l.antes ? 'text-danger' : 'text-positive'}>
                      {l.depois}
                    </span>
                  </p>
                  <p className="tnum text-xs text-muted-foreground">
                    {l.valor > 0 ? `− ${formatBRL(l.valor)}` : `+ ${formatBRL(-l.valor)}`}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
