import { useMemo, useState } from 'react';
import { RefreshCw, Check, AlertTriangle } from 'lucide-react';
import { Button } from '../interface/Button.js';
import { Textarea } from '../interface/Textarea.js';
import { formatBRL } from '../../lib/utils.js';
import { compararComOOriginal, type ItemDaFoto, type SincroniaComOErp } from '@csb/shared';

interface Props {
  /** O que o Control conhece deste pedido (046). */
  sincronia: SincroniaComOErp;
  /** As peças de HOJE, já com referência e tamanho resolvidos. */
  itensAtuais: ItemDaFoto[];
  /** Quem editou pede a atualização: a venda interna dona, ou o escritório. */
  podePedir: boolean;
  /** Quem mexe no Control confirma que já atualizou lá: financeiro e admin. */
  podeConfirmar: boolean;
  ocupado: boolean;
  erro?: string | null;
  onPedir: (observacao: string) => void;
  onConfirmar: () => void;
}

/**
 * "ATUALIZAR NO ERP" — o pedido mudou depois de ir para o Control.
 *
 * Pedido do Yan (11/09/2026): "depois que o pedido for enviado pelas vendedoras
 * internas e elas alterarem ele, temos que ter um botão depois que editou as
 * peças como 'atualizar no ERP', porque se ela mudar por lá tem que mudar no
 * ERP principal também".
 *
 * A Simone mexe no próprio pedido até o carimbo de faturado, inclusive depois
 * de a Larissa lançar. Sem este bloco, a nota sairia pelo pedido velho e
 * ninguém descobriria antes do faturamento.
 *
 * O cartão só aparece quando as peças de hoje DIVERGEM da fotografia do
 * Control. Pedido em dia não ganha aviso nenhum.
 */
export function AtualizarNoErp({
  sincronia,
  itensAtuais,
  podePedir,
  podeConfirmar,
  ocupado,
  erro,
  onPedir,
  onConfirmar,
}: Props) {
  const [observacao, setObservacao] = useState('');
  const [escrevendo, setEscrevendo] = useState(false);

  const d = useMemo(
    () => compararComOOriginal(sincronia.snapshot.items ?? [], itensAtuais),
    [sincronia, itensAtuais],
  );

  // O Control está em dia: nada a dizer.
  if (!d.mudou) return null;

  const jaPediu = Boolean(sincronia.pedido_em);
  const quando = (iso: string) =>
    new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

  return (
    <div className="rounded-xl border border-warn/40 bg-warn-soft p-4 shadow-sm">
      <div className="flex gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warn-soft-foreground" strokeWidth={2.5} />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold leading-snug text-warn-soft-foreground">
            O Control está com a versão antiga deste pedido
          </p>
          <p className="mt-1 text-sm leading-relaxed text-warn-soft-foreground/90">
            As peças mudaram depois que o pedido foi lançado
            {sincronia.erp_order_id ? ` como ${sincronia.erp_order_id}` : ''}. Enquanto a fábrica não
            atualizar lá, a nota sai pelo pedido velho.
          </p>

          {/* O que exatamente mudou: é a lista que a pessoa vai digitar no
              Control, então ela precisa estar aqui, e não "veja o pedido". */}
          <ul className="mt-3 divide-y divide-warn/30 border-y border-warn/30">
            {d.linhas.map((l) => (
              <li key={l.chave} className="flex items-center justify-between gap-3 py-1.5">
                <span className="min-w-0 truncate text-sm text-warn-soft-foreground">
                  <span className="font-mono font-semibold">{l.ref || '—'}</span>
                  {l.tamanho ? <span className="opacity-80"> · {l.tamanho}</span> : null}
                </span>
                <span className="tnum shrink-0 text-sm text-warn-soft-foreground">
                  {l.antes} <span className="opacity-60">para</span>{' '}
                  <span className="font-semibold">{l.depois}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="tnum mt-1.5 text-xs text-warn-soft-foreground/80">
            No Control: {d.pecasAntes} peças
            {sincronia.total != null ? ` · ${formatBRL(sincronia.total)}` : ''}. Aqui: {d.pecasDepois}{' '}
            peças.
          </p>

          {jaPediu && (
            <p className="mt-2 rounded-lg bg-card/60 px-2.5 py-1.5 text-xs text-warn-soft-foreground">
              Atualização pedida em {quando(sincronia.pedido_em as string)}
              {sincronia.observacao ? `: “${sincronia.observacao}”` : '.'}
            </p>
          )}

          {erro && (
            <p className="mt-2 rounded-lg bg-danger-soft px-2.5 py-1.5 text-xs text-danger-soft-foreground">
              {erro}
            </p>
          )}

          {escrevendo && (
            <div className="mt-3">
              <label htmlFor="erp-obs" className="text-xs font-medium text-warn-soft-foreground">
                Recado para quem vai mexer no Control (opcional)
              </label>
              <Textarea
                id="erp-obs"
                value={observacao}
                rows={2}
                maxLength={500}
                onChange={(e) => setObservacao(e.target.value)}
                placeholder="Ex.: tirei 6 peças da 0124, faltou no estoque."
                className="mt-1"
              />
            </div>
          )}

          <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {podeConfirmar && (
              <Button variant="outline" disabled={ocupado} onClick={onConfirmar}>
                <Check className="h-4 w-4" strokeWidth={2.5} />
                Já atualizei no Control
              </Button>
            )}
            {podePedir && !escrevendo && (
              <Button disabled={ocupado} onClick={() => setEscrevendo(true)}>
                <RefreshCw className="h-4 w-4" strokeWidth={2.5} />
                {jaPediu ? 'Avisar de novo' : 'Atualizar no ERP'}
              </Button>
            )}
            {podePedir && escrevendo && (
              <Button disabled={ocupado} onClick={() => onPedir(observacao)}>
                <RefreshCw className="h-4 w-4" strokeWidth={2.5} />
                {ocupado ? 'Avisando…' : 'Avisar a fábrica'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
