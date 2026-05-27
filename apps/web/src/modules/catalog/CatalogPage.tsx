import { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../offline/db.js';
import { useAuthStore } from '../../store/authStore.js';
import { api } from '../../services/api.js';
import { Badge } from '../../components/ui/Badge.js';
import type { ProductWithPrice, ApiResponse } from '@csb/shared';

export function CatalogPage() {
  const { token, user } = useAuthStore();
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  const products = useLiveQuery(
    () =>
      search
        ? db.products
            .filter((p) => p.name.toLowerCase().includes(search.toLowerCase()) || p.sku.toLowerCase().includes(search.toLowerCase()))
            .toArray()
        : db.products.where('active').equals(1).toArray(),
    [search],
  );

  useEffect(() => {
    if (!token || !user) return;
    setLoading(true);
    const priceTableParam = user.role === 'rep' ? '' : '';
    api
      .get<ApiResponse<ProductWithPrice[]>>(`/products${priceTableParam}`, token)
      .then(async (res) => {
        await db.products.bulkPut(res.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token, user]);

  return (
    <div className="p-4">
      <div className="mb-4">
        <input
          type="search"
          placeholder="Buscar produto ou SKU..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
      </div>

      {loading && <p className="text-sm text-gray-400 text-center py-2">Atualizando catálogo...</p>}

      {products?.length === 0 && !loading && (
        <p className="text-center text-gray-400 py-12">Nenhum produto encontrado.</p>
      )}

      <ul className="space-y-2">
        {products?.map((product) => (
          <li key={product.id} className="bg-white rounded-xl shadow-sm p-4 flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="font-medium text-gray-900 truncate">{product.name}</p>
              <p className="text-xs text-gray-400 mt-0.5">SKU: {product.sku}</p>
              {product.description && (
                <p className="text-xs text-gray-500 mt-1 line-clamp-2">{product.description}</p>
              )}
            </div>
            <div className="flex flex-col items-end gap-1 shrink-0">
              {!product.active && <Badge variant="red">Inativo</Badge>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
