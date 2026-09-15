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

  // Três coisas que o total mistura e a manchete tem de separar:
  //   corte    → peças que saíram (ou entraram), a preço ORIGINAL: d.valorQueSaiu
  //   preço    → a reprecificação das peças que ficaram: d.valorReprecificado
  //   nota     → o que o Control faturou abaixo do pedido de HOJE
  // Derivar "encolheu" do total fazia um pedido que só ganhou peça aparecer
  // como "saíram −2 peças" quando a tabela tinha baixado de preço.
  const encolheu = d.pecasAntes > d.pecasDepois;
  const reprecificou = Math.abs(d.valorReprecificado) >= 0.01;
  const diferencaDaNota =
    faturado && invoicedTotal != null && totalAtual != null
      ? Number((totalAtual - invoicedTotal).toFixed(2))
      : null;
  const notaDiferente = diferencaDaNota != null && Math.abs(diferencaDaNota) >= 0.01;

  // Nada mudou, o preço é o mesmo e a nota bateu: não há comparação a fazer.
  if (!d.mudou && !reprecificou && !notaDiferente && !faturado) return null;

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

        {d.mudou || reprecificou || notaDiferente ? (
          <p
            className={`mt-3 rounded-lg px-3 py-2 text-xs ${
              encolheu || (diferencaDaNota ?? 0) > 0
                ? 'bg-warn-soft text-warn-soft-foreground'
                : 'bg-positive-soft text-positive-soft-foreground'
            }`}
          >
            {/* O corte, pelo preço que as peças tinham no original: é o que o
                lojista deixou de receber, sem a troca de tabela misturada. */}
            {d.pecasAntes !== d.pecasDepois && (
              <>
                {encolheu
                  ? `Saíram ${d.pecasAntes - d.pecasDepois} peças do pedido`
                  : `Entraram ${d.pecasDepois - d.pecasAntes} peças no pedido`}
                {Math.abs(d.valorQueSaiu) >= 0.01
                  ? ` · ${formatBRL(Math.abs(d.valorQueSaiu))} ${d.valorQueSaiu > 0 ? 'a menos' : 'a mais'}`
                  : ''}
                .{' '}
              </>
            )}
            {d.mudou && d.pecasAntes === d.pecasDepois && (
              <>
                Trocaram peças, mesma quantidade
                {Math.abs(d.valorQueSaiu) >= 0.01
                  ? ` · ${formatBRL(Math.abs(d.valorQueSaiu))} ${d.valorQueSaiu > 0 ? 'a menos' : 'a mais'}`
                  : ''}
                .{' '}
              </>
            )}
            {reprecificou && (
              <>
                O preço das peças mudou {formatBRL(Math.abs(d.valorReprecificado))}{' '}
                {d.valorReprecificado > 0 ? 'para cima' : 'para baixo'} desde o original.{' '}
              </>
            )}
            {diferencaDaNota != null && Math.abs(diferencaDaNota) >= 0.01 && (
              <>
                A nota fechou {formatBRL(Math.abs(diferencaDaNota))}{' '}
                {diferencaDaNota > 0 ? 'abaixo' : 'acima'} do pedido.{' '}
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
