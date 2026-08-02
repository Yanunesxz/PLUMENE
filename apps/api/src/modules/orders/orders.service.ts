import { supabase } from '../../config/supabase.js';
import type { Order, OrderWithItems, CreateOrderRequest, UpdateOrderStatusRequest } from '@csb/shared';
import { ORDER_STATUS_FLOW } from '@csb/shared';
import type { AuthRole, OrderSource } from '@csb/shared';

export async function getOrders(
  company_id: string,
  role: AuthRole,
  rep_id: string,
  customer_id?: string | null,
): Promise<Order[]> {
  let query = supabase
    .from('orders')
    .select('*')
    .eq('company_id', company_id)
    .order('created_at', { ascending: false });

  if (role === 'rep') query = query.eq('rep_id', rep_id);
  // A loja enxerga por CLIENTE, não por representante: são os pedidos dela,
  // tenha quem tiver montado (ela mesma ou o representante).
  if (role === 'store') query = query.eq('customer_id', customer_id ?? '');

  const { data, error } = await query;
  if (error || !data) return [];
  return data as Order[];
}

export async function getOrderById(
  id: string,
  company_id: string,
  role?: AuthRole,
  rep_id?: string,
  customer_id?: string | null,
): Promise<OrderWithItems | null> {
  let query = supabase
    .from('orders')
    .select('*, items:order_items(*)')
    .eq('id', id)
    .eq('company_id', company_id);

  // Representante só acessa os próprios pedidos (gerente/admin veem todos).
  if (role === 'rep' && rep_id) query = query.eq('rep_id', rep_id);
  // Loja só acessa os pedidos do cliente que ela representa.
  if (role === 'store') query = query.eq('customer_id', customer_id ?? '');

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

/**
 * `orders.source`, `guest_name` e `guest_whatsapp` vêm da migração 014, que pode
 * não estar aplicada. Mandar coluna inexistente no INSERT faz o PostgREST
 * recusar o pedido INTEIRO — o representante deixaria de conseguir vender até
 * alguém rodar o SQL. Detecta uma vez e guarda, para o deploy não depender da
 * ordem. (Mesmo padrão de `reps.service.ts` e `partner.service.ts`.)
 */
let temColunasDeOrigem: boolean | null = null;

async function detectarColunasDeOrigem(): Promise<boolean> {
  if (temColunasDeOrigem !== null) return temColunasDeOrigem;
  const { error } = await supabase.from('orders').select('source').limit(1);
  temColunasDeOrigem = !error;
  return temColunasDeOrigem;
}

/**
 * `pending_rep` (triagem do representante) vem da migração 015, que altera o
 * CHECK de `orders.status`. CHECK não dá para detectar com um SELECT como se faz
 * com coluna: descobrimos tentando gravar. Se o banco recusar, o pedido de loja
 * e de vitrine volta a cair direto na fila do gerente — que é o comportamento da
 * 014 — em vez de a compra simplesmente falhar para quem está do outro lado.
 */
let temTriagem = true;

function recusouOStatus(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === '23514' && /status/i.test(error.message ?? '');
}

export interface OrigemPedido {
  /** Quem montou. `showcase` é o único que pode ficar sem cliente. */
  source: OrderSource;
  /** Vitrine: contato informado no fechamento, já que não há cadastro. */
  guest_name?: string | null;
  guest_whatsapp?: string | null;
  /**
   * Quem apertou enviar. Para a loja é o usuário dela; para a vitrine não há
   * usuário, então fica o representante dono do link. `rep_id` continua sendo
   * quem RECEBE o pedido — os dois só coincidem no caminho do representante.
   */
  created_by?: string;
}

export async function createOrder(
  company_id: string,
  rep_id: string,
  price_table_id: string | null,
  body: CreateOrderRequest,
  origem: OrigemPedido = { source: 'rep' },
): Promise<OrderWithItems | null> {
  const daVitrine = origem.source === 'showcase';

  // Sem a 014, `orders.customer_id` ainda é NOT NULL e não há onde guardar o
  // contato do visitante: o pedido de vitrine simplesmente não cabe no banco.
  // Falha aqui, com motivo, em vez de estourar um 500 sem explicação.
  if (daVitrine && !(await detectarColunasDeOrigem())) {
    throw new Error('ACESSO_INDISPONIVEL');
  }

  // Pedido de vitrine não tem cliente: quem pediu é um visitante identificado
  // só por nome e WhatsApp. Nos outros caminhos, o cliente é obrigatório e
  // precisa estar liberado.
  if (!daVitrine) {
    if (!body.customer_id) return null;
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
  //
  // Loja e vitrine não têm rascunho nem falam direto com a fábrica: param no
  // REPRESENTANTE (`pending_rep`), que decide se aquilo vira pedido. Quem monta
  // o pedido nunca escolhe o próprio status.
  const statusInicial: Order['status'] =
    origem.source === 'rep'
      ? body.submit
        ? 'pending_approval'
        : 'draft'
      : temTriagem
        ? 'pending_rep'
        : 'pending_approval';

  const camposDeOrigem = (await detectarColunasDeOrigem())
    ? {
        source: origem.source,
        guest_name: origem.guest_name ?? null,
        guest_whatsapp: origem.guest_whatsapp ?? null,
      }
    : {};

  const gravar = (status: Order['status']) =>
    supabase
      .from('orders')
      .insert({
        company_id,
        rep_id,
        customer_id: daVitrine ? null : body.customer_id,
        status,
        total,
        notes: body.notes ?? null,
        local_id: body.local_id ?? null,
        created_by: origem.created_by ?? rep_id,
        ...camposDeOrigem,
      })
      .select()
      .single();

  let { data: order, error: orderError } = await gravar(statusInicial);

  // Banco ainda sem a 015: cai para a fila do gerente e não tenta de novo.
  if (recusouOStatus(orderError) && statusInicial === 'pending_rep') {
    temTriagem = false;
    ({ data: order, error: orderError } = await gravar('pending_approval'));
  }

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
  role: AuthRole,
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
  role?: AuthRole,
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

  // O que o representante pode decidir é a TRIAGEM, e só ela: o pedido que
  // chegou da loja ou da vitrine ele manda para a fábrica ou recusa ali mesmo.
  // A palavra final sobre vender continua sendo do gerente — por isso `approved`
  // nunca sai da mão dele, e recusar fora da triagem seria o representante
  // derrubando um pedido que o gerente já tem na mesa.
  if (role === 'rep') {
    const forcandoAprovacao = body.status === 'approved';
    const recusandoForaDaTriagem = body.status === 'rejected' && row.status !== 'pending_rep';
    if (forcandoAprovacao || recusandoForaDaTriagem) {
      throw new Error('FORBIDDEN_ROLE');
    }
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
