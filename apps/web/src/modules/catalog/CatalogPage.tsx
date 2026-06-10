import { useState, useEffect, useMemo, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Search, PackageSearch } from 'lucide-react';
import { db } from '../../offline/db.js';
import { useAuthStore } from '../../store/authStore.js';
import { api } from '../../services/api.js';
import { Input } from '../../components/ui/Input.js';
import { Skeleton } from '../../components/ui/Skeleton.js';
import { ProductCard } from '../../components/commerce/ProductCard.js';
import { cn } from '../../lib/utils.js';
import type { ProductWithPrice, ApiResponse } from '@csb/shared';

const ALL = '__all__';

export function CatalogPage() {
  const { token } = useAuthStore();
  const [search, setSearch] = useState('');
  const [brand, setBrand] = useState<string>(ALL);
  const [loading, setLoading] = useState(false);

  // Booleanos não são chaves indexáveis no IndexedDB — lemos tudo e filtramos em memória.
  const allProducts = useLiveQuery(() => db.products.toArray(), []);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    api
      .get<ApiResponse<ProductWithPrice[]>>('/products', token)
      .then((res) => db.products.bulkPut(res.data))
      .catch(() => {
        /* offline: seguimos com o cache do Dexie */
      })
      .finally(() => setLoading(false));
  }, [token]);

  const brands = useMemo(() => {
    const set = new Set<string>();
    for (const p of allProducts ?? []) if (p.brand) set.add(p.brand);
    return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [allProducts]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (allProducts ?? [])
      .filter((p) => p.active)
      .filter((p) => brand === ALL || p.brand === brand)
      .filter(
        (p) =>
          !q ||
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          (p.collection?.toLowerCase().includes(q) ?? false),
      )
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }, [allProducts, search, brand]);

  const isInitialLoading = allProducts === undefined || (loading && (allProducts?.length ?? 0) === 0);

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex flex-col gap-1">
        <h1 className="text-xl font-bold tracking-tight text-foreground md:text-2xl">Catálogo</h1>
        <p className="text-sm text-muted-foreground">
          {filtered.length} {filtered.length === 1 ? 'produto' : 'produtos'}
          {brand !== ALL && ` · ${brand}`}
        </p>
      </div>

      <div className="relative mb-3">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          strokeWidth={2}
        />
        <Input
          type="search"
          inputMode="search"
          placeholder="Buscar por nome, SKU ou coleção…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {brands.length > 0 && (
        <div className="no-scrollbar mb-4 flex gap-2 overflow-x-auto pb-1">
          <Chip active={brand === ALL} onClick={() => setBrand(ALL)}>
            Todos
          </Chip>
          {brands.map((b) => (
            <Chip key={b} active={brand === b} onClick={() => setBrand(b)}>
              {b}
            </Chip>
          ))}
        </div>
      )}

      {isInitialLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-2">
              <Skeleton className="aspect-[3/4] w-full rounded-xl" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <PackageSearch className="h-7 w-7" strokeWidth={1.5} />
          </div>
          <div className="space-y-0.5">
            <p className="font-medium text-foreground">Nenhum produto encontrado</p>
            <p className="text-sm text-muted-foreground">
              {search || brand !== ALL
                ? 'Tente ajustar a busca ou os filtros.'
                : 'O catálogo será carregado assim que houver conexão.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {filtered.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
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
