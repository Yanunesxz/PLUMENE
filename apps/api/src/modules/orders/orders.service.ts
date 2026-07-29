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

export async function getOrderById(
  id: string,
  company_id: string,
  role?: UserRole,
  rep_id?: string,
): Promise<OrderWithItems | null> {
  let query = supabase
    .from('orders')
    .select('*, items:order_items(*)')
    .eq('id', id)
    .eq('company_id', company_id);

  // Representante só acessa os próprios pedidos (gerente/admin veem todos).
  if (role === 'rep' && rep_id) {
    query = query.eq('rep_id', rep_id);
  }

  const { data: order, error } = await query.single();

  if (error || !order) return null;
  return order as OrderWithItems;
}

// Preço dos produtos na tabela de preço do representante. É a fonte autoritativa:
// o unit_price que vem do cliente nunca é usado para gravar/totalizar o pedido.
async function getPriceMap(
  price_table_id: string | null,
  productIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!price_table_id || productIds.length === 0) return map;

  const { data } = await supabase
    .from('product_prices')
    .select('product_id, price')
    .eq('price_table_id', price_table_id)
    .in('product_id', productIds);

  for (const pp of data ?? []) map.set(pp.product_id as string, pp.price as number);
  return map;
}

export async function createOrder(
  company_id: string,
  rep_id: string,
  price_table_id: string | null,
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

  // Recalcula o preço no servidor pela tabela do representante. Se algum item
  // não tiver preço definido nessa tabela, o pedido é recusado (não confiamos
  // num preço vindo do cliente).
  const productIds = [...new Set(body.items.map((item) => item.product_id))];
  const priceMap = await getPriceMap(price_table_id, productIds);

  const items = body.items.map((item) => {
    const unit_price = priceMap.get(item.product_id);
    if (unit_price === undefined) {
      throw new Error('PRICE_NOT_FOUND');
    }
    return {
      product_id: item.product_id,
      variant_id: item.variant_id ?? null,
      quantity: item.quantity,
      unit_price,
      total: item.quantity * unit_price,
    };
  });

  const total = items.reduce((sum, item) => sum + item.total, 0);

  // Pedido enviado pelo representante já nasce na fila do gerente. Sem isto ele
  // ficava em 'draft' para sempre e a tela de aprovação nunca via nada.
  const status: Order['status'] = body.submit ? 'pending_approval' : 'draft';

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .insert({
      company_id,
      rep_id,
      customer_id: body.customer_id,
      status,
      total,
      notes: body.notes ?? null,
      local_id: body.local_id ?? null,
      created_by: rep_id,
    })
    .select()
    .single();

  if (orderError || !order) return null;

  const orderId = (order as Order).id;
  const itemsToInsert = items.map((item) => ({ order_id: orderId, ...item }));

  const { error: itemsError } = await supabase.from('order_items').insert(itemsToInsert);
  if (itemsError) {
    // Rollback compensatório: um pedido sem itens não deve existir. Sem isso,
    // uma falha aqui deixaria um pedido órfão (sem itens) no banco.
    await supabase.from('orders').delete().eq('id', orderId);
    return null;
  }

  return getOrderById(orderId, company_id);
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
  role?: UserRole,
): Promise<Order | null> {
  const { data: current, error: currentError } = await supabase
    .from('orders')
    .select('status, rep_id')
    .eq('id', id)
    .eq('company_id', company_id)
    .single();

  if (currentError || !current) return null;

  const row = current as { status: Order['status']; rep_id: string };

  // Representante só mexe no status dos próprios pedidos (ex.: enviar para aprovação).
  if (role === 'rep' && row.rep_id !== approverId) {
    throw new Error('FORBIDDEN_NOT_OWNER');
  }

  const allowed = ORDER_STATUS_FLOW[row.status];
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
