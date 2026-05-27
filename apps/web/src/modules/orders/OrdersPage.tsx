import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db } from '../../offline/db.js';
import { useAuthStore } from '../../store/authStore.js';
import { api } from '../../services/api.js';
import { Badge } from '../../components/ui/Badge.js';
import { ORDER_STATUS_LABELS } from '@csb/shared';
import type { Order, ApiResponse } from '@csb/shared';
import type { OrderStatus } from '@csb/shared';

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
      .then(async (res) => {
        await db.orders.bulkPut(res.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-gray-800">Meus Pedidos</h2>
        <Link
          to="/orders/new"
          className="bg-brand-600 text-white text-sm font-medium px-4 py-2 rounded-lg min-h-[44px] flex items-center"
        >
          + Novo
        </Link>
      </div>

      {loading && <p className="text-sm text-gray-400 text-center py-2">Carregando pedidos...</p>}

      {orders?.length === 0 && !loading && (
        <p className="text-center text-gray-400 py-12">Nenhum pedido ainda.</p>
      )}

      <ul className="space-y-2">
        {orders?.map((order) => (
          <li key={order.id} className="bg-white rounded-xl shadow-sm p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-400 font-mono truncate">#{order.id.slice(0, 8)}</p>
                <p className="text-sm font-medium text-gray-900 mt-0.5">
                  {order.total != null ? `R$ ${order.total.toFixed(2)}` : '—'}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {new Date(order.created_at).toLocaleDateString('pt-BR')}
                </p>
              </div>
              <Badge variant={statusVariant[order.status]}>
                {ORDER_STATUS_LABELS[order.status]}
              </Badge>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
