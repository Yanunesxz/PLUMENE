import { useEffect, useState } from 'react';
import { Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '../../services/api.js';
import { Skeleton } from '../../components/interface/Skeleton.js';
import { formatBRL } from '../../lib/utils.js';
import type { ApiResponse, PedidoExcluido } from '@csb/shared';

/**
 * A aba "Excluídos" da lista de pedidos — só o admin vê.
 *
 * Excluir um pedido continua apagando ele do banco (as listas, filas e
 * relatórios nunca o veem de novo). O que fica é a cópia que a API guarda um
 * instante antes do DELETE (migração 040): o pedido inteiro como estava, com
 * as peças, mais quem apagou e quando. Esta tela só lê essa cópia.
 *
 * Pedido do Yan (03/09/2026), depois de dois pedidos da CS sumirem sem
 * rastro: "cria uma aba apenas pro admin visualizar pedidos excluídos".
 */

const STATUS_NA_HORA: Record<string, string> = {
  draft: 'Rascunho',
  pending_rep: 'Com o representante',
  pending_approval: 'Pendente',
  approved: 'Aprovado',
  sent_erp: 'Lançado no ERP',
  rejected: 'Recusado',
};

function quando(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

export function PedidosExcluidos({ token }: { token: string }) {
  const [lista, setLista] = useState<PedidoExcluido[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    api
      .get<ApiResponse<PedidoExcluido[]>>('/orders/excluidos', token)
      .then((res) => {
        if (vivo) setLista(res.data);
      })
      .catch((err: unknown) => {
        if (vivo) setErro(err instanceof Error ? err.message : 'Não deu para carregar os excluídos.');
      });
    return () => {
      vivo = false;
    };
  }, [token]);

  if (erro) {
    return <p className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-foreground">{erro}</p>;
  }
  if (lista === null) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
    );
  }
  if (lista.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Trash2 className="h-7 w-7" strokeWidth={1.5} />
        </div>
        <div className="space-y-0.5">
          <p className="font-medium text-foreground">Nenhum pedido excluído</p>
          <p className="text-sm text-muted-foreground">
            Todo pedido excluído a partir de agora fica guardado aqui, com as peças e quem excluiu.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {lista.length} pedido(s) excluído(s). A cópia é do instante da exclusão; o pedido em si não existe mais.
      </p>
      {lista.map((p) => {
        const s = p.snapshot;
        const pecas = s.items.reduce((soma, i) => soma + (i.quantity ?? 0), 0);
        const expandido = aberto === p.id;
        return (
          <div key={p.id} className="rounded-xl border border-border bg-card p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-0.5">
                <p className="flex flex-wrap items-center gap-x-2 text-sm">
                  <span className="font-mono text-xs text-muted-foreground">#{p.order_number ?? p.order_id.slice(0, 8)}</span>
                  <span className="font-medium text-foreground">{s.customer?.name ?? s.guest_name ?? 'Sem cliente'}</span>
                  {s.customer?.cnpj && <span className="text-xs text-muted-foreground">{s.customer.cnpj}</span>}
                </p>
                <p className="text-xs text-muted-foreground">
                  Rep: {s.rep?.name ?? '—'} · Era: {STATUS_NA_HORA[s.status] ?? s.status}
                  {s.invoiced ? ' (faturado)' : ''} · {pecas} peça(s) · {formatBRL(s.total)}
                </p>
                <p className="text-xs text-muted-foreground">
                  Excluído em {quando(p.deleted_at)} por <span className="font-medium text-foreground">{p.deleted_by_name ?? 'alguém sem nome'}</span>
                  {' '}· criado em {new Date(s.created_at).toLocaleDateString('pt-BR')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAberto(expandido ? null : p.id)}
                aria-expanded={expandido}
                aria-label={expandido ? 'Esconder peças' : 'Ver peças'}
                className="shrink-0 rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {expandido ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
            </div>

            {expandido && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-left text-muted-foreground">
                    <tr>
                      <th className="py-1 pr-3 font-medium">Ref.</th>
                      <th className="py-1 pr-3 font-medium">Peça</th>
                      <th className="py-1 pr-3 font-medium">Tam.</th>
                      <th className="py-1 pr-3 text-right font-medium">Qtd</th>
                      <th className="py-1 pr-3 text-right font-medium">Unit.</th>
                      <th className="py-1 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.items.map((i) => (
                      <tr key={i.id} className="border-t border-border">
                        <td className="py-1 pr-3 font-mono">{i.product?.sku ?? i.product_id.slice(0, 8)}</td>
                        <td className="py-1 pr-3">{i.product?.name ?? '—'}</td>
                        <td className="py-1 pr-3">{i.variant?.size ?? '—'}</td>
                        <td className="py-1 pr-3 text-right">{i.quantity}</td>
                        <td className="py-1 pr-3 text-right">{formatBRL(i.unit_price)}</td>
                        <td className="py-1 text-right">{formatBRL(i.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {s.notes && (
                  <p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Observação: </span>
                    {s.notes}
                  </p>
                )}
                {(s.discount_percent ?? 0) > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">Desconto do pedido: {s.discount_percent}%</p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
