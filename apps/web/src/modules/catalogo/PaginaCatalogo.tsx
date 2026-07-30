import { useState, useEffect, useMemo, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Search, PackageSearch, ShoppingCart } from 'lucide-react';
import { db } from '../../offline/db.js';
import { useAuthStore } from '../../store/authStore.js';
import { useCartStore } from '../../store/cartStore.js';
import { api } from '../../services/api.js';
import { Input } from '../../components/interface/Input.js';
import { Select } from '../../components/interface/Select.js';
import { Skeleton } from '../../components/interface/Skeleton.js';
import { CartaoProduto } from '../../components/comercial/CartaoProduto.js';
import { SeletorTamanho } from '../../components/comercial/SeletorTamanho.js';
import { cn, formatBRL } from '../../lib/utils.js';
import type { ProductWithPrice, ApiResponse } from '@csb/shared';

const ALL = '__all__';

interface PriceTableOption {
  id: string;
  name: string;
}

type SortKey = 'code' | 'name' | 'price_desc' | 'price_asc';

// Basta UM tamanho com peça para o produto ser vendável. A quantidade em si só
// chega para gerente/admin (ver catalog.service), então não dá para somar aqui.
const temEstoque = (p: ProductWithPrice) => (p.variants ?? []).some((v) => v.in_stock);

// Plumene é outra marca (códigos 2xxx/22xxx) — não entra neste catálogo.
const isPlumene = (sku: string) => /^2/.test(sku);

