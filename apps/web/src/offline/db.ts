import Dexie, { type Table } from 'dexie';
import type { ProductWithPrice, Customer, Order, OrderItem } from '@csb/shared';

export interface SyncQueueItem {
  id?: number;
  local_id: string;
  customer_id: string;
  notes?: string | undefined;
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
  customers!: Table<Customer, string>;
  orders!: Table<LocalOrder, string>;
  order_items!: Table<OrderItem, string>;
  sync_queue!: Table<SyncQueueItem, number>;

  constructor() {
    super('csb_offline');

    this.version(1).stores({
      products: 'id, company_id, sku, name, active, updated_at',
      customers: 'id, company_id, name, cnpj, blocked, updated_at',
      orders: 'id, company_id, rep_id, customer_id, status, created_at, updated_at, local_id',
      order_items: 'id, order_id, product_id',
      sync_queue: '++id, local_id, created_at, attempts',
    });
  }
}

export const db = new AppDatabase();
