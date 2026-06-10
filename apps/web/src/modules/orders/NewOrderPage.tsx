import { useState, useEffect, useMemo, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Trash2, Minus, Plus, WifiOff, ShoppingCart } from 'lucide-react';
import { db } from '../../offline/db.js';
import { useAuthStore } from '../../store/authStore.js';
import { useOnlineStatus } from '../../hooks/useOnlineStatus.js';
import { api } from '../../services/api.js';
import { addToSyncQueue } from '../../offline/sync.js';
import { Button } from '../../components/ui/Button.js';
import { Select } from '../../components/ui/Select.js';
import { Textarea } from '../../components/ui/Textarea.js';
import { Toast } from '../../components/ui/Toast.js';
import { formatBRL } from '../../lib/utils.js';
import type { CreateOrderRequest, ApiResponse, OrderWithItems } from '@csb/shared';

interface OrderItemDraft {
  product_id: string;
  product_name: string;
  sku: string;
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
  // Booleano não é chave indexável no IndexedDB — lemos tudo e filtramos em memória.
  const allProducts = useLiveQuery(() => db.products.toArray(), []);
  const activeProducts = useMemo(() => (allProducts ?? []).filter((p) => p.active), [allProducts]);

  const selectedCustomer = customers?.find((c) => c.id === customerId);

  useEffect(() => {
    if (preselectedCustomerId) setCustomerId(preselectedCustomerId);
  }, [preselectedCustomerId]);

  const addItem = (product_id: string) => {
    const product = activeProducts.find((p) => p.id === product_id);
    if (!product) return;
    if (items.some((i) => i.product_id === product_id)) return;
    setItems((prev) => [
      ...prev,
      {
        product_id,
        product_name: product.name,
        sku: product.sku,
        quantity: 1,
        unit_price: product.price ?? 0,
      },
    ]);
  };

  const setQuantity = (product_id: string, quantity: number) => {
    setItems((prev) =>
      prev.map((i) => (i.product_id === product_id ? { ...i, quantity: Math.max(1, quantity || 1) } : i)),
    );
  };

  const setUnitPrice = (product_id: string, unit_price: number) => {
    setItems((prev) =>
      prev.map((i) => (i.product_id === product_id ? { ...i, unit_price: Math.max(0, unit_price) } : i)),
    );
  };

  const removeItem = (product_id: string) => {
    setItems((prev) => prev.filter((i) => i.product_id !== product_id));
  };

  const total = items.reduce((sum, i) => sum + i.quantity * i.unit_price, 0);
  const totalQty = items.reduce((sum, i) => sum + i.quantity, 0);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!customerId || items.length === 0 || !user) return;
    setSubmitting(true);

    const local_id = `local_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const payload: CreateOrderRequest = {
      customer_id: customerId,
      notes: notes || undefined,
      local_id,
      items: items.map(({ product_id, quantity, unit_price }) => ({ product_id, quantity, unit_price })),
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
      setToast({ message: err instanceof Error ? err.message : 'Erro ao criar pedido', type: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  const availableProducts = activeProducts.filter((p) => !items.some((i) => i.product_id === p.id));

  return (
    <div className="mx-auto max-w-2xl p-4 md:p-6">
      <h1 className="mb-4 text-xl font-bold tracking-tight text-foreground md:text-2xl">Novo pedido</h1>

      {!isOnline && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs font-medium text-yellow-800">
          <WifiOff className="h-4 w-4 shrink-0" strokeWidth={2.5} />
          Você está offline. O pedido será salvo localmente e sincronizado depois.
        </div>
      )}

      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
        <div className="space-y-1.5">
          <label htmlFor="customer" className="text-sm font-medium text-foreground">
            Cliente
          </label>
          <Select
            id="customer"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            required
          >
            <option value="">Selecione um cliente</option>
            {customers?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          {selectedCustomer?.blocked && <p className="text-xs text-red-500">Este cliente está bloqueado.</p>}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="add-product" className="text-sm font-medium text-foreground">
            Adicionar produto
          </label>
          <Select
            id="add-product"
            value=""
            onChange={(e) => {
              if (e.target.value) addItem(e.target.value);
            }}
            disabled={availableProducts.length === 0}
          >
            <option value="">
              {availableProducts.length === 0 ? 'Nenhum produto disponível' : 'Selecione um produto'}
            </option>
            {availableProducts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {p.sku}
              </option>
            ))}
          </Select>
        </div>

        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-10 text-center">
            <ShoppingCart className="h-8 w-8 text-muted-foreground" strokeWidth={1.5} />
            <p className="text-sm text-muted-foreground">Nenhum item adicionado ainda.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {items.map((item) => (
              <li key={item.product_id} className="rounded-xl border border-border bg-card p-3 shadow-sm">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{item.product_name}</p>
                    <p className="text-xs text-muted-foreground">{item.sku}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeItem(item.product_id)}
                    aria-label="Remover item"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">Qtd</label>
                    <div className="flex items-center">
                      <button
                        type="button"
                        onClick={() => setQuantity(item.product_id, item.quantity - 1)}
                        aria-label="Diminuir quantidade"
                        className="flex h-11 w-11 items-center justify-center rounded-l-lg border border-input text-foreground transition-colors hover:bg-muted"
                      >
                        <Minus className="h-3.5 w-3.5" strokeWidth={2.5} />
                      </button>
                      <input
                        type="number"
                        min={1}
                        value={item.quantity}
                        onChange={(e) => setQuantity(item.product_id, Number(e.target.value))}
                        className="h-11 w-12 border-y border-input bg-background text-center text-sm text-foreground focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                      />
                      <button
                        type="button"
                        onClick={() => setQuantity(item.product_id, item.quantity + 1)}
                        aria-label="Aumentar quantidade"
                        className="flex h-11 w-11 items-center justify-center rounded-r-lg border border-input text-foreground transition-colors hover:bg-muted"
                      >
                        <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
                      </button>
                    </div>
                  </div>

                  <div className="min-w-[6rem] flex-1">
                    <label className="mb-1 block text-xs text-muted-foreground">Preço unit.</label>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={item.unit_price}
                      onChange={(e) => setUnitPrice(item.product_id, Number(e.target.value))}
                      className="h-11 w-full rounded-lg border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>

                  <div className="text-right">
                    <p className="mb-1 text-xs text-muted-foreground">Subtotal</p>
                    <p className="text-sm font-semibold text-foreground">
                      {formatBRL(item.quantity * item.unit_price)}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="space-y-1.5">
          <label htmlFor="notes" className="text-sm font-medium text-foreground">
            Observações
          </label>
          <Textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Opcional"
          />
        </div>

        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              {totalQty} {totalQty === 1 ? 'item' : 'itens'}
            </span>
            <span className="text-xl font-bold text-foreground">{formatBRL(total)}</span>
          </div>
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={submitting || !customerId || items.length === 0}
          >
            {submitting ? 'Enviando…' : isOnline ? 'Enviar para aprovação' : 'Salvar offline'}
          </Button>
        </div>
      </form>

      {toast && <Toast message={toast.message} type={toast.type} onDone={() => setToast(null)} />}
    </div>
  );
}
