import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Receipt,
  Wallet,
  Users,
  ShoppingCart,
  TrendingUp,
  Percent,
  Target,
  RefreshCw,
  CheckCircle2,
  CloudOff,
} from 'lucide-react';
import { db } from '../../offline/db.js';
import { useAuthStore } from '../../store/authStore.js';
import { useOnlineStatus } from '../../hooks/useOnlineStatus.js';
import { api } from '../../services/api.js';
import { flushSyncQueue } from '../../offline/sync.js';
import { Button } from '../../components/ui/Button.js';
import { Spinner } from '../../components/ui/Spinner.js';
import { Toast } from '../../components/ui/Toast.js';
import { formatBRL } from '../../lib/utils.js';
import type { Order, CustomerWithPriceTable, ApiResponse } from '@csb/shared';

export function PaginaMinhaArea() {
  const { token, user } = useAuthStore();
  const isOnline = useOnlineStatus();
  const orders = useLiveQuery(() => db.orders.toArray(), []);
  const customers = useLiveQuery(() => db.customers.toArray(), []);
  const pendingSync = useLiveQuery(() => db.sync_queue.count(), []) ?? 0;
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  const handleSync = async () => {
    if (!token || syncing) return;
    setSyncing(true);
    try {
      const { synced, failed } = await flushSyncQueue(token);
      if (synced > 0) {
        const r = await api.get<ApiResponse<Order[]>>('/orders', token);
        await db.orders.bulkPut(r.data);
      }
      setToast(
        failed > 0
          ? { message: `${failed} pedido(s) não sincronizaram. Vamos tentar de novo.`, type: 'error' }
          : synced > 0
            ? { message: `${synced} pedido(s) sincronizado(s)!`, type: 'success' }
            : { message: 'Nada para sincronizar.', type: 'info' },
      );
    } catch {
      setToast({ message: 'Erro ao sincronizar. Verifique a conexão.', type: 'error' });
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    api.get<ApiResponse<Order[]>>('/orders', token).then((r) => db.orders.bulkPut(r.data)).catch(() => {});
    api
      .get<ApiResponse<CustomerWithPriceTable[]>>('/customers', token)
      .then((r) => db.customers.bulkPut(r.data))
      .catch(() => {});
  }, [token]);

  const rate = (user?.commission_rate ?? 0) / 100;

  const m = useMemo(() => {
    const list = orders ?? [];
    const now = new Date();
    const thisMonth = (iso: string) => {
      const d = new Date(iso);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    };
    const invoiced = list.filter((o) => o.invoiced && o.invoiced_at);
    const approved = list.filter((o) => o.status === 'approved');
    const faturadoMes = invoiced
      .filter((o) => thisMonth(o.invoiced_at as string))
      .reduce((s, o) => s + (o.total ?? 0), 0);
    const faturadoTotal = invoiced.reduce((s, o) => s + (o.total ?? 0), 0);
    return {
      faturadoMes,
      comissaoMes: faturadoMes * rate,
      comissaoTotal: faturadoTotal * rate,
      pedidosMes: list.filter((o) => thisMonth(o.created_at)).length,
      totalPedidos: list.length,
      ticket: approved.length ? approved.reduce((s, o) => s + (o.total ?? 0), 0) / approved.length : 0,
      taxaAprovacao: list.length ? Math.round((approved.length / list.length) * 100) : 0,
      vendasTotais: list.reduce((s, o) => s + (o.total ?? 0), 0),
    };
  }, [orders, rate]);

  const clientes = customers?.length ?? 0;
  const firstName = user?.name?.trim().split(' ')[0] ?? '';

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-foreground md:text-2xl">
          Olá, {firstName}
        </h1>
        <p className="text-sm text-muted-foreground">
          Seu desempenho · comissão de {user?.commission_rate ?? 0}%
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard icon={Receipt} tint="brand" value={formatBRL(m.faturadoMes)} label="Faturado no mês" />
        <MetricCard icon={Wallet} tint="green" value={formatBRL(m.comissaoMes)} label="Comissão a receber" />
        <MetricCard icon={Users} tint="brand" value={String(clientes)} label="Meus clientes" />
        <MetricCard icon={ShoppingCart} tint="brand" value={String(m.pedidosMes)} label="Pedidos no mês" />
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Sincronização
        </h2>
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                  pendingSync > 0 ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'
                }`}
              >
                {pendingSync > 0 ? (
                  <CloudOff className="h-5 w-5" strokeWidth={2} />
                ) : (
                  <CheckCircle2 className="h-5 w-5" strokeWidth={2} />
                )}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {pendingSync > 0
                    ? `${pendingSync} pedido${pendingSync > 1 ? 's' : ''} aguardando sincronização`
                    : 'Tudo sincronizado'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {isOnline
                    ? 'A sincronização é automática ao reconectar.'
                    : 'Você está offline — sincroniza sozinho ao reconectar.'}
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={syncing || !isOnline}
              onClick={() => void handleSync()}
            >
              {syncing ? <Spinner /> : <RefreshCw className="h-4 w-4" strokeWidth={2.5} />}
              {syncing ? 'Sincronizando…' : 'Sincronizar'}
            </Button>
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Desempenho
        </h2>
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <Row icon={Wallet} label="Comissão total acumulada" value={formatBRL(m.comissaoTotal)} highlight />
          <Row icon={TrendingUp} label="Vendas totais (todos os pedidos)" value={formatBRL(m.vendasTotais)} />
          <Row icon={Target} label="Ticket médio (pedidos aprovados)" value={formatBRL(m.ticket)} />
          <Row icon={Percent} label="Taxa de aprovação" value={`${m.taxaAprovacao}%`} />
          <Row icon={ShoppingCart} label="Total de pedidos" value={String(m.totalPedidos)} last />
        </div>
      </section>

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
  icon: typeof Wallet;
  tint: 'green' | 'brand';
  value: string;
  label: string;
}) {
  const tints: Record<string, string> = {
    green: 'bg-green-100 text-green-700',
    brand: 'bg-brand-100 text-brand-700',
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

function Row({
  icon: Icon,
  label,
  value,
  highlight,
  last,
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  highlight?: boolean;
  last?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between gap-3 px-4 py-3 ${last ? '' : 'border-b border-border'}`}>
      <span className="flex items-center gap-2.5 text-sm text-muted-foreground">
        <Icon className="h-4 w-4 shrink-0" /> {label}
      </span>
      <span className={`text-sm font-semibold ${highlight ? 'text-brand-700' : 'text-foreground'}`}>{value}</span>
    </div>
  );
}
