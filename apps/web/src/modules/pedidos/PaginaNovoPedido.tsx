import { useState, useEffect, useMemo, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Trash2, Minus, Plus, WifiOff, ShoppingCart, AlertCircle } from 'lucide-react';
import { db } from '../../offline/db.js';
import { useAuthStore } from '../../store/authStore.js';
import { useCartStore } from '../../store/cartStore.js';
import { useOnlineStatus } from '../../hooks/useOnlineStatus.js';
import { api } from '../../services/api.js';
import { addToSyncQueue } from '../../offline/sync.js';
import { Button } from '../../components/interface/Button.js';
import { SearchSelect } from '../../components/interface/SearchSelect.js';
import { SeletorTamanho } from '../../components/comercial/SeletorTamanho.js';
import { Textarea } from '../../components/interface/Textarea.js';
import { Toast } from '../../components/interface/Toast.js';
import { formatBRL } from '../../lib/utils.js';
import type { CreateOrderRequest, ApiResponse, OrderWithItems, ProductWithPrice } from '@csb/shared';

export function PaginaNovoPedido() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { token, user } = useAuthStore();
  const isOnline = useOnlineStatus();

  const preselectedCustomerId = params.get('customer_id') ?? '';

  const items = useCartStore((s) => s.items);
  const setQuantity = useCartStore((s) => s.setQuantity);
  const setUnitPrice = useCartStore((s) => s.setUnitPrice);
  const removeItem = useCartStore((s) => s.remove);
  const addToCart = useCartStore((s) => s.add);
  const clearCart = useCartStore((s) => s.clear);

  // A loja compra para ela mesma: não escolhe cliente, não tem carteira para
  // escolher (a rota `/customers` é negada para ela) e o servidor carimba o
  // cliente pelo token. Sem este caminho, a tela travava em "selecione o
  // cliente" com uma lista que nunca ia carregar.
  const ehLoja = user?.role === 'store';
  const [customerId, setCustomerId] = useState(preselectedCustomerId);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [picker, setPicker] = useState<{ product: ProductWithPrice; group: ProductWithPrice[] } | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  const customers = useLiveQuery(() => db.customers.filter((c) => !c.blocked).toArray(), []);
  // Booleano não é chave indexável no IndexedDB — lemos tudo e filtramos em memória.
  const allProducts = useLiveQuery(() => db.products.toArray(), []);
  const activeProducts = useMemo(() => (allProducts ?? []).filter((p) => p.active), [allProducts]);

  const selectedCustomer = customers?.find((c) => c.id === customerId);

  useEffect(() => {
    if (preselectedCustomerId) setCustomerId(preselectedCustomerId);
  }, [preselectedCustomerId]);

  // Abre o seletor de tamanho para o produto escolhido na busca.
  const addItem = (product_id: string) => {
    const product = activeProducts.find((p) => p.id === product_id);
    if (!product) return;
    // Abre com todas as cores do mesmo modelo (para escolher a cor no seletor).
    const group = product.variant_group
      ? activeProducts.filter((p) => p.variant_group === product.variant_group)
      : [product];
    setPicker({ product, group });
  };

  // Rep não edita preço (segue a tabela do representante); só gerente/admin ajusta.
  const canEditPrice = user?.role === 'manager' || user?.role === 'admin';

  const total = items.reduce((sum, i) => sum + i.quantity * i.unit_price, 0);
  const totalQty = items.reduce((sum, i) => sum + i.quantity, 0);

  // O que ainda falta para poder enviar o pedido (cliente é o mais esquecido:
  // a pessoa chega com produtos no carrinho vindo do catálogo e não seleciona cliente).
  const missingReason = !customerId && !ehLoja
    ? 'Selecione o cliente para enviar o pedido.'
    : items.length === 0
      ? 'Adicione ao menos um produto para enviar o pedido.'
      : selectedCustomer?.blocked
        ? 'Este cliente está bloqueado. Escolha outro para continuar.'
        : null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if ((!customerId && !ehLoja) || items.length === 0 || !user) return;
    setSubmitting(true);

    // Offline a loja não tem quem carimbe o cliente por ela: vai o customer_id
    // que veio no login.
    const clienteDoPedido = ehLoja ? (user.customer_id ?? '') : customerId;

    const local_id = `local_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const payload: CreateOrderRequest = {
      ...(ehLoja ? {} : { customer_id: customerId }),
      notes: notes || undefined,
      local_id,
      // O botão diz "Enviar para aprovação" — então o pedido tem que entrar na
      // fila do gerente. Sem isto ele nascia 'draft' e ninguém nunca o via.
      // (Para a loja o servidor ignora: pedido dela nunca é rascunho.)
      submit: true,
      items: items.map(({ product_id, variant_id, quantity, unit_price }) => ({
        product_id,
        variant_id: variant_id ?? undefined,
        quantity,
        unit_price,
      })),
    };

    try {
      if (isOnline && token) {
        await api.post<ApiResponse<OrderWithItems>>('/orders', payload, token);
        setToast({
          message: ehLoja ? 'Pedido enviado ao seu representante!' : 'Pedido criado com sucesso!',
          type: 'success',
        });
      } else {
        await addToSyncQueue({
          local_id,
          customer_id: clienteDoPedido,
          notes: notes || undefined,
          items: payload.items,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        setToast({ message: 'Pedido salvo offline. Será sincronizado ao reconectar.', type: 'info' });
      }
      clearCart();
      setTimeout(() => void navigate('/orders'), 1500);
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : 'Erro ao criar pedido', type: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  // Mesma visibilidade do catálogo: sem Plumene (2xxx) e sem produtos sem foto
  // (refs que foram tiradas do catálogo não devem aparecer na busca de pedido).
  const availableProducts = activeProducts.filter((p) => !/^2/.test(p.sku) && !!p.image_url);

  return (
    <div className="mx-auto max-w-2xl p-4 md:p-6">
      <h1 className="titulo text-[26px] leading-none text-foreground md:text-[32px]">Novo pedido</h1>
      <p className="mb-4 mt-1 text-sm text-muted-foreground">
        {ehLoja
          ? 'Monte o pedido e envie. Seu representante confere antes de ir para a fábrica.'
          : 'Escolha o cliente e as peças. O pedido vai para a aprovação da fábrica.'}
      </p>

      {!isOnline && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-xs font-medium text-warn-soft-foreground">
          <WifiOff className="h-4 w-4 shrink-0" strokeWidth={2.5} />
          Você está offline. O pedido será salvo localmente e sincronizado depois.
        </div>
      )}

      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
        {!ehLoja && (
          <div className="space-y-1.5">
            <label htmlFor="customer" className="text-sm font-medium text-foreground">
              Cliente <span className="text-danger">*</span>
            </label>
            <SearchSelect
              id="customer"
              value={customerId}
              onSelect={setCustomerId}
              placeholder="Selecione um cliente"
              searchPlaceholder="Buscar cliente por nome ou CNPJ…"
              emptyText="Nenhum cliente encontrado"
              options={(customers ?? []).map((c) => ({
                value: c.id,
                label: c.name,
                sublabel: c.cnpj ? `CNPJ ${c.cnpj}` : undefined,
              }))}
            />
            {selectedCustomer?.blocked ? (
              <p className="text-xs text-danger">Este cliente está bloqueado.</p>
            ) : !customerId ? (
              <p className="text-xs text-muted-foreground">
                Comece escolhendo o cliente — o pedido é sempre vinculado a um cliente.
              </p>
            ) : null}
          </div>
        )}

        <div className="space-y-1.5">
          <label htmlFor="add-product" className="text-sm font-medium text-foreground">
            Adicionar produto
          </label>
          <SearchSelect
            id="add-product"
            onSelect={addItem}
            resetOnSelect
            disabled={availableProducts.length === 0}
            placeholder={availableProducts.length === 0 ? 'Nenhum produto disponível' : 'Buscar produto para adicionar…'}
            searchPlaceholder="Buscar por nome ou código (SKU)…"
            emptyText="Nenhum produto encontrado"
            options={availableProducts.map((p) => ({
              value: p.id,
              label: p.name,
              sublabel: p.sku,
            }))}
          />
          <p className="text-xs text-muted-foreground">
            Dica: você também pode adicionar itens direto pelo Catálogo.
          </p>
        </div>

        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-10 text-center">
            <ShoppingCart className="h-8 w-8 text-muted-foreground" strokeWidth={1.5} />
            <p className="text-sm text-muted-foreground">Nenhum item adicionado ainda.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {items.map((item) => (
              <li key={`${item.product_id}|${item.size}`} className="rounded-xl border border-border bg-card p-3 shadow-sm">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{item.product_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.sku}
                      {item.size ? ` · Tam ${item.size}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeItem(item.product_id, item.size)}
                    aria-label="Remover item"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-danger-soft hover:text-danger"
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
                        onClick={() => setQuantity(item.product_id, item.size, item.quantity - 1)}
                        aria-label="Diminuir quantidade"
                        className="flex h-11 w-11 items-center justify-center rounded-l-lg border border-input text-foreground transition-colors hover:bg-muted"
                      >
                        <Minus className="h-3.5 w-3.5" strokeWidth={2.5} />
                      </button>
                      <input
                        type="number"
                        min={1}
                        value={item.quantity}
                        onChange={(e) => setQuantity(item.product_id, item.size, Number(e.target.value))}
                        className="h-11 w-12 border-y border-input bg-background text-center text-sm text-foreground focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                      />
                      <button
                        type="button"
                        onClick={() => setQuantity(item.product_id, item.size, item.quantity + 1)}
                        aria-label="Aumentar quantidade"
                        className="flex h-11 w-11 items-center justify-center rounded-r-lg border border-input text-foreground transition-colors hover:bg-muted"
                      >
                        <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
                      </button>
                    </div>
                  </div>

                  <div className="min-w-[6rem] flex-1">
                    <label className="mb-1 block text-xs text-muted-foreground">Preço unit.</label>
                    {canEditPrice ? (
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={item.unit_price}
                        onChange={(e) => setUnitPrice(item.product_id, item.size, Number(e.target.value))}
                        className="h-11 w-full rounded-lg border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    ) : (
                      <p className="flex h-11 items-center text-sm font-medium text-foreground">
                        {formatBRL(item.unit_price)}
                      </p>
                    )}
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
          {missingReason && (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-xs font-medium text-warn-soft-foreground">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.5} />
              <span>{missingReason}</span>
            </div>
          )}
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={submitting || missingReason !== null}
          >
            {submitting
              ? 'Enviando…'
              : !isOnline
                ? 'Salvar offline'
                : ehLoja
                  ? 'Enviar ao meu representante'
                  : 'Enviar para aprovação'}
          </Button>
        </div>
      </form>

      {picker && (
        <SeletorTamanho
          product={picker.product}
          colorGroup={picker.group.length > 1 ? picker.group : undefined}
          onClose={() => setPicker(null)}
          onConfirm={(chosen, lines) =>
            lines.forEach((l) =>
              addToCart({
                product_id: chosen.id,
                variant_id: l.variant_id,
                size: l.size,
                product_name: chosen.name,
                sku: chosen.sku,
                quantity: l.quantity,
                unit_price: chosen.price ?? 0,
              }),
            )
          }
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onDone={() => setToast(null)} />}
    </div>
  );
}
