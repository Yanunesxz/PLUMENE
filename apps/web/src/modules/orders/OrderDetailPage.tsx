import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, Package, WifiOff } from 'lucide-react';
import { db } from '../../offline/db.js';
import { useAuthStore } from '../../store/authStore.js';
import { useOnlineStatus } from '../../hooks/useOnlineStatus.js';
import { api } from '../../services/api.js';
import { Badge } from '../../components/ui/Badge.js';
import { Button } from '../../components/ui/Button.js';
import { Skeleton } from '../../components/ui/Skeleton.js';
import { formatBRL } from '../../lib/utils.js';
import { ORDER_STATUS_LABELS } from '@csb/shared';
import type { OrderWithItems, ApiResponse, OrderStatus, ProductWithPrice } from '@csb/shared';

const statusVariant: Record<OrderStatus, 'gray' | 'yellow' | 'green' | 'red' | 'blue'> = {
  draft: 'gray',
  pending_approval: 'yellow',
  approved: 'green',
  rejected: 'red',
  sent_erp: 'blue',
  error_erp: 'red',
};

export function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { token, user } = useAuthStore();
  const isOnline = useOnlineStatus();
  const canInvoice = user?.role === 'manager' || user?.role === 'admin';
  // undefined = carregando, null = não encontrado
  const [order, setOrder] = useState<OrderWithItems | null | undefined>(undefined);
  const [invoicing, setInvoicing] = useState(false);

  const products = useLiveQuery(() => db.products.toArray(), []);
  const customers = useLiveQuery(() => db.customers.toArray(), []);

  const prodMap = useMemo(() => {
    const m = new Map<string, ProductWithPrice>();
    for (const p of products ?? []) m.set(p.id, p);
    return m;
  }, [products]);
  const variantSize = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of products ?? []) for (const v of p.variants ?? []) m.set(v.id, v.size);
    return m;
  }, [products]);
  const custName = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of customers ?? []) m.set(c.id, c.name);
    return m;
  }, [customers]);

  useEffect(() => {
    if (!id) return;
    let cancel = false;
    const fallbackLocal = async () => {
      const local = await db.orders.get(id);
      if (!cancel) setOrder(local ? ({ ...local, items: [] } as OrderWithItems) : null);
    };
    if (token) {
      api
        .get<ApiResponse<OrderWithItems>>(`/orders/${id}`, token)
        .then((r) => {
          if (!cancel) setOrder(r.data);
        })
        .catch(() => void fallbackLocal());
    } else {
      void fallbackLocal();
    }
    return () => {
      cancel = true;
    };
  }, [id, token]);

  const toggleInvoiced = async () => {
    if (!id || !token || !order) return;
    setInvoicing(true);
    try {
      const res = await api.patch<ApiResponse<OrderWithItems>>(
        `/orders/${id}/invoice`,
        { invoiced: !order.invoiced },
        token,
      );
      setOrder((prev) =>
        prev ? { ...prev, invoiced: !!res.data.invoiced, invoiced_at: res.data.invoiced_at ?? null } : prev,
      );
    } catch {
      /* mantém estado anterior */
    } finally {
      setInvoicing(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl p-4 md:p-6">
      <button
        type="button"
        onClick={() => navigate('/orders')}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Voltar
      </button>

      {order === undefined ? (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      ) : order === null ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Package className="h-7 w-7" strokeWidth={1.5} />
          </div>
          <p className="font-medium text-foreground">Pedido não encontrado</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <span className="font-mono text-xs text-muted-foreground">#{order.id.slice(0, 8)}</span>
              <Badge variant={statusVariant[order.status]}>{ORDER_STATUS_LABELS[order.status]}</Badge>
            </div>
            <p className="mt-2 text-lg font-bold text-foreground">{custName.get(order.customer_id) ?? 'Cliente'}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {new Date(order.created_at).toLocaleDateString('pt-BR', {
                day: '2-digit',
                month: 'long',
                year: 'numeric',
              })}
            </p>

            <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
              <span className="flex items-center gap-2">
                {order.invoiced ? (
                  <Badge variant="green">Faturado</Badge>
                ) : (
                  <Badge variant="gray">Não faturado</Badge>
                )}
                {order.invoiced && order.invoiced_at && (
                  <span className="text-xs text-muted-foreground">
                    em {new Date(order.invoiced_at).toLocaleDateString('pt-BR')}
                  </span>
                )}
              </span>
              {canInvoice && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={invoicing}
                  onClick={() => void toggleInvoiced()}
                >
                  {order.invoiced ? 'Desmarcar' : 'Marcar faturado'}
                </Button>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card shadow-sm">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold text-foreground">Itens</h2>
              <span className="text-xs text-muted-foreground">{order.items.length}</span>
            </div>

            {order.items.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                {!isOnline && <WifiOff className="h-5 w-5 text-muted-foreground" />}
                <p className="text-sm text-muted-foreground">
                  {isOnline ? 'Sem itens neste pedido.' : 'Itens disponíveis quando reconectar.'}
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {order.items.map((item) => {
                  const p = prodMap.get(item.product_id);
                  return (
                    <li key={item.id} className="flex items-start justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          {p?.name ?? 'Produto'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {p?.sku ? `${p.sku} · ` : ''}
                          {item.variant_id && variantSize.get(item.variant_id)
                            ? `Tam ${variantSize.get(item.variant_id)} · `
                            : ''}
                          {item.quantity} × {formatBRL(item.unit_price)}
                        </p>
                      </div>
                      <p className="shrink-0 text-sm font-semibold text-foreground">{formatBRL(item.total)}</p>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="flex items-center justify-between border-t border-border px-4 py-3">
              <span className="text-sm text-muted-foreground">Total</span>
              <span className="text-xl font-bold text-foreground">{formatBRL(order.total ?? 0)}</span>
            </div>
          </div>

          {order.notes && (
            <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <h2 className="mb-1 text-sm font-semibold text-foreground">Observações</h2>
              <p className="text-sm text-muted-foreground">{order.notes}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
