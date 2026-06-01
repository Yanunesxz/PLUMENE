import type { OrderStatus } from '../constants/orderStatus.js';

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  /** Referência à variante (tamanho+cor) escolhida */
  variant_id: string | null;
  quantity: number;
  unit_price: number;
  total: number;
}

export interface Order {
  id: string;
  company_id: string;
  rep_id: string;
  customer_id: string;
  status: OrderStatus;
  total: number | null;
  notes: string | null;
  local_id: string | null;
  synced_at: string | null;
  erp_order_id: string | null;
  created_by: string;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderWithItems extends Order {
  items: OrderItem[];
}

export interface CreateOrderRequest {
  customer_id: string;
  notes?: string | undefined;
  local_id?: string | undefined;
  items: Array<{
    product_id: string;
    variant_id?: string | undefined;
    quantity: number;
    unit_price: number;
  }>;
}

export interface UpdateOrderStatusRequest {
  status: OrderStatus;
  notes?: string;
}

export interface OfflineSyncOrder extends CreateOrderRequest {
  local_id: string;
  created_at: string;
  updated_at: string;
}

export interface SyncRequest {
  orders: OfflineSyncOrder[];
}

export interface SyncResult {
  synced: number;
  failed: Array<{ local_id: string; error: string }>;
}
