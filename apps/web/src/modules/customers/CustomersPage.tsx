import { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { Search, Users, ChevronRight, Building2 } from 'lucide-react';
import { db } from '../../offline/db.js';
import { useAuthStore } from '../../store/authStore.js';
import { api } from '../../services/api.js';
import { Badge } from '../../components/ui/Badge.js';
import { Input } from '../../components/ui/Input.js';
import { Skeleton } from '../../components/ui/Skeleton.js';
import { cn } from '../../lib/utils.js';
import type { CustomerWithPriceTable, ApiResponse } from '@csb/shared';

export function CustomersPage() {
  const { token } = useAuthStore();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');

  const customers = useLiveQuery(
    () =>
      search
        ? db.customers
            .filter(
              (c) =>
                c.name.toLowerCase().includes(search.toLowerCase()) ||
                (c.cnpj ?? '').includes(search),
            )
            .toArray()
        : db.customers.orderBy('name').toArray(),
    [search],
  );

  useEffect(() => {
    if (!token) return;
    api
      .get<ApiResponse<CustomerWithPriceTable[]>>('/customers', token)
      .then((res) => db.customers.bulkPut(res.data))
      .catch(() => {
        /* offline: usamos o cache */
      });
  }, [token]);

  const handleSelect = (customer: { id: string; blocked: boolean }) => {
    if (customer.blocked) return;
    void navigate(`/orders/new?customer_id=${customer.id}`);
  };

  return (
    <div className="p-4 md:p-6">
      <h1 className="mb-4 text-xl font-bold tracking-tight text-foreground md:text-2xl">Clientes</h1>

      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          inputMode="search"
          placeholder="Buscar por nome ou CNPJ…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {customers === undefined ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      ) : customers.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Users className="h-7 w-7" strokeWidth={1.5} />
          </div>
          <p className="font-medium text-foreground">Nenhum cliente encontrado</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {customers.map((customer) => (
            <button
              key={customer.id}
              type="button"
              onClick={() => handleSelect(customer)}
              disabled={customer.blocked}
              className={cn(
                'group flex w-full items-center gap-3 rounded-xl border border-border bg-card p-4 text-left shadow-sm transition-all',
                customer.blocked
                  ? 'cursor-not-allowed opacity-60'
                  : 'hover:border-brand-200 hover:shadow-md active:scale-[0.99]',
              )}
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600">
                <Building2 className="h-5 w-5" strokeWidth={2} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-foreground">{customer.name}</p>
                {customer.cnpj && (
                  <p className="truncate text-xs text-muted-foreground">CNPJ: {customer.cnpj}</p>
                )}
                {customer.blocked && customer.block_reason && (
                  <p className="truncate text-xs text-red-500">{customer.block_reason}</p>
                )}
              </div>
              {customer.blocked ? (
                <Badge variant="red">Bloqueado</Badge>
              ) : (
                <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
