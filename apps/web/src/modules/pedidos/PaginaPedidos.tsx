import { useEffect, useState, useMemo, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { Plus, ClipboardList, Search, FileSpreadsheet, X } from 'lucide-react';
import { db } from '../../offline/db.js';
import { useAuthStore } from '../../store/authStore.js';
import { api } from '../../services/api.js';
import { Badge } from '../../components/interface/Badge.js';
import { Input } from '../../components/interface/Input.js';
import { Select } from '../../components/interface/Select.js';
import { Skeleton } from '../../components/interface/Skeleton.js';
import { Button, buttonVariants } from '../../components/interface/Button.js';
import { cn, formatBRL } from '../../lib/utils.js';
import { exportOrdersToXlsx } from '../../lib/exportOrders.js';
import { ORDER_STATUS_LABELS } from '@csb/shared';
import type {
  Order,
  CustomerWithPriceTable,
  ApiResponse,
  OrderStatus,
  OrderWithItems,
  RepListItem,
  ProductWithPrice,
} from '@csb/shared';

const ALL_REPS = '__all__';

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
  const { token, hasRole } = useAuthStore();
  const isManager = hasRole('manager', 'admin');
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<OrderStatus | 'all'>('all');
  const [repId, setRepId] = useState<string>(ALL_REPS);
  const [reps, setReps] = useState<RepListItem[] | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);

  const orders = useLiveQuery(() => db.orders.orderBy('created_at').reverse().toArray(), []);
  const customers = useLiveQuery(() => db.customers.toArray(), []);
  const products = useLiveQuery(() => db.products.toArray(), []);

  const customerName = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of customers ?? []) m.set(c.id, c.name);
    return m;
  }, [customers]);

  const productSku = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of products ?? []) m.set(p.id, p.sku);
    return m;
  }, [products]);

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
    // garante o SKU dos produtos para a exportação, mesmo sem passar pelo Catálogo
    api
      .get<ApiResponse<ProductWithPrice[]>>('/products', token)
      .then((res) => db.products.bulkPut(res.data))
      .catch(() => {});
  }, [token]);

  // Lista de representantes para o filtro do gerente (rep comum só vê os seus).
  useEffect(() => {
    if (!token || !isManager) return;
    api
      .get<ApiResponse<RepListItem[]>>('/reps', token)
      .then((res) => setReps(res.data))
      .catch(() => setReps([]));
  }, [token, isManager]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (orders ?? [])
      .filter((o) => status === 'all' || o.status === status)
      .filter((o) => repId === ALL_REPS || o.rep_id === repId)
      .filter((o) => {
        if (!q) return true;
        const name = customerName.get(o.customer_id)?.toLowerCase() ?? '';
        return name.includes(q) || o.id.toLowerCase().includes(q);
      });
  }, [orders, status, repId, search, customerName]);

  const isInitialLoading = orders === undefined || (loading && (orders?.length ?? 0) === 0);
  const hasOrders = (orders?.length ?? 0) > 0;

  function toggleSelectMode() {
    setSelectMode((v) => !v);
    setSelected(new Set());
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleExport() {
    if (!token || selected.size === 0) return;
    setExporting(true);
    try {
      const detailed = await Promise.all(
        Array.from(selected).map((id) =>
          api.get<ApiResponse<OrderWithItems>>(`/orders/${id}`, token).then((res) => res.data),
        ),
      );
      exportOrdersToXlsx(detailed, customerName, productSku);
      setSelectMode(false);
      setSelected(new Set());
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground md:text-2xl">Pedidos</h1>
          {hasOrders && <p className="text-sm text-muted-foreground">{filtered.length} de {orders?.length}</p>}
        </div>
        <div className="flex items-center gap-2">
          {selectMode ? (
            <Button variant="outline" size="md" onClick={toggleSelectMode}>
              <X className="h-4 w-4" strokeWidth={2.5} />
              Cancelar
            </Button>
          ) : (
            hasOrders && (
              <Button variant="outline" size="md" onClick={toggleSelectMode}>
                <FileSpreadsheet className="h-4 w-4" strokeWidth={2.5} />
                Exportar
              </Button>
            )
          )}
          <Link to="/orders/new" className={cn(buttonVariants({ size: 'md' }))}>
            <Plus className="h-4 w-4" strokeWidth={2.5} />
            Novo pedido
          </Link>
        </div>
      </div>

      {selectMode && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-brand-200 bg-brand-50 p-3">
          <p className="text-sm font-medium text-foreground">{selected.size} selecionado(s)</p>
          <Button size="sm" onClick={handleExport} disabled={selected.size === 0 || exporting}>
            <FileSpreadsheet className="h-4 w-4" strokeWidth={2.5} />
            {exporting ? 'Gerando…' : 'Gerar planilha (.xlsx)'}
          </Button>
        </div>
      )}

      {hasOrders && (
        <>
          <div className="mb-3 flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
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
            {isManager && reps && reps.length > 0 && (
              <div className="sm:w-56">
                <Select
                  value={repId}
                  onChange={(e) => setRepId(e.target.value)}
                  aria-label="Filtrar por representante"
                >
                  <option value={ALL_REPS}>Todos os representantes</option>
                  {reps.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </Select>
              </div>
            )}
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
          {filtered.map((order) => {
            const isSelected = selected.has(order.id);
            const card = (
              <>
                <div className="flex items-start justify-between gap-2">
                  <span className="font-mono text-xs text-muted-foreground">#{order.order_number ?? order.id.slice(0, 8)}</span>
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
              </>
            );

            if (selectMode) {
              return (
                <button
                  key={order.id}
                  type="button"
                  onClick={() => toggleSelected(order.id)}
                  className={cn(
                    'relative block rounded-xl border bg-card p-4 text-left shadow-sm transition-shadow',
                    isSelected ? 'border-brand-600 ring-2 ring-brand-200' : 'border-border hover:border-brand-200',
                  )}
                >
                  <span
                    className={cn(
                      'absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full border-2',
                      isSelected ? 'border-brand-600 bg-brand-600' : 'border-border bg-background',
                    )}
                  >
                    {isSelected && <span className="h-2 w-2 rounded-full bg-white" />}
                  </span>
                  {card}
                </button>
              );
            }

            return (
              <Link
                key={order.id}
                to={`/orders/${order.id}`}
                className="block rounded-xl border border-border bg-card p-4 shadow-sm transition-shadow hover:border-brand-200 hover:shadow-md"
              >
                {card}
              </Link>
            );
          })}
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
