import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, Package, WifiOff, MessageCircle, Trash2, Check, X } from 'lucide-react';
import { db } from '../../offline/db.js';
import { useAuthStore } from '../../store/authStore.js';
import { useOnlineStatus } from '../../hooks/useOnlineStatus.js';
import { useDecidirPedido } from '../../hooks/useDecidirPedido.js';
import { api } from '../../services/api.js';
import { Badge } from '../../components/interface/Badge.js';
import { Button } from '../../components/interface/Button.js';
import { Skeleton } from '../../components/interface/Skeleton.js';
import { Toast } from '../../components/interface/Toast.js';
import { formatBRL } from '../../lib/utils.js';
import { nomeDoComprador, origemParaExibir, decisaoDoPedido, seloDoPedido } from '../../lib/pedido.js';
import { usePermissao } from '../../hooks/usePermissao.js';
import type { OrderWithItems, ApiResponse, OrderStatus, ProductWithPrice } from '@csb/shared';

export function PaginaDetalhePedido() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { token, user } = useAuthStore();
  const isOnline = useOnlineStatus();
  // As teclas do gerente: sem elas o botão some, em vez de aparecer e responder
  // "acesso negado" no toque. Quem protege de verdade é a API.
  const podeFaturar = usePermissao('faturar_pedidos');
  const podeAprovar = usePermissao('aprovar_pedidos');
  const canInvoice = (user?.role === 'manager' || user?.role === 'admin') && podeFaturar;
  // A loja acompanha o próprio pedido: não fatura e não apaga (a rota nega os
  // dois), então os botões não aparecem em vez de responder 403 no toque.
  const ehLoja = user?.role === 'store';
  // undefined = carregando, null = não encontrado
  const [order, setOrder] = useState<OrderWithItems | null | undefined>(undefined);
  const [invoicing, setInvoicing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const { decidir, decidindo } = useDecidirPedido((mensagem, erro) =>
    setToast({ message: mensagem, type: erro ? 'error' : 'success' }),
  );

  // Quem abre um pedido parado quer decidir ali mesmo — obrigar a voltar para
  // uma lista para apertar o botão é o tipo de caminho que ninguém descobre.
  const decisao = order ? decisaoDoPedido(user?.role, order.status, podeAprovar) : null;

  const handleDecisao = async (status: OrderStatus) => {
    if (!id || !order) return;
    if (await decidir(id, status)) setOrder({ ...order, status });
  };

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
  const custWhats = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of customers ?? []) if (c.whatsapp) m.set(c.id, c.whatsapp);
    return m;
  }, [customers]);

  // Pedido de vitrine não tem cadastro: o contato é o que o visitante digitou
  // no fechamento. É por ele que o representante vai retornar.
  const zapDoComprador = order?.customer_id
    ? (custWhats.get(order.customer_id) ?? null)
    : (order?.guest_whatsapp ?? null);

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

  const handleDelete = async () => {
    if (!id || !token || !order) return;
    if (!window.confirm('Excluir este pedido? Esta ação não pode ser desfeita.')) return;
    setDeleting(true);
    try {
      await api.del<ApiResponse<{ ok: boolean }>>(`/orders/${id}`, token);
      await db.orders.delete(id);
      navigate('/orders');
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Erro ao excluir pedido');
      setDeleting(false);
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
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="font-mono text-xs text-muted-foreground">#{order.order_number ?? order.id.slice(0, 8)}</span>
                {origemParaExibir(order) && (
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {origemParaExibir(order)}
                  </span>
                )}
              </span>
              <Badge variant={seloDoPedido(order, user?.role).variante}>
                {seloDoPedido(order, user?.role).texto}
              </Badge>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="min-w-0 truncate text-lg font-bold text-foreground">
                {ehLoja ? (user?.name ?? 'Meu pedido') : nomeDoComprador(order, custName)}
              </p>
              {zapDoComprador && (
                <a
                  href={`https://wa.me/${zapDoComprador.replace(/\D/g, '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Falar no WhatsApp"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-positive-soft-foreground transition-colors hover:bg-positive-soft"
                >
                  <MessageCircle className="h-[18px] w-[18px]" />
                </a>
              )}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {new Date(order.created_at).toLocaleDateString('pt-BR', {
                day: '2-digit',
                month: 'long',
                year: 'numeric',
              })}
            </p>

            <div className={`mt-3 items-center justify-between gap-2 border-t border-border pt-3 ${ehLoja ? 'hidden' : 'flex'}`}>
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

          {decisao && (
            <div className="rounded-xl border border-primary/30 bg-primary-soft p-4">
              <p className="mb-3 text-sm text-foreground">{decisao.explicacao}</p>
              <div className="flex gap-2">
                <Button
                  size="lg"
                  className="flex-1 bg-positive hover:bg-positive/90 active:bg-positive/80"
                  disabled={decidindo !== null}
                  onClick={() => void handleDecisao(decisao.aceitar)}
                >
                  <Check className="h-4 w-4" strokeWidth={2.5} />
                  {decisao.rotuloAceitar}
                </Button>
                <Button
                  size="lg"
                  variant="destructive"
                  disabled={decidindo !== null}
                  onClick={() => void handleDecisao('rejected')}
                >
                  <X className="h-4 w-4" strokeWidth={2.5} />
                  {decisao.rotuloRecusar}
                </Button>
              </div>
            </div>
          )}

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

          {!order.invoiced && !ehLoja && podeAprovar && (
            <Button
              variant="outline"
              size="lg"
              className="w-full text-danger-soft-foreground hover:bg-danger-soft"
              disabled={deleting}
              onClick={() => void handleDelete()}
            >
              <Trash2 className="h-4 w-4" />
              {deleting ? 'Excluindo…' : 'Excluir pedido'}
            </Button>
          )}
        </div>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onDone={() => setToast(null)} />}
    </div>
  );
}
