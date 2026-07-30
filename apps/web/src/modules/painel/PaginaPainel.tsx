import { useEffect, useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Clock, Wallet, Check, X, Inbox, TrendingUp, ShoppingCart, Crown } from 'lucide-react';
import { db } from '../../offline/db.js';
import { useAuthStore } from '../../store/authStore.js';
import { api } from '../../services/api.js';
import { Badge } from '../../components/interface/Badge.js';
import { Button } from '../../components/interface/Button.js';
import { Toast } from '../../components/interface/Toast.js';
import { formatBRL } from '../../lib/utils.js';
import { ORDER_STATUS_LABELS } from '@csb/shared';
import type { Order, CustomerListItem, ApiResponse } from '@csb/shared';

export function PaginaPainel() {
  const { token } = useAuthStore();
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [processing, setProcessing] = useState<string | null>(null);

  const allOrders = useLiveQuery(() => db.orders.toArray(), []);
  const customers = useLiveQuery(() => db.customers.toArray(), []);

  useEffect(() => {
    if (!token) return;
    api
      .get<ApiResponse<Order[]>>('/orders', token)
      .then((res) => db.orders.bulkPut(res.data))
      .catch(() => {});
    api
      .get<ApiResponse<CustomerListItem[]>>('/customers', token)
      .then((res) => db.customers.bulkPut(res.data))
      .catch(() => {});
  }, [token]);

  const custName = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of customers ?? []) m.set(c.id, c.name);
    return m;
  }, [customers]);

  const metrics = useMemo(() => {
    const orders = allOrders ?? [];
    const now = new Date();
    const isThisMonth = (iso: string) => {
      const d = new Date(iso);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    };
    const approved = orders.filter((o) => o.status === 'approved');
    const pending = orders.filter((o) => o.status === 'pending_approval');

    const topMap = new Map<string, number>();
    for (const o of approved) topMap.set(o.customer_id, (topMap.get(o.customer_id) ?? 0) + (o.total ?? 0));
    const topClientes = [...topMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

    return {
      vendasMes: approved.filter((o) => isThisMonth(o.created_at)).reduce((s, o) => s + (o.total ?? 0), 0),
      pedidosMes: orders.filter((o) => isThisMonth(o.created_at)).length,
      pendingCount: pending.length,
      pendingTotal: pending.reduce((s, o) => s + (o.total ?? 0), 0),
      ticket: approved.length ? approved.reduce((s, o) => s + (o.total ?? 0), 0) / approved.length : 0,
      pending,
      topClientes,
    };
  }, [allOrders]);

  const handleDecision = async (orderId: string, decision: 'approved' | 'rejected') => {
    if (!token) return;
    setProcessing(orderId);
    try {
      await api.patch<ApiResponse<Order>>(`/orders/${orderId}/status`, { status: decision }, token);
      await db.orders.update(orderId, { status: decision });
      setToast({
        message: decision === 'approved' ? 'Pedido aprovado!' : 'Pedido recusado.',
        type: decision === 'approved' ? 'success' : 'error',
      });
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : 'Erro ao processar pedido', type: 'error' });
    } finally {
      setProcessing(null);
    }
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      <h1 className="text-xl font-bold tracking-tight text-foreground md:text-2xl">Painel</h1>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard icon={TrendingUp} tint="green" value={formatBRL(metrics.vendasMes)} label="Vendas do mês" />
        <MetricCard icon={ShoppingCart} tint="brand" value={String(metrics.pedidosMes)} label="Pedidos no mês" />
        <MetricCard icon={Clock} tint="yellow" value={String(metrics.pendingCount)} label="Aguardando aprovação" />
        <MetricCard icon={Wallet} tint="brand" value={formatBRL(metrics.ticket)} label="Ticket médio" />
      </div>

      {metrics.topClientes.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Top clientes
          </h2>
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <ul className="divide-y divide-border">
              {metrics.topClientes.map(([customerId, total], i) => (
                <li key={customerId} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                        i === 0 ? 'bg-primary text-white' : 'bg-primary-soft text-primary-soft-foreground'
                      }`}
                    >
                      {i === 0 ? <Crown className="h-3.5 w-3.5" /> : i + 1}
                    </span>
                    <span className="truncate text-sm font-medium text-foreground">
                      {custName.get(customerId) ?? 'Cliente'}
                    </span>
                  </div>
                  <span className="shrink-0 text-sm font-semibold text-foreground">{formatBRL(total)}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Pedidos pendentes {metrics.pendingCount > 0 && `· ${formatBRL(metrics.pendingTotal)}`}
        </h2>

        {metrics.pending.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Inbox className="h-7 w-7" strokeWidth={1.5} />
            </div>
            <p className="text-sm text-muted-foreground">Nenhum pedido aguardando aprovação.</p>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {metrics.pending.map((order) => (
              <li key={order.id} className="rounded-xl border border-border bg-card p-4 shadow-sm">
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {custName.get(order.customer_id) ?? 'Cliente'}
                    </p>
                    <p className="mt-0.5 text-lg font-bold text-foreground">{formatBRL(order.total ?? 0)}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(order.created_at).toLocaleDateString('pt-BR')}
                    </p>
                  </div>
                  <Badge variant="yellow">{ORDER_STATUS_LABELS[order.status]}</Badge>
                </div>

                {order.notes && (
                  <p className="mb-3 rounded-lg bg-muted p-2 text-xs text-muted-foreground">{order.notes}</p>
                )}

                <div className="flex gap-2">
                  <Button
                    className="flex-1 bg-positive hover:bg-positive/90 active:bg-positive/80"
                    disabled={processing === order.id}
                    onClick={() => void handleDecision(order.id, 'approved')}
                  >
                    <Check className="h-4 w-4" strokeWidth={2.5} />
                    Aprovar
                  </Button>
                  <Button
                    variant="destructive"
                    className="flex-1"
                    disabled={processing === order.id}
                    onClick={() => void handleDecision(order.id, 'rejected')}
                  >
                    <X className="h-4 w-4" strokeWidth={2.5} />
                    Recusar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {toast && <Toast message={toast.message} type={toast.type} onDone={() => setToast(null)} />}
    </div>
  );
}

function MetricCard({
  icon: Icon,
  tint,
  value,
  label,
}: {
  icon: typeof Clock;
  tint: 'green' | 'yellow' | 'brand';
  value: string;
  label: string;
}) {
  const tints: Record<string, string> = {
    green: 'bg-positive-soft text-positive-soft-foreground',
    yellow: 'bg-warn-soft text-warn-soft-foreground',
    brand: 'bg-primary-soft text-primary-soft-foreground',
  };
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className={`mb-2 flex h-9 w-9 items-center justify-center rounded-full ${tints[tint]}`}>
        <Icon className="h-5 w-5" strokeWidth={2} />
      </div>
      <p className="truncate text-xl font-bold text-foreground">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
