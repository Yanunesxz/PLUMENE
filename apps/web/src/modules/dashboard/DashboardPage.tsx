import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../offline/db.js';
import { useAuthStore } from '../../store/authStore.js';
import { api } from '../../services/api.js';
import { Badge } from '../../components/ui/Badge.js';
import { Toast } from '../../components/ui/Toast.js';
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
      .then(async (res) => {
        await db.orders.bulkPut(res.data);
      })
      .catch(() => {});
  }, [token]);

  const handleDecision = async (orderId: string, decision: 'approved' | 'rejected') => {
    if (!token) return;
    setProcessing(orderId);
    try {
      await api.patch<ApiResponse<Order>>(
        `/orders/${orderId}/status`,
        { status: decision },
        token,
      );
      await db.orders.update(orderId, { status: decision });
      setToast({
        message: decision === 'approved' ? 'Pedido aprovado!' : 'Pedido recusado.',
        type: decision === 'approved' ? 'success' : 'error',
      });
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : 'Erro ao processar pedido',
        type: 'error',
      });
    } finally {
      setProcessing(null);
    }
  };

  return (
    <div className="p-4">
      <h2 className="font-semibold text-gray-800 mb-4">
        Pedidos Pendentes{' '}
        {pendingOrders && pendingOrders.length > 0 && (
          <span className="ml-1 bg-yellow-500 text-white text-xs rounded-full px-2 py-0.5">
            {pendingOrders.length}
          </span>
        )}
      </h2>

      {pendingOrders?.length === 0 && (
        <p className="text-center text-gray-400 py-12">Nenhum pedido aguardando aprovação.</p>
      )}

      <ul className="space-y-3">
        {pendingOrders?.map((order) => (
          <li key={order.id} className="bg-white rounded-xl shadow-sm p-4">
            <div className="flex items-start justify-between gap-2 mb-3">
              <div>
                <p className="text-xs text-gray-400 font-mono">#{order.id.slice(0, 8)}</p>
                <p className="text-sm font-medium text-gray-900 mt-0.5">
                  {order.total != null ? `R$ ${order.total.toFixed(2)}` : '—'}
                </p>
                <p className="text-xs text-gray-400">
                  {new Date(order.created_at).toLocaleDateString('pt-BR')}
                </p>
              </div>
              <Badge variant="yellow">{ORDER_STATUS_LABELS[order.status]}</Badge>
            </div>

            {order.notes && (
              <p className="text-xs text-gray-500 mb-3 bg-gray-50 rounded p-2">{order.notes}</p>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => { void handleDecision(order.id, 'approved'); }}
                disabled={processing === order.id}
                className="flex-1 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg py-2.5 min-h-[44px] transition-colors disabled:opacity-50"
              >
                Aprovar
              </button>
              <button
                onClick={() => { void handleDecision(order.id, 'rejected'); }}
                disabled={processing === order.id}
                className="flex-1 bg-red-500 hover:bg-red-600 text-white text-sm font-medium rounded-lg py-2.5 min-h-[44px] transition-colors disabled:opacity-50"
              >
                Recusar
              </button>
            </div>
          </li>
        ))}
      </ul>

      {toast && (
        <Toast message={toast.message} type={toast.type} onDone={() => setToast(null)} />
      )}
    </div>
  );
}
