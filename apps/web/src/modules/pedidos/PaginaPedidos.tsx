import { useEffect, useState, useMemo, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { Plus, ClipboardList, Search } from 'lucide-react';
import { db } from '../../offline/db.js';
import { useAuthStore } from '../../store/authStore.js';
import { api } from '../../services/api.js';
import { Badge } from '../../components/ui/Badge.js';
import { Input } from '../../components/ui/Input.js';
import { Skeleton } from '../../components/ui/Skeleton.js';
import { buttonVariants } from '../../components/ui/Button.js';
import { cn, formatBRL } from '../../lib/utils.js';
import { ORDER_STATUS_LABELS } from '@csb/shared';
import type { Order, CustomerWithPriceTable, ApiResponse, OrderStatus } from '@csb/shared';

const statusVariant: Record<OrderStatus, 'gray' | 'yellow' | 'green' | 'red' | 'blue'> = {
  draft: 'gray',
  pending_approval: 'yellow',
  approved: 'green',
  rejected: 'red',
  sent_erp: 'blue',
  error_erp: 'red',
};

const STATUS_FILTERS: { value: OrderStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'pending_approval', label: 'Pendentes' },
  { value: 'approved', label: 'Aprovados' },
  { value: 'rejected', label: 'Recusados' },
  { value: 'draft', label: 'Rascunhos' },
];

export function PaginaPedidos() {
  const { token } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<OrderStatus | 'all'>('all');

  const orders = useLiveQuery(() => db.orders.orderBy('created_at').reverse().toArray(), []);
  const customers = useLiveQuery(() => db.customers.toArray(), []);

  const customerName = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of customers ?? []) m.set(c.id, c.name);
    return m;
  }, [customers]);

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
    // garante os nomes de cliente para a busca, mesmo sem passar pela aba Clientes
    api
      .get<ApiResponse<CustomerWithPriceTable[]>>('/customers', token)
      .then((res) => db.customers.bulkPut(res.data))
      .catch(() => {});
  }, [token]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (orders ?? [])
      .filter((o) => status === 'all' || o.status === status)
      .filter((o) => {
        if (!q) return true;
        const name = customerName.get(o.customer_id)?.toLowerCase() ?? '';
        return name.includes(q) || o.id.toLowerCase().includes(q);
      });
  }, [orders, status, search, customerName]);

  const isInitialLoading = orders === undefined || (loading && (orders?.length ?? 0) === 0);
  const hasOrders = (orders?.length ?? 0) > 0;

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground md:text-2xl">Pedidos</h1>
          {hasOrders && <p className="text-sm text-muted-foreground">{filtered.length} de {orders?.length}</p>}
        </div>
        <Link to="/orders/new" className={cn(buttonVariants({ size: 'md' }))}>
          <Plus className="h-4 w-4" strokeWidth={2.5} />
          Novo pedido
        </Link>
      </div>

      {hasOrders && (
        <>
          <div className="relative mb-3">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              strokeWidth={2}
            />
            <Input
              type="search"
              inputMode="search"
              placeholder="Buscar por cliente ou nº do pedido…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="no-scrollbar mb-4 flex gap-2 overflow-x-auto pb-1">
            {STATUS_FILTERS.map((f) => (
              <Chip key={f.value} active={status === f.value} onClick={() => setStatus(f.value)}>
                {f.label}
              </Chip>
            ))}
          </div>
        </>
      )}

      {isInitialLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : !hasOrders ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <ClipboardList className="h-7 w-7" strokeWidth={1.5} />
          </div>
          <div className="space-y-0.5">
            <p className="font-medium text-foreground">Nenhum pedido ainda</p>
            <p className="text-sm text-muted-foreground">Toque em “Novo pedido” para começar.</p>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Search className="h-7 w-7" strokeWidth={1.5} />
          </div>
          <p className="text-sm text-muted-foreground">Nenhum pedido para essa busca ou filtro.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((order) => (
            <Link
              key={order.id}
              to={`/orders/${order.id}`}
              className="block rounded-xl border border-border bg-card p-4 shadow-sm transition-shadow hover:border-brand-200 hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-mono text-xs text-muted-foreground">#{order.id.slice(0, 8)}</span>
                <Badge variant={statusVariant[order.status]}>{ORDER_STATUS_LABELS[order.status]}</Badge>
              </div>
              <p className="mt-2 truncate text-sm font-medium text-foreground">
                {customerName.get(order.customer_id) ?? 'Cliente'}
              </p>
              <p className="mt-0.5 text-lg font-bold text-foreground">{formatBRL(order.total)}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {new Date(order.created_at).toLocaleDateString('pt-BR', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                })}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'shrink-0 whitespace-nowrap rounded-full border px-3.5 text-xs font-medium transition-colors',
        active
          ? 'border-brand-600 bg-brand-600 text-white'
          : 'border-border bg-card text-muted-foreground hover:border-brand-300 hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}
