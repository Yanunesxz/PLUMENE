import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Scissors } from 'lucide-react';
import { formatBRL } from '../../lib/utils.js';
import {
  lerFaturamentoDoPedido,
  type ItemDaFoto,
  type NotaDoPedido,
  type PedidoOriginal as Foto,
} from '@csb/shared';

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
  /**
   * As notas que o Control mandou, com os itens de cada uma (048). Quando há
   * itens em nota ativa, a coluna "Faturado" é o que as notas levaram.
   */
  notas?: NotaDoPedido[] | null | undefined;
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
 * confirmação de que nada foi cortado é justamente a informação. E essa
 * confirmação só sai quando o Control disse alguma coisa (itens da nota ou o
 * valor dela): o corte acontece DENTRO do Control, e sem o detalhe o app não
 * sabe o que saiu. Pelo mesmo motivo, nota que levou parte das peças sem o
 * valor fechado é FATURAMENTO EM PARTES, não corte. A conta inteira mora em
 * `lerFaturamentoDoPedido` (shared).
 */
export function PedidoOriginal({ original, itensAtuais, totalAtual, invoicedTotal, faturado, notas }: Props) {
  const [aberto, setAberto] = useState(false);

  const leitura = useMemo(
    () =>
      lerFaturamentoDoPedido({
        original: original.snapshot.items ?? [],
        itensAtuais,
        totalAtual,
        invoicedTotal,
        faturado,
        notas,
      }),
    [original, itensAtuais, totalAtual, invoicedTotal, faturado, notas],
  );

  if (!leitura.mostrar) return null;

  const d = leitura.diferenca;
  const totalOriginal = original.total ?? null;
  const encolheu = d.pecasAntes > d.pecasDepois;
  const diferencaDaNota = leitura.diferencaDaNota;

  // A última frase: o que a nota levou, o que ainda pode mudar, ou a
  // admissão honesta de que o Control ainda não disse o que faturou.
  const fecho = !faturado
    ? 'O pedido ainda pode mudar até a nota.'
    : leitura.semDetalheDoControl
      ? 'O detalhe do faturamento ainda não chegou do Control.'
      : 'É o que a nota levou.';

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
            <p className="tnum mt-0.5 text-sm font-semibold text-foreground">{d.pecasAntes} peças</p>
            {totalOriginal != null && (
              <p className="tnum text-xs text-muted-foreground">{formatBRL(totalOriginal)}</p>
            )}
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{leitura.rotuloDaDireita}</p>
            <p className="tnum mt-0.5 text-sm font-semibold text-foreground">{d.pecasDepois} peças</p>
            {leitura.valorDaDireita != null && (
              <p className="tnum text-xs text-muted-foreground">{formatBRL(leitura.valorDaDireita)}</p>
            )}
          </div>
        </div>

        {leitura.situacao === 'mudou' && (
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
            {leitura.reprecificou && (
              <>
                O preço das peças mudou {formatBRL(Math.abs(d.valorReprecificado))}{' '}
                {d.valorReprecificado > 0 ? 'para cima' : 'para baixo'} desde o original.{' '}
              </>
            )}
            {leitura.notaDiferente && diferencaDaNota != null && (
              <>
                A nota fechou {formatBRL(Math.abs(diferencaDaNota))}{' '}
                {diferencaDaNota > 0 ? 'abaixo' : 'acima'} do pedido.{' '}
              </>
            )}
            {fecho}
          </p>
        )}

        {leitura.situacao === 'parcial' && (
          <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            Faturado em partes: as notas que chegaram levaram {leitura.pecasFaturadas} das {d.pecasAntes} peças
            do pedido. O restante pode vir em outra nota — por enquanto não dá para dizer o que foi cortado.
          </p>
        )}

        {leitura.situacao === 'igual' && (
          <p className="mt-3 rounded-lg bg-positive-soft px-3 py-2 text-xs text-positive-soft-foreground">
            Faturado igual ao pedido original — nenhuma peça foi cortada.
          </p>
        )}

        {leitura.situacao === 'sem_detalhe' && (
          <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            Pedido faturado. O detalhe do faturamento (as peças e o valor da nota) ainda não chegou do
            Control — por enquanto não dá para dizer se alguma peça foi cortada.
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
                    <span className={l.depois < l.antes ? 'text-danger' : 'text-positive'}>{l.depois}</span>
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
