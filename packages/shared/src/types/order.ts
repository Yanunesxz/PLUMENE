import type { OrderStatus } from '../constants/orderStatus.js';
import type { OrderSource } from './access.js';

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
  /** Número sequencial legível do pedido (ex.: 14534). */
  order_number?: number | null;
  rep_id: string;
  /** Nulo em pedido de vitrine: não há cliente cadastrado por trás. */
  customer_id: string | null;
  /**
   * Tabela que precificou ESTE pedido (migração 025). Nulo nos anteriores a ela
   * — aí quem lê deduz pelo cadastro do cliente, como era antes.
   */
  price_table_id?: string | null;
  status: OrderStatus;
  /** Quem montou: representante, loja logada ou vitrine. */
  source?: OrderSource;
  /** Vitrine: contato informado no fechamento, já que não há cadastro. */
  guest_name?: string | null;
  guest_whatsapp?: string | null;
  total: number | null;
  notes: string | null;
  /** Faturado (boleto/NF emitido). */
  invoiced?: boolean;
  /** Quando foi faturado — é o que põe o pedido no mês certo dos relatórios. */
  invoiced_at?: string | null;
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
  /** Ignorado para loja (usa o cliente dela) e ausente na vitrine. */
  customer_id?: string | undefined;
  notes?: string | undefined;
  local_id?: string | undefined;
  /**
   * `true` = o representante fechou o pedido e ele já entra na fila do gerente
   * (`pending_approval`). `false`/ausente = rascunho, ainda em montagem.
   */
  submit?: boolean | undefined;
  /** Vitrine: quem está pedindo. Obrigatórios nesse caminho, ignorados nos outros. */
  guest_name?: string | undefined;
  guest_whatsapp?: string | undefined;
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
