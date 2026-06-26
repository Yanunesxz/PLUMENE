import { useState, useEffect, useMemo, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Search, PackageSearch, ShoppingCart } from 'lucide-react';
import { db } from '../../offline/db.js';
import { useAuthStore } from '../../store/authStore.js';
import { useCartStore } from '../../store/cartStore.js';
import { api } from '../../services/api.js';
import { Input } from '../../components/ui/Input.js';
import { Select } from '../../components/ui/Select.js';
import { Skeleton } from '../../components/ui/Skeleton.js';
import { ProductCard } from '../../components/commerce/ProductCard.js';
import { cn, formatBRL } from '../../lib/utils.js';
import type { ProductWithPrice, ApiResponse } from '@csb/shared';

const ALL = '__all__';

type SortKey = 'code' | 'name' | 'price_desc' | 'price_asc';

const availableOf = (p: ProductWithPrice) =>
  (p.variants ?? []).reduce((s, v) => s + Math.max(0, v.stock_quantity - v.stock_committed), 0);

// Plumene é outra marca (códigos 2xxx/22xxx) — não entra neste catálogo.
const isPlumene = (sku: string) => /^2/.test(sku);

export function CatalogPage() {
  const { token, user } = useAuthStore();
  const navigate = useNavigate();
  // Representante não vê o estoque atual da fábrica.
  const canSeeStock = user?.role === 'manager' || user?.role === 'admin';
  const cartItems = useCartStore((s) => s.items);
  const addToCart = useCartStore((s) => s.add);
  const [search, setSearch] = useState('');
  const [brand, setBrand] = useState<string>(ALL);
  const [sort, setSort] = useState<SortKey>('code');
  const [inStockOnly, setInStockOnly] = useState(false);
  // Produtos sem foto ficam ocultos por padrão (catálogo mais limpo); reversível.
  const [showNoPhoto, setShowNoPhoto] = useState(false);
  const [loading, setLoading] = useState(false);

  const cartCount = cartItems.reduce((n, i) => n + i.quantity, 0);
  const cartTotal = cartItems.reduce((t, i) => t + i.quantity * i.unit_price, 0);

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

  const noPhotoCount = useMemo(
    () => (allProducts ?? []).filter((p) => p.active && !p.image_url && !isPlumene(p.sku)).length,
    [allProducts],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const compare = (a: ProductWithPrice, b: ProductWithPrice) => {
      switch (sort) {
        case 'name':
          return a.name.localeCompare(b.name, 'pt-BR');
        case 'price_desc':
          return (b.price ?? 0) - (a.price ?? 0);
        case 'price_asc':
          return (a.price ?? 0) - (b.price ?? 0);
        case 'code':
        default:
          return a.sku.localeCompare(b.sku, 'pt-BR', { numeric: true });
      }
    };
    return (allProducts ?? [])
      .filter((p) => p.active)
      .filter((p) => !isPlumene(p.sku))
      .filter((p) => showNoPhoto || !!p.image_url)
      .filter((p) => brand === ALL || p.brand === brand)
      .filter((p) => !inStockOnly || availableOf(p) > 0)
      .filter(
        (p) =>
          !q ||
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          (p.collection?.toLowerCase().includes(q) ?? false),
      )
      .sort(compare);
  }, [allProducts, search, brand, sort, inStockOnly, showNoPhoto]);

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

      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
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
        <Select
          aria-label="Ordenar"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="sm:w-52"
        >
          <option value="code">Ordenar: Referência (menor a maior)</option>
          <option value="name">Ordenar: Nome (A–Z)</option>
          <option value="price_desc">Ordenar: Maior preço</option>
          <option value="price_asc">Ordenar: Menor preço</option>
        </Select>
      </div>

      <div className="no-scrollbar mb-4 flex gap-2 overflow-x-auto pb-1">
        <Chip active={inStockOnly} onClick={() => setInStockOnly((v) => !v)}>
          Só com estoque
        </Chip>
        {noPhotoCount > 0 && (
          <Chip active={showNoPhoto} onClick={() => setShowNoPhoto((v) => !v)}>
            {showNoPhoto ? 'Ocultar sem foto' : `Mostrar sem foto (${noPhotoCount})`}
          </Chip>
        )}
        {brands.length > 0 && (
          <>
            <span className="w-px shrink-0 self-stretch bg-border" aria-hidden />
            <Chip active={brand === ALL} onClick={() => setBrand(ALL)}>
              Todos
            </Chip>
            {brands.map((b) => (
              <Chip key={b} active={brand === b} onClick={() => setBrand(b)}>
                {b}
              </Chip>
            ))}
          </>
        )}
      </div>

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
            <ProductCard
              key={product.id}
              product={product}
              showStock={canSeeStock}
              inOrder={cartItems.some((i) => i.product_id === product.id)}
              onAdd={(p) =>
                addToCart({
                  product_id: p.id,
                  product_name: p.name,
                  sku: p.sku,
                  quantity: 1,
                  unit_price: p.price ?? 0,
                })
              }
            />
          ))}
        </div>
      )}

      {cartCount > 0 && (
        <button
          type="button"
          onClick={() => void navigate('/orders/new')}
          className="fixed bottom-24 right-4 z-40 flex items-center gap-3 rounded-full bg-brand-700 py-3 pl-4 pr-5 text-white shadow-lg transition-colors hover:bg-brand-800 md:bottom-6"
        >
          <span className="relative flex h-6 w-6 items-center justify-center">
            <ShoppingCart className="h-5 w-5" strokeWidth={2} />
            <span className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-white px-1 text-[10px] font-bold text-brand-700">
              {cartCount}
            </span>
          </span>
          <span className="text-sm font-semibold">Ver pedido · {formatBRL(cartTotal)}</span>
        </button>
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
