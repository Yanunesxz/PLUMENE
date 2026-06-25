import { useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Receipt, Wallet, Users, ShoppingCart, TrendingUp, Percent, Target } from 'lucide-react';
import { db } from '../../offline/db.js';
import { useAuthStore } from '../../store/authStore.js';
import { api } from '../../services/api.js';
import { formatBRL } from '../../lib/utils.js';
import type { Order, CustomerWithPriceTable, ApiResponse } from '@csb/shared';

export function MyAreaPage() {
  const { token, user } = useAuthStore();
  const orders = useLiveQuery(() => db.orders.toArray(), []);
  const customers = useLiveQuery(() => db.customers.toArray(), []);

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