export function PaginaCatalogo() {
  const { token, user } = useAuthStore();
  const navigate = useNavigate();
  // Representante não vê o estoque atual da fábrica.
  const canSeeStock = user?.role === 'manager' || user?.role === 'admin';
  // Só o gerente/admin escolhe a tabela de preço. O representante usa sempre a
  // tabela que o gerente atribuiu a ele (não pode trocar).
  const canChoosePriceTable = user?.role === 'manager' || user?.role === 'admin';
  const cartItems = useCartStore((s) => s.items);
  const addToCart = useCartStore((s) => s.add);
  const [search, setSearch] = useState('');
  const [brand, setBrand] = useState<string>(ALL);
  const [sort, setSort] = useState<SortKey>('code');
  const [inStockOnly, setInStockOnly] = useState(false);
  // Produtos sem foto ficam ocultos por padrão (catálogo mais limpo); reversível.
  const [showNoPhoto, setShowNoPhoto] = useState(false);
  const [loading, setLoading] = useState(false);
  const [picker, setPicker] = useState<{ product: ProductWithPrice; group: ProductWithPrice[] } | null>(null);

  // ── Consulta de preços por tabela ───────────────────────────────────────────
  // O rep pode VER o catálogo em outra tabela de preço. É só consulta: o carrinho
  // e o pedido continuam na tabela do próprio rep (o servidor precifica por ela).
  const defaultTableId = user?.price_table_id ?? '';
  const [tables, setTables] = useState<PriceTableOption[]>([]);
  const [viewTableId, setViewTableId] = useState<string>(defaultTableId);
  // Overlay: mapa produto→preço da tabela consultada (null = usar a tabela do rep).
  const [overlayPrices, setOverlayPrices] = useState<Map<string, number | null> | null>(null);
  const isConsulting = viewTableId !== '' && viewTableId !== defaultTableId;
  const viewTableName = tables.find((t) => t.id === viewTableId)?.name ?? null;
  const defaultTableName = tables.find((t) => t.id === defaultTableId)?.name ?? null;

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

  // Carrega as tabelas de preço só para quem pode escolher (gerente/admin).
  useEffect(() => {
    if (!token || !canChoosePriceTable) return;
    api
      .get<ApiResponse<PriceTableOption[]>>('/catalog/price-tables', token)
      .then((res) => setTables(res.data))
      .catch(() => {
        /* sem conexão: seguimos só com a tabela do rep */
      });
  }, [token, canChoosePriceTable]);

  // Ao escolher uma tabela diferente da do rep, busca os preços dela e monta o
  // overlay. Esses preços NÃO vão para o Dexie nem para o carrinho — são só exibição.
  useEffect(() => {
    if (!token || !isConsulting) {
      setOverlayPrices(null);
      return;
    }
    let cancelled = false;
    api
      .get<ApiResponse<ProductWithPrice[]>>(`/products?price_table_id=${viewTableId}`, token)
      .then((res) => {
        if (cancelled) return;
        const map = new Map<string, number | null>();
        for (const p of res.data) map.set(p.id, p.price ?? null);
        setOverlayPrices(map);
      })
      .catch(() => {
        if (!cancelled) setOverlayPrices(null);
      });
    return () => {
      cancelled = true;
    };
  }, [token, viewTableId, isConsulting]);

  // Preço a EXIBIR: da tabela consultada quando há overlay, senão o da tabela do rep.
  const priceOf = (p: ProductWithPrice): number | null =>
    overlayPrices ? (overlayPrices.get(p.id) ?? null) : p.price;

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
          return (priceOf(b) ?? 0) - (priceOf(a) ?? 0);
        case 'price_asc':
          return (priceOf(a) ?? 0) - (priceOf(b) ?? 0);
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
      .filter((p) => !inStockOnly || temEstoque(p))
      .filter(
        (p) =>
          !q ||
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          (p.collection?.toLowerCase().includes(q) ?? false),
      )
      .sort(compare);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allProducts, search, brand, sort, inStockOnly, showNoPhoto, overlayPrices]);

  // Agrupa as variações de COR: produtos com o mesmo `variant_group` viram um
  // card único (com bolinhas de cor). Preserva a ordem: o grupo aparece na
  // posição do seu primeiro membro. Produto sem grupo = card individual.
  const groups = useMemo<ProductWithPrice[][]>(() => {
    const byGroup = new Map<string, ProductWithPrice[]>();
    for (const p of filtered) {
      if (!p.variant_group) continue;
      const arr = byGroup.get(p.variant_group) ?? [];
      arr.push(p);
      byGroup.set(p.variant_group, arr);
    }
    const seen = new Set<string>();
    const out: ProductWithPrice[][] = [];
    for (const p of filtered) {
      if (p.variant_group) {
        if (seen.has(p.variant_group)) continue;
        seen.add(p.variant_group);
        out.push(byGroup.get(p.variant_group) ?? [p]);
      } else {
        out.push([p]);
      }
    }
    return out;
  }, [filtered]);

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
        {canChoosePriceTable && tables.length > 1 && (
          <Select
            aria-label="Ver preços da tabela"
            value={viewTableId}
            onChange={(e) => setViewTableId(e.target.value)}
            className="sm:w-52"
          >
            {tables.map((t) => (
              <option key={t.id} value={t.id}>
                Preços: {t.name}
                {t.id === defaultTableId ? ' (sua tabela)' : ''}
              </option>
            ))}
          </Select>
        )}
      </div>

      {isConsulting && (
        <div className="mb-3 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-xs font-medium text-warn-soft-foreground">
          Consultando preços de <strong>{viewTableName}</strong>. É só referência — seus
          pedidos são faturados pela{' '}
          {defaultTableName ? <strong>{defaultTableName}</strong> : 'sua tabela'}.
        </div>
      )}

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
          {groups.map((group) => {
            const rep = group[0]!; // representante do grupo (primeira cor)
            // Card mostra o preço consultado; o picker recebe os produtos ORIGINAIS
            // (preço da tabela do rep) para o carrinho não herdar o preço de consulta.
            const display = isConsulting ? { ...rep, price: priceOf(rep) } : rep;
            const swatches = group.length > 1 ? group.map((g) => g.color_hex) : undefined;
            return (
              <CartaoProduto
                key={rep.variant_group ?? rep.id}
                product={display}
                showStock={canSeeStock}
                inOrder={group.some((g) => cartItems.some((i) => i.product_id === g.id))}
                onAdd={() => setPicker({ product: rep, group })}
                swatches={swatches}
              />
            );
          })}
        </div>
      )}

      {cartCount > 0 && (
        <button
          type="button"
          onClick={() => void navigate('/orders/new')}
          className="fixed bottom-24 right-4 z-40 flex items-center gap-3 rounded-full bg-primary py-3 pl-4 pr-5 text-white shadow-lg transition-colors hover:bg-primary/90 md:bottom-6"
        >
          <span className="relative flex h-6 w-6 items-center justify-center">
            <ShoppingCart className="h-5 w-5" strokeWidth={2} />
            <span className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-white px-1 text-[11px] font-bold text-primary-soft-foreground">
              {cartCount}
            </span>
          </span>
          <span className="text-sm font-semibold">Ver pedido · {formatBRL(cartTotal)}</span>
        </button>
      )}

      {picker && (
        <SeletorTamanho
          product={picker.product}
          colorGroup={picker.group.length > 1 ? picker.group : undefined}
          onClose={() => setPicker(null)}
          onConfirm={(chosen, lines) =>
            lines.forEach((l) =>
              addToCart({
                product_id: chosen.id,
                variant_id: l.variant_id,
                size: l.size,
                product_name: chosen.name,
                sku: chosen.sku,
                quantity: l.quantity,
                unit_price: chosen.price ?? 0,
              }),
            )
          }
        />
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
          ? 'border-primary bg-primary text-white'
          : 'border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}
