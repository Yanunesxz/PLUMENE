import Dexie, { type Table } from 'dexie';
import type { Product, Customer, Order, OrderItem } from '@csb/shared';

export interface SyncQueueItem {
  id?: number;
  local_id: string;
  customer_id: string;
  notes?: string;
  items: Array<{ product_id: string; quantity: number; unit_price: number }>;
  created_at: string;
  updated_at: string;
  attempts: number;
  last_error?: string;
}

export interface LocalOrder extends Order {
  _sync_status?: 'pending' | 'synced' | 'error';
}

class AppDatabase extends Dexie {
  products!: Table<Product, string>;
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
