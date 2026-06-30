import 'dotenv/config';
import { supabase } from '../config/supabase.js';

// Dados de demonstração para apresentação:
// 1) Remove pedidos vazios (sem itens) de toda a empresa.
// 2) Cria 3 pedidos por representante ativo, total entre R$14.000 e R$30.000,
//    com pijamas e quantidades variados, precificados pela tabela de cada rep.
//    Variação de status; os aprovados ficam faturados no mês atual (para Comissões).

const MIN_TOTAL = 14000;
const MAX_TOTAL = 30000;
const ORDERS_PER_REP = 3;
const DEMO_TAG = '[apresentação]';

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const randInt = (min: number, max: number) => Math.floor(rand(min, max + 1));
function sample<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy.slice(0, n);
}
const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]!;

interface Priced { id: string; price: number }

// Monta itens cujo total cai dentro de [MIN_TOTAL, MAX_TOTAL].
function buildItems(pajamas: Priced[]) {
  const target = rand(MIN_TOTAL, MAX_TOTAL);
  const chosen = sample(pajamas, randInt(5, 8));
  let items = chosen.map((p) => ({ product_id: p.id, unit_price: p.price, quantity: randInt(15, 60) }));

  const sum = () => items.reduce((s, i) => s + i.unit_price * i.quantity, 0);

  // Escala as quantidades para aproximar do alvo.
  const factor = target / sum();
  items = items.map((i) => ({ ...i, quantity: Math.max(1, Math.round(i.quantity * factor)) }));

  // Ajuste fino no primeiro item.
  const diff = target - sum();
  items[0]!.quantity = Math.max(1, items[0]!.quantity + Math.round(diff / items[0]!.unit_price));

  // Garante a faixa: corrige o primeiro item até cair dentro de [MIN, MAX].
  let total = sum();
  while (total > MAX_TOTAL && items[0]!.quantity > 1) {
    items[0]!.quantity -= 1;
    total = sum();
  }
  while (total < MIN_TOTAL) {
    items[0]!.quantity += 1;
    total = sum();
  }

  return items.map((i) => ({ ...i, total: Math.round(i.unit_price * i.quantity * 100) / 100 }));
}

function isoDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}
function isoThisMonth() {
  const now = new Date();
  const day = randInt(1, Math.min(28, now.getDate()));
  return new Date(now.getFullYear(), now.getMonth(), day, 12, 0, 0).toISOString();
}

async function run() {
  const { data: ref } = await supabase
    .from('users')
    .select('company_id')
    .in('role', ['admin', 'manager'])
    .limit(1)
    .maybeSingle();
  const company_id = (ref as { company_id: string } | null)?.company_id;
  if (!company_id) {
    console.error('❌ Empresa não encontrada.');
    process.exit(1);
  }

  // ── 1) Apaga pedidos vazios (sem itens) ──────────────────────────────────
  const { data: allOrders } = await supabase.from('orders').select('id').eq('company_id', company_id);
  const orderIds = (allOrders ?? []).map((o) => (o as { id: string }).id);
  const { data: itemRows } = await supabase
    .from('order_items')
    .select('order_id')
    .in('order_id', orderIds.length ? orderIds : ['00000000-0000-0000-0000-000000000000']);
  const withItems = new Set((itemRows ?? []).map((r) => (r as { order_id: string }).order_id));
  const emptyIds = orderIds.filter((id) => !withItems.has(id));
  if (emptyIds.length) {
    await supabase.from('orders').delete().in('id', emptyIds);
  }
  console.log(`🧹 Pedidos vazios removidos: ${emptyIds.length}`);

  // ── Clientes não bloqueados (amostra) ────────────────────────────────────
  const { data: custs } = await supabase
    .from('customers')
    .select('id')
    .eq('company_id', company_id)
    .eq('blocked', false)
    .limit(400);
  const customerIds = (custs ?? []).map((c) => (c as { id: string }).id);
  if (customerIds.length === 0) {
    console.error('❌ Nenhum cliente disponível.');
    process.exit(1);
  }

  // ── Reps ativos ──────────────────────────────────────────────────────────
  const { data: reps } = await supabase
    .from('users')
    .select('id, email, price_table_id')
    .eq('company_id', company_id)
    .eq('role', 'rep')
    .eq('active', true)
    .order('email');

  let created = 0;
  for (const rep of (reps ?? []) as Array<{ id: string; email: string; price_table_id: string | null }>) {
    if (!rep.price_table_id) {
      console.log(`⏭️  ${rep.email}: sem tabela de preço — pulado`);
      continue;
    }

    // Pijamas com preço na tabela do rep.
    const { data: prices } = await supabase
      .from('product_prices')
      .select('product_id, price')
      .eq('price_table_id', rep.price_table_id);
    const priceMap = new Map(
      (prices ?? []).map((p) => [(p as { product_id: string }).product_id, Number((p as { price: number }).price)]),
    );
    const { data: prods } = await supabase
      .from('products')
      .select('id, name')
      .eq('company_id', company_id)
      .eq('active', true);
    const pajamas: Priced[] = (prods ?? [])
      .filter((p) => /pijama/i.test((p as { name: string }).name) && priceMap.has((p as { id: string }).id))
      .map((p) => ({ id: (p as { id: string }).id, price: priceMap.get((p as { id: string }).id)! }));

    if (pajamas.length < 5) {
      console.log(`⏭️  ${rep.email}: pijamas com preço insuficientes (${pajamas.length}) — pulado`);
      continue;
    }

    // 3 pedidos: aprovado(faturado) / pendente / rascunho.
    const plan = [
      { status: 'approved', invoiced: true },
      { status: 'pending_approval', invoiced: false },
      { status: 'draft', invoiced: false },
    ].slice(0, ORDERS_PER_REP);

    for (const p of plan) {
      const items = buildItems(pajamas);
      const total = Math.round(items.reduce((s, i) => s + i.total, 0) * 100) / 100;

      const { data: order, error } = await supabase
        .from('orders')
        .insert({
          company_id,
          rep_id: rep.id,
          customer_id: pick(customerIds),
          status: p.status,
          total,
          notes: DEMO_TAG,
          created_by: rep.id,
          created_at: isoDaysAgo(randInt(2, 40)),
          invoiced: p.invoiced,
          invoiced_at: p.invoiced ? isoThisMonth() : null,
        })
        .select('id')
        .single();

      if (error || !order) {
        console.error(`❌ ${rep.email}: ${error?.message}`);
        continue;
      }
      const orderId = (order as { id: string }).id;
      const { error: itemsErr } = await supabase
        .from('order_items')
        .insert(items.map((i) => ({ order_id: orderId, variant_id: null, ...i })));
      if (itemsErr) {
        await supabase.from('orders').delete().eq('id', orderId);
        console.error(`❌ ${rep.email} (itens): ${itemsErr.message}`);
        continue;
      }
      created++;
      console.log(`✅ ${rep.email}: pedido ${p.status}${p.invoiced ? ' (faturado)' : ''} — R$ ${total.toFixed(2)} (${items.length} itens)`);
    }
  }

  console.log(`\n🎉 ${created} pedidos criados.`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
