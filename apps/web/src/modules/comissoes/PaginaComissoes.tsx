import { useEffect, useMemo, useState } from 'react';
import { TrendingUp, Wallet, Receipt, Inbox, Crown, Search } from 'lucide-react';
import { useAuthStore } from '../../store/authStore.js';
import { api } from '../../services/api.js';
import { Select } from '../../components/interface/Select.js';
import { Input } from '../../components/interface/Input.js';
import { Skeleton } from '../../components/interface/Skeleton.js';
import { formatBRL } from '../../lib/utils.js';
import type { RepListItem, Order, ApiResponse } from '@csb/shared';

const ALL = '__all__';
const monthKey = (iso: string) => iso.slice(0, 7);

export function PaginaComissoes() {
  const { token } = useAuthStore();
  const [reps, setReps] = useState<RepListItem[] | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [repId, setRepId] = useState<string>(ALL);
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!token) return;
    void api.get<ApiResponse<RepListItem[]>>('/reps', token).then((r) => setReps(r.data)).catch(() => setReps([]));
    void api.get<ApiResponse<Order[]>>('/orders', token).then((r) => setOrders(r.data)).catch(() => {});
  }, [token]);

  // Visão consolidada: uma linha por representante + total geral.
  const byRep = useMemo(() => {
    const rows = (reps ?? [])
      .map((r) => {
        const rate = (r.commission_rate ?? 0) / 100;
        const invoiced = orders.filter((o) => o.rep_id === r.id && o.invoiced && o.invoiced_at);
        const fatMes = invoiced
          .filter((o) => monthKey(o.invoiced_at as string) === month)
          .reduce((s, o) => s + (o.total ?? 0), 0);
        const fatTotal = invoiced.reduce((s, o) => s + (o.total ?? 0), 0);
        return {
          id: r.id,
          name: r.name,
          pct: r.commission_rate ?? 0,
          fatMes,
          comMes: fatMes * rate,
          comTotal: fatTotal * rate,
        };
      })
      .sort((a, b) => b.comMes - a.comMes || b.comTotal - a.comTotal);
    const totals = rows.reduce(
      (acc, r) => ({
        fatMes: acc.fatMes + r.fatMes,
        comMes: acc.comMes + r.comMes,
        comTotal: acc.comTotal + r.comTotal,
      }),
      { fatMes: 0, comMes: 0, comTotal: 0 },
    );
    return { rows, totals };
  }, [reps, orders, month]);

  // Visão de um representante específico.
  const rep = reps?.find((r) => r.id === repId);
  const rate = (rep?.commission_rate ?? 0) / 100;
  const single = useMemo(() => {
    const repOrders = orders.filter((o) => o.rep_id === repId && o.invoiced && o.invoiced_at);
    const monthOrders = repOrders
      .filter((o) => monthKey(o.invoiced_at as string) === month)
      .sort((a, b) => (b.invoiced_at ?? '').localeCompare(a.invoiced_at ?? ''));
    const fatMes = monthOrders.reduce((s, o) => s + (o.total ?? 0), 0);
    const fatTotal = repOrders.reduce((s, o) => s + (o.total ?? 0), 0);
    return { monthOrders, fatMes, comMes: fatMes * rate, comTotal: fatTotal * rate };
  }, [orders, repId, month, rate]);

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-foreground md:text-2xl">Comissões</h1>
        <p className="text-sm text-muted-foreground">Calculada sobre os pedidos faturados.</p>
      </div>

      {reps === null ? (
        <Skeleton className="h-24 w-full rounded-xl" />
      ) : reps.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum representante cadastrado.</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Representante</label>
              <Select value={repId} onChange={(e) => setRepId(e.target.value)}>
                <option value={ALL}>Todos os representantes</option>
                {reps.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} · {r.commission_rate}%
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Mês</label>
              <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            </div>
          </div>

          {repId === ALL ? (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                <MetricCard icon={Receipt} tint="brand" value={formatBRL(byRep.totals.fatMes)} label="Faturado no mês (geral)" />
                <MetricCard icon={Wallet} tint="green" value={formatBRL(byRep.totals.comMes)} label="Comissão no mês (geral)" />
                <MetricCard icon={TrendingUp} tint="brand" value={formatBRL(byRep.totals.comTotal)} label="Comissão total (geral)" />
              </div>

              <section>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Por representante
                </h2>
                {byRep.rows.length > 1 && (
                  <div className="relative mb-3">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      type="search"
                      inputMode="search"
                      placeholder="Buscar representante…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                )}
                <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                  <ul className="divide-y divide-border">
                    {byRep.rows
                      .map((r, i) => ({ r, i }))
                      .filter(({ r }) =>
                        r.name.toLowerCase().includes(search.trim().toLowerCase()),
                      )
                      .map(({ r, i }) => (
                      <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <span
                            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                              i === 0 && r.comMes > 0 ? 'bg-brand-600 text-white' : 'bg-brand-50 text-brand-700'
                            }`}
                          >
                            {i === 0 && r.comMes > 0 ? <Crown className="h-3.5 w-3.5" /> : i + 1}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-foreground">{r.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {r.pct}% · faturado {formatBRL(r.fatMes)} · total {formatBRL(r.comTotal)}
                            </p>
                          </div>
                        </div>
                        <span className="shrink-0 text-sm font-semibold text-foreground">{formatBRL(r.comMes)}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="flex items-center justify-between border-t border-border px-4 py-3">
                    <span className="text-sm font-medium text-muted-foreground">Total geral (comissão do mês)</span>
                    <span className="text-lg font-bold text-foreground">{formatBRL(byRep.totals.comMes)}</span>
                  </div>
                </div>
              </section>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                <MetricCard icon={Receipt} tint="brand" value={formatBRL(single.fatMes)} label="Faturado no mês" />
                <MetricCard icon={Wallet} tint="green" value={formatBRL(single.comMes)} label={`Comissão do mês (${rep?.commission_rate ?? 0}%)`} />
                <MetricCard icon={TrendingUp} tint="brand" value={formatBRL(single.comTotal)} label="Comissão total acumulada" />
              </div>

              <section>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Pedidos faturados no mês
                </h2>
                {single.monthOrders.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <Inbox className="h-7 w-7" strokeWidth={1.5} />
                    </div>
                    <p className="text-sm text-muted-foreground">Nenhum pedido faturado neste mês para este representante.</p>
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                    <ul className="divide-y divide-border">
                      {single.monthOrders.map((o) => (
                        <li key={o.id} className="flex items-center justify-between gap-3 px-4 py-3">
                          <div className="min-w-0">
                            <p className="font-mono text-xs text-muted-foreground">#{o.order_number ?? o.id.slice(0, 8)}</p>
                            <p className="text-xs text-muted-foreground">
                              faturado em {o.invoiced_at ? new Date(o.invoiced_at).toLocaleDateString('pt-BR') : '—'}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-semibold text-foreground">{formatBRL(o.total ?? 0)}</p>
                            <p className="text-xs text-brand-700">+{formatBRL((o.total ?? 0) * rate)}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                    <div className="flex items-center justify-between border-t border-border px-4 py-3">
                      <span className="text-sm text-muted-foreground">Comissão do mês</span>
                      <span className="text-lg font-bold text-foreground">{formatBRL(single.comMes)}</span>
                    </div>
                  </div>
                )}
              </section>
            </>
          )}
        </>
      )}
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
