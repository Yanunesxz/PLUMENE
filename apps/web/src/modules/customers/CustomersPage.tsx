import { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { db } from '../../offline/db.js';
import { useAuthStore } from '../../store/authStore.js';
import { api } from '../../services/api.js';
import { Badge } from '../../components/ui/Badge.js';
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
      .then(async (res) => {
        await db.customers.bulkPut(res.data);
      })
      .catch(() => {});
  }, [token]);

  const handleSelect = (customer: { id: string; blocked: boolean }) => {
    if (customer.blocked) return;
    void navigate(`/orders/new?customer_id=${customer.id}`);
  };

  return (
    <div className="p-4">
      <div className="mb-4">
        <input
          type="search"
          placeholder="Buscar por nome ou CNPJ..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
      </div>

      {customers?.length === 0 && (
        <p className="text-center text-gray-400 py-12">Nenhum cliente encontrado.</p>
      )}

      <ul className="space-y-2">
        {customers?.map((customer) => (
          <li key={customer.id}>
            <button
              onClick={() => handleSelect(customer)}
              disabled={customer.blocked}
              className={`w-full text-left bg-white rounded-xl shadow-sm p-4 flex items-start justify-between gap-3 transition-opacity ${customer.blocked ? 'opacity-60 cursor-not-allowed' : 'active:scale-[0.99]'}`}
            >
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 truncate">{customer.name}</p>
                {customer.cnpj && <p className="text-xs text-gray-400 mt-0.5">CNPJ: {customer.cnpj}</p>}
                {customer.blocked && customer.block_reason && (
                  <p className="text-xs text-red-500 mt-1">{customer.block_reason}</p>
                )}
              </div>
              <div className="shrink-0">
                {customer.blocked ? (
                  <Badge variant="red">Bloqueado</Badge>
                ) : (
                  <Badge variant="green">Ativo</Badge>
                )}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
