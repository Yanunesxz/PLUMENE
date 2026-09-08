import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Clock, Wallet, Inbox, TrendingUp, ShoppingCart, Crown, Hourglass } from 'lucide-react';
import { db } from '../../offline/db.js';
import { useAuthStore } from '../../store/authStore.js';
import { useDecidirPedido } from '../../hooks/useDecidirPedido.js';
import { api } from '../../services/api.js';
import { Toast } from '../../components/interface/Toast.js';
import { CartaoDecisao } from '../../components/comercial/CartaoDecisao.js';
import { CartaoInstalar } from '../../components/interface/CartaoInstalar.js';
import { EnviarAviso } from './EnviarAviso.js';
import { decisaoDoPedido } from '../../lib/pedido.js';
import { usePermissao } from '../../hooks/usePermissao.js';
import { formatBRL } from '../../lib/utils.js';
import type { Order, CustomerListItem, ApiResponse } from '@csb/shared';
import { valorDaVenda } from '@csb/shared';

export function PaginaPainel() {
  const { token, user } = useAuthStore();
  // Gerente sem a tecla vê o pedido na fila, mas não os botões de decidir.
  const podeAprovar = usePermissao('aprovar_pedidos');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const allOrders = useLiveQuery(() => db.orders.toArray(), []);
  const customers = useLiveQuery(() => db.customers.toArray(), []);

  useEffect(() => {
    if (!token) return;
    api
      .get<ApiResponse<Order[]>>('/orders', token)
      .then((res) => db.orders.bulkPut(res.data))
      .catch(() => {});
    api
      .getLista<ApiResponse<CustomerListItem[]>>('/customers', token)
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
    // Venda é o que a fábrica FATUROU, não o que o gerente aprovou. Aprovar só
    // libera o pedido para o ERP; quem fecha o valor é o financeiro, que corta
    // item em falta e corrige preço antes da nota. Somar por `approved` inflava
    // o número com pedido que ainda ia encolher.
    const faturados = orders.filter((o) => o.invoiced);
    const pending = orders.filter((o) => o.status === 'pending_approval');
    // Pedido que a loja montou e que ainda espera o representante triar. Não é
    // fila do gerente, mas fica visível: sem isso, um representante ausente
    // seguraria pedidos sem ninguém na fábrica perceber.
    const comOsReps = orders.filter((o) => o.status === 'pending_rep');

    // Pedido de vitrine não entra no ranking: não há cliente por trás dele.
    const topMap = new Map<string, number>();
    for (const o of faturados) {
      if (!o.customer_id) continue;
      topMap.set(o.customer_id, (topMap.get(o.customer_id) ?? 0) + valorDaVenda(o));
    }
    const topClientes = [...topMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

    return {
      // Pelo `invoiced_at`, não pelo `created_at`: o que conta no mês é quando a
      // nota saiu. Pedido de julho faturado em agosto é venda de agosto.
      vendasMes: faturados
        .filter((o) => isThisMonth(o.invoiced_at ?? o.created_at))
        .reduce((s, o) => s + valorDaVenda(o), 0),
      pedidosMes: orders.filter((o) => isThisMonth(o.created_at)).length,
      pendingCount: pending.length,
      pendingTotal: pending.reduce((s, o) => s + (o.total ?? 0), 0),
      ticket: faturados.length
        ? faturados.reduce((s, o) => s + valorDaVenda(o), 0) / faturados.length
        : 0,
      pending,
      comOsReps,
      topClientes,
    };
  }, [allOrders]);

  const { decidir, decidindo } = useDecidirPedido((mensagem, erro) =>
    setToast({ message: mensagem, type: erro ? 'error' : 'success' }),
  );

  return (
    <div className="space-y-6 p-4 md:p-6">
      <h1 className="titulo text-[26px] leading-none text-foreground md:text-[32px]">Painel</h1>

      <CartaoInstalar />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard icon={TrendingUp} tint="green" value={formatBRL(metrics.vendasMes)} label="Vendas do mês" />
        <MetricCard icon={ShoppingCart} tint="brand" value={String(metrics.pedidosMes)} label="Pedidos no mês" />
        <MetricCard icon={Clock} tint="yellow" value={String(metrics.pendingCount)} label="Na mesa do financeiro" />
        <MetricCard icon={Wallet} tint="brand" value={formatBRL(metrics.ticket)} label="Ticket médio" />
      </div>

      <EnviarAviso />

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
            <p className="text-sm text-muted-foreground">Nenhum pedido esperando o financeiro.</p>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {metrics.pending.map((order) => {
              const decisao = decisaoDoPedido(user?.role, order.status, podeAprovar);
              // Sem decisão a tomar (o gerente, desde 02/09/2026): o pedido
              // continua à vista, só sem os botões — quem aprova é o financeiro.
              if (!decisao) {
                return (
                  <li key={order.id}>
                    <Link
                      to={`/orders/${order.id}`}
                      className="block rounded-xl border border-border bg-card p-4 shadow-sm transition-shadow hover:border-primary/30 hover:shadow-md"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-mono text-xs text-muted-foreground">
                          #{order.order_number ?? order.id.slice(0, 8)}
                        </span>
                        <span className="rounded bg-warn-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warn-soft-foreground">
                          Com o financeiro
                        </span>
                      </div>
                      <p className="mt-2 truncate text-sm font-medium text-foreground">
                        {custName.get(order.customer_id ?? '') ?? order.guest_name ?? 'Cliente'}
                      </p>
                      <p className="mt-0.5 text-lg font-bold text-foreground">{formatBRL(order.total)}</p>
                    </Link>
                  </li>
                );
              }
              return (
                <CartaoDecisao
                  key={order.id}
                  order={order}
                  decisao={decisao}
                  nomePorCliente={custName}
                  ocupado={decidindo === order.id}
                  onDecidir={(status) => void decidir(order.id, status)}
                />
              );
            })}
          </ul>
        )}
      </section>

      {metrics.comOsReps.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Ainda com os representantes
          </h2>
          <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary-soft-foreground">
              <Hourglass className="h-5 w-5" strokeWidth={2} />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                {metrics.comOsReps.length} pedido{metrics.comOsReps.length > 1 ? 's' : ''} de loja ·{' '}
                {formatBRL(metrics.comOsReps.reduce((s, o) => s + (o.total ?? 0), 0))}
              </p>
              <p className="text-xs text-muted-foreground">
                Montados pelas lojas. Chegam aqui depois que o representante mandar para a fábrica.
              </p>
            </div>
          </div>
        </section>
      )}

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
