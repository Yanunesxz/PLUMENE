import { supabase } from '../../config/supabase.js';
import type { Order, OrderWithItems, CreateOrderRequest, UpdateOrderStatusRequest } from '@csb/shared';
import { ORDER_STATUS_FLOW } from '@csb/shared';
import type { UserRole } from '@csb/shared';

export async function getOrders(
  company_id: string,
  role: UserRole,
  rep_id: string,
): Promise<Order[]> {
  let query = supabase
    .from('orders')
    .select('*')
    .eq('company_id', company_id)
    .order('created_at', { ascending: false });

  if (role === 'rep') {
    query = query.eq('rep_id', rep_id);
  }

  const { data, error } = await query;
  if (error || !data) return [];
  return data as Order[];
}

export async function getOrderById(id: string, company_id: string): Promise<OrderWithItems | null> {
  const { data: order, error } = await supabase
    .from('orders')
    .select('*, items:order_items(*)')
    .eq('id', id)
    .eq('company_id', company_id)
    .single();

  if (error || !order) return null;
  return order as OrderWithItems;
}

export async function createOrder(
  company_id: string,
  rep_id: string,
  body: CreateOrderRequest,
): Promise<OrderWithItems | null> {
  const { data: customer } = await supabase
    .from('customers')
    .select('id, blocked')
    .eq('id', body.customer_id)
    .eq('company_id', company_id)
    .single();

  if (!customer) return null;
  if ((customer as { blocked: boolean }).blocked) {
    throw new Error('CUSTOMER_BLOCKED');
  }

  const total = body.items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .insert({
      company_id,
      rep_id,
      customer_id: body.customer_id,
      status: 'draft',
      total,
      notes: body.notes ?? null,
      local_id: body.local_id ?? null,
      created_by: rep_id,
    })
    .select()
    .single();

  if (orderError || !order) return null;

  const items = body.items.map((item) => ({
    order_id: (order as Order).id,
    product_id: item.product_id,
    variant_id: item.variant_id ?? null,
    quantity: item.quantity,
    unit_price: item.unit_price,
    total: item.quantity * item.unit_price,
  }));

  const { error: itemsError } = await supabase.from('order_items').insert(items);
  if (itemsError) return null;

  return getOrderById((order as Order).id, company_id);
}

export type DeleteOrderResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'forbidden' | 'invoiced' };

export async function deleteOrder(
  id: string,
  company_id: string,
  rep_id: string,
  role: UserRole,
): Promise<DeleteOrderResult> {
  const { data: order } = await supabase
    .from('orders')
    .select('id, rep_id, invoiced')
    .eq('id', id)
    .eq('company_id', company_id)
    .maybeSingle();

  if (!order) return { ok: false, reason: 'not_found' };
  const o = order as { rep_id: string; invoiced: boolean | null };
  if (role === 'rep' && o.rep_id !== rep_id) return { ok: false, reason: 'forbidden' };
  if (o.invoiced) return { ok: false, reason: 'invoiced' };

  // order_items tem ON DELETE CASCADE — somem junto.
  const { error } = await supabase.from('orders').delete().eq('id', id).eq('company_id', company_id);
  if (error) return { ok: false, reason: 'not_found' };
  return { ok: true };
}

export async function setOrderInvoiced(
  id: string,
  company_id: string,
  invoiced: boolean,
): Promise<Order | null> {
  const { data, error } = await supabase
    .from('orders')
    .update({
      invoiced,
      invoiced_at: invoiced ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('company_id', company_id)
    .select()
    .maybeSingle();

  if (error || !data) return null;
  return data as Order;
}

export async function updateOrderStatus(
  id: string,
  company_id: string,
  approverId: string,
  body: UpdateOrderStatusRequest,
): Promise<Order | null> {
  const current = await getOrderById(id, company_id);
  if (!current) return null;

  const allowed = ORDER_STATUS_FLOW[current.status];
  if (!allowed.includes(body.status)) {
    throw new Error('INVALID_STATUS_TRANSITION');
  }

  const update: Partial<Order> = {
    status: body.status,
    updated_at: new Date().toISOString(),
  };

  if (body.status === 'approved' || body.status === 'rejected') {
    update.approved_by = approverId;
  }

  if (body.notes) {
    update.notes = body.notes;
  }

  const { data, error } = await supabase
    .from('orders')
    .update(update)
    .eq('id', id)
    .eq('company_id', company_id)
    .select()
    .single();

  if (error || !data) return null;
  return data as Order;
}
