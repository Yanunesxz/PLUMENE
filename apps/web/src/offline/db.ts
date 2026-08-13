import Dexie, { type Table } from 'dexie';
import type { ProductWithPrice, CustomerListItem, Order, OrderItem, PaymentCondition } from '@csb/shared';

export interface SyncQueueItem {
  id?: number;
  local_id: string;
  customer_id: string;
  notes?: string | undefined;
  /** Condição de pagamento escolhida offline — viaja com o pedido no /sync. */
  payment_condition_id?: string | undefined;
  items: Array<{ product_id: string; variant_id?: string | undefined; quantity: number; unit_price: number }>;
  created_at: string;
  updated_at: string;
  attempts: number;
  last_error?: string | undefined;
}

export interface LocalOrder extends Order {
  _sync_status?: 'pending' | 'synced' | 'error';
}

class AppDatabase extends Dexie {
  /** Guardamos o payload completo do catálogo (com preço + variantes) para uso offline. */
  products!: Table<ProductWithPrice, string>;
  customers!: Table<CustomerListItem, string>;
  orders!: Table<LocalOrder, string>;
  order_items!: Table<OrderItem, string>;
  sync_queue!: Table<SyncQueueItem, number>;
  /** As condições de pagamento do Control — o seletor do pedido funciona offline. */
  payment_conditions!: Table<PaymentCondition, string>;

  constructor() {
    super('csb_offline');

    this.version(1).stores({
      products: 'id, company_id, sku, name, active, updated_at',
      customers: 'id, company_id, name, cnpj, blocked, updated_at',
      orders: 'id, company_id, rep_id, customer_id, status, created_at, updated_at, local_id',
      order_items: 'id, order_id, product_id',
      sync_queue: '++id, local_id, created_at, attempts',
    });

    // v2: o catálogo passou a chegar enxuto (sem company_id/updated_at) e com a
    // grade em `in_stock`/`available` no lugar de stock_quantity/stock_committed.
    // O cache antigo não tem esses campos: sem `in_stock`, TODO tamanho pareceria
    // esgotado. Limpamos só os produtos — clientes, pedidos e, principalmente, a
    // FILA OFFLINE continuam intactos (perder pedido não enviado é inaceitável).
    this.version(2)
      .stores({
        products: 'id, sku, name, active',
        customers: 'id, name, cnpj, blocked',
      })
      .upgrade((tx) => tx.table('products').clear());

    // v3: as condições de pagamento do Control ficam em cache — o representante
    // escolhe a condição no pedido mesmo sem sinal, com a lista da última vez
    // que esteve online. `code` indexado: é a ordem do Control na tela.
    this.version(3).stores({
      payment_conditions: 'id, code',
    });
  }
}

export const db = new AppDatabase();

const CACHE_OWNER_KEY = 'csb_cache_owner';

/**
 * O cache offline pertence a UM usuário. Ao entrar com outro usuário (ou outra
 * empresa, no multi-fábrica), zera as tabelas para não misturar catálogo,
 * clientes e pedidos de contas diferentes. Se for o mesmo usuário, não mexe
 * (preserva o cache e a fila de sincronização offline).
 */
export async function resetOfflineIfUserChanged(userId: string): Promise<void> {
  if (localStorage.getItem(CACHE_OWNER_KEY) === userId) return;
  await Promise.all([
    db.products.clear(),
    db.customers.clear(),
    db.orders.clear(),
    db.order_items.clear(),
    db.sync_queue.clear(),
    db.payment_conditions.clear(),
  ]);
  localStorage.setItem(CACHE_OWNER_KEY, userId);
}
