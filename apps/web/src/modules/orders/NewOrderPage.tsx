import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../offline/db.js';
import { useAuthStore } from '../../store/authStore.js';
import { useOnlineStatus } from '../../hooks/useOnlineStatus.js';
import { api } from '../../services/api.js';
import { addToSyncQueue } from '../../offline/sync.js';
import { Toast } from '../../components/ui/Toast.js';
import type { CreateOrderRequest, ApiResponse, OrderWithItems } from '@csb/shared';

interface OrderItemDraft {
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
}

export function NewOrderPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { token, user } = useAuthStore();
  const isOnline = useOnlineStatus();

  const preselectedCustomerId = params.get('customer_id') ?? '';

  const [customerId, setCustomerId] = useState(preselectedCustomerId);
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<OrderItemDraft[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  const customers = useLiveQuery(() => db.customers.filter((c) => !c.blocked).toArray(), []);
  const products = useLiveQuery(() => db.products.where('active').equals(1).toArray(), []);

  const selectedCustomer = customers?.find((c) => c.id === customerId);

  useEffect(() => {
    if (preselectedCustomerId) setCustomerId(preselectedCustomerId);
  }, [preselectedCustomerId]);

  const addItem = (product_id: string) => {
    const product = products?.find((p) => p.id === product_id);
    if (!product) return;
    if (items.find((i) => i.product_id === product_id)) return;
    setItems((prev) => [
      ...prev,
      { product_id, product_name: product.name, quantity: 1, unit_price: 0 },
    ]);
  };

  const updateItem = (product_id: string, field: 'quantity' | 'unit_price', value: number) => {
    setItems((prev) =>
      prev.map((i) => (i.product_id === product_id ? { ...i, [field]: value } : i)),
    );
  };

  const removeItem = (product_id: string) => {
    setItems((prev) => prev.filter((i) => i.product_id !== product_id));
  };

  const total = items.reduce((sum, i) => sum + i.quantity * i.unit_price, 0);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!customerId || items.length === 0 || !user) return;
    setSubmitting(true);

    const local_id = `local_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const payload: CreateOrderRequest = {
      customer_id: customerId,
      notes: notes || undefined,
      local_id,
      items: items.map(({ product_id, quantity, unit_price }) => ({
        product_id,
        quantity,
        unit_price,
      })),
    };

    try {
      if (isOnline && token) {
        await api.post<ApiResponse<OrderWithItems>>('/orders', payload, token);
        setToast({ message: 'Pedido criado com sucesso!', type: 'success' });
      } else {
        await addToSyncQueue({
          local_id,
          customer_id: customerId,
          notes: notes || undefined,
          items: payload.items,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        setToast({ message: 'Pedido salvo offline. Será sincronizado ao reconectar.', type: 'info' });
      }
      setTimeout(() => void navigate('/orders'), 1500);
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : 'Erro ao criar pedido',
        type: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-4 max-w-lg mx-auto">
      {!isOnline && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2 text-xs text-yellow-700 mb-4">
          Você está offline. O pedido será salvo localmente.
        </div>
      )}

      <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-5">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Cliente</label>
          <select
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            required
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="">Selecione um cliente</option>
            {customers?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {selectedCustomer?.blocked && (
            <p className="text-xs text-red-500 mt-1">Este cliente está bloqueado.</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Adicionar produto</label>
          <select
            value=""
            onChange={(e) => {
              addItem(e.target.value);
              e.target.value = '';
            }}
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="">Selecione um produto</option>
            {products
              ?.filter((p) => !items.find((i) => i.product_id === p.id))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {p.sku}
                </option>
              ))}
          </select>
        </div>

        {items.length > 0 && (
          <ul className="space-y-2">
            {items.map((item) => (
              <li key={item.product_id} className="bg-white rounded-xl p-3 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-gray-800 truncate flex-1">{item.product_name}</p>
                  <button
                    type="button"
                    onClick={() => removeItem(item.product_id)}
                    className="text-red-400 text-xs ml-2 min-h-[44px] min-w-[44px] flex items-center justify-center"
                  >
                    ✕
                  </button>
                </div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="text-xs text-gray-500">Qtd</label>
                    <input
                      type="number"
                      min={1}
                      value={item.quantity}
                      onChange={(e) => updateItem(item.product_id, 'quantity', Number(e.target.value))}
                      className="w-full border border-gray-200 rounded px-2 py-1 text-sm mt-0.5"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-gray-500">Preço unit.</label>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={item.unit_price}
                      onChange={(e) => updateItem(item.product_id, 'unit_price', Number(e.target.value))}
                      className="w-full border border-gray-200 rounded px-2 py-1 text-sm mt-0.5"
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        {items.length > 0 && (
          <div className="text-right text-sm font-semibold text-gray-700">
            Total: R$ {total.toFixed(2)}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Observações</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
            placeholder="Opcional"
          />
        </div>

        <button
          type="submit"
          disabled={submitting || !customerId || items.length === 0}
          className="w-full bg-brand-600 hover:bg-brand-700 text-white font-semibold rounded-lg py-3 text-sm transition-colors disabled:opacity-50"
        >
          {submitting ? 'Enviando...' : isOnline ? 'Enviar para Aprovação' : 'Salvar Offline'}
        </button>
      </form>

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onDone={() => setToast(null)}
        />
      )}
    </div>
  );
}
