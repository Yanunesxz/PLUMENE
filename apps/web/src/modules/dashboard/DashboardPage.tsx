import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Clock, Wallet, Check, X, Inbox } from 'lucide-react';
import { db } from '../../offline/db.js';
import { useAuthStore } from '../../store/authStore.js';
import { api } from '../../services/api.js';
import { Badge } from '../../components/ui/Badge.js';
import { Button } from '../../components/ui/Button.js';
import { Toast } from '../../components/ui/Toast.js';
import { formatBRL } from '../../lib/utils.js';
import { ORDER_STATUS_LABELS } from '@csb/shared';
import type { Order, ApiResponse } from '@csb/shared';

export function DashboardPage() {
  const { token } = useAuthStore();
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [processing, setProcessing] = useState<string | null>(null);

  const pendingOrders = useLiveQuery(
    () => db.orders.where('status').equals('pending_approval').toArray(),
    [],
  );

  useEffect(() => {
    if (!token) return;
    api
      .get<ApiResponse<Order[]>>('/orders', token)
      .then((res) => db.orders.bulkPut(res.data))
      .catch(() => {
        /* offline: usamos o cache */
      });
  }, [token]);

  const pendingCount = pendingOrders?.length ?? 0;
  const pendingTotal = pendingOrders?.reduce((sum, o) => sum + (o.total ?? 0), 0) ?? 0;

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
    <div className="space-y-5 p-4 md:p-6">
      <h1 className="text-xl font-bold tracking-tight text-foreground md:text-2xl">Painel</h1>

      <div className="grid grid-cols-2 gap-3 sm:max-w-md">
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-yellow-100 text-yellow-700">
            <Clock className="h-5 w-5" strokeWidth={2} />
          </div>
          <p className="text-2xl font-bold text-foreground">{pendingCount}</p>
          <p className="text-xs text-muted-foreground">Aguardando aprovação</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-brand-700">
            <Wallet className="h-5 w-5" strokeWidth={2} />
          </div>
          <p className="text-2xl font-bold text-foreground">{formatBRL(pendingTotal)}</p>
          <p className="text-xs text-muted-foreground">Valor pendente</p>
        </div>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Pedidos pendentes
        </h2>

        {pendingOrders && pendingOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Inbox className="h-7 w-7" strokeWidth={1.5} />
            </div>
            <p className="text-sm text-muted-foreground">Nenhum pedido aguardando aprovação.</p>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {pendingOrders?.map((order) => (
              <li key={order.id} className="rounded-xl border border-border bg-card p-4 shadow-sm">
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div>
                    <span className="font-mono text-xs text-muted-foreground">#{order.id.slice(0, 8)}</span>
                    <p className="mt-1 text-lg font-bold text-foreground">{formatBRL(order.total)}</p>
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
                    className="flex-1 bg-green-600 hover:bg-green-700 active:bg-green-800"
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
