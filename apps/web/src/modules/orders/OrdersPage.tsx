import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { Plus, ClipboardList } from 'lucide-react';
import { db } from '../../offline/db.js';
import { useAuthStore } from '../../store/authStore.js';
import { api } from '../../services/api.js';
import { Badge } from '../../components/ui/Badge.js';
import { Skeleton } from '../../components/ui/Skeleton.js';
import { buttonVariants } from '../../components/ui/Button.js';
import { cn, formatBRL } from '../../lib/utils.js';
import { ORDER_STATUS_LABELS } from '@csb/shared';
import type { Order, ApiResponse, OrderStatus } from '@csb/shared';

const statusVariant: Record<OrderStatus, 'gray' | 'yellow' | 'green' | 'red' | 'blue'> = {
  draft: 'gray',
  pending_approval: 'yellow',
  approved: 'green',
  rejected: 'red',
  sent_erp: 'blue',
  error_erp: 'red',
};

export function OrdersPage() {
  const { token } = useAuthStore();
  const [loading, setLoading] = useState(false);

  const orders = useLiveQuery(() => db.orders.orderBy('created_at').reverse().toArray(), []);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    api
      .get<ApiResponse<Order[]>>('/orders', token)
      .then((res) => db.orders.bulkPut(res.data))
      .catch(() => {
        /* offline: usamos o cache */
      })
      .finally(() => setLoading(false));
  }, [token]);

  const isInitialLoading = orders === undefined || (loading && (orders?.length ?? 0) === 0);

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground md:text-2xl">Pedidos</h1>
          {orders && orders.length > 0 && (
            <p className="text-sm text-muted-foreground">{orders.length} no total</p>
          )}
        </div>
        <Link to="/orders/new" className={cn(buttonVariants({ size: 'md' }))}>
          <Plus className="h-4 w-4" strokeWidth={2.5} />
          Novo pedido
        </Link>
      </div>

      {isInitialLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : orders && orders.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <ClipboardList className="h-7 w-7" strokeWidth={1.5} />
          </div>
          <div className="space-y-0.5">
            <p className="font-medium text-foreground">Nenhum pedido ainda</p>
            <p className="text-sm text-muted-foreground">Toque em “Novo pedido” para começar.</p>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {orders?.map((order) => (
            <div
              key={order.id}
              className="rounded-xl border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-mono text-xs text-muted-foreground">#{order.id.slice(0, 8)}</span>
                <Badge variant={statusVariant[order.status]}>{ORDER_STATUS_LABELS[order.status]}</Badge>
              </div>
              <p className="mt-2 text-lg font-bold text-foreground">{formatBRL(order.total)}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {new Date(order.created_at).toLocaleDateString('pt-BR', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                })}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
