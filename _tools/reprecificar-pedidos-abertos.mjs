/**
 * Repõe o preço dos pedidos AINDA EM ABERTO depois de uma correção de tabela.
 *
 * Quando a tabela muda, o pedido que já foi para a fábrica fica como está — o
 * valor combinado foi aquele. Mas o que ainda está na mão do representante
 * (rascunho, triagem, fila) precisa sair pelo preço novo, senão ele manda para
 * a fábrica um total que a fábrica não vai faturar. Foi exatamente a queixa do
 * Yan em 13/08/2026: "não deixe os pedidos antigos estarem com o valor errado".
 *
 * Só mexe em: draft, pending_rep, pending_approval — e nunca em faturado.
 * O desconto do pedido é preservado (recalculado sobre o total novo).
 *
 * Uso: node reprecificar-pedidos-abertos.mjs [--aplicar]
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const RAIZ = path.resolve(import.meta.dirname, '..');
const EMPRESA = '4a9fccd7-6241-4b8e-9c0b-b18aca364fba';
const require = createRequire(pathToFileURL(path.join(RAIZ, 'apps/api/.env')));
const { createClient } = require('@supabase/supabase-js');

const env = {};
for (const l of readFileSync(path.join(RAIZ, 'apps/api/.env'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const APLICAR = process.argv.includes('--aplicar');
const ABERTOS = ['draft', 'pending_rep', 'pending_approval'];

const brl = (v) => `R$ ${Number(v ?? 0).toFixed(2).replace('.', ',')}`;

// A mesma régua do app (packages/shared/src/pricing/faixaDeTamanho.ts).
const MAIORES = new Set(['EG', 'EGG', 'EGGG', 'XG', 'XG2', 'XG3', 'XG4', '48', '50', '52', '54']);
const ehMaior = (size) => {
  if (!size) return false;
  const t = String(size).trim().toUpperCase().replace(/\s+/g, '');
  return MAIORES.has(/^\d+$/.test(t) ? String(Number(t)) : t);
};

// ─── Pedidos em aberto ───────────────────────────────────────────────────────
const { data: pedidos } = await db
  .from('orders')
  .select('id, order_number, status, total, invoiced, price_table_id, discount_percent, rep_id')
  .eq('company_id', EMPRESA)
  .in('status', ABERTOS)
  .eq('invoiced', false);
console.log(`Pedidos em aberto: ${pedidos?.length ?? 0}`);
if (!pedidos?.length) process.exit(0);

// ─── Preços e variantes ──────────────────────────────────────────────────────
const precos = new Map();
for (let de = 0; ; de += 1000) {
  const { data } = await db
    .from('product_prices')
    .select('product_id, price_table_id, price, price_larger')
    .range(de, de + 999);
  for (const p of data ?? []) precos.set(`${p.product_id}|${p.price_table_id}`, p);
  if (!data || data.length < 1000) break;
}
const tamanhoDaVariante = new Map();
for (let de = 0; ; de += 1000) {
  const { data } = await db.from('product_variants').select('id, size').range(de, de + 999);
  for (const v of data ?? []) tamanhoDaVariante.set(v.id, v.size);
  if (!data || data.length < 1000) break;
}

let comDiferenca = 0;
const correcoes = [];
for (const o of pedidos) {
  const { data: itens } = await db
    .from('order_items')
    .select('id, product_id, variant_id, quantity, unit_price, total')
    .eq('order_id', o.id);
  if (!itens?.length) continue;

  const novos = [];
  let mudou = false;
  for (const it of itens) {
    const tab = precos.get(`${it.product_id}|${o.price_table_id}`);
    if (!tab) continue; // produto sem preço nesta tabela: não invento valor
    const maior = ehMaior(tamanhoDaVariante.get(it.variant_id));
    const novo = maior && tab.price_larger != null ? Number(tab.price_larger) : Number(tab.price);
    if (Number(it.unit_price) !== novo) mudou = true;
    novos.push({ id: it.id, unit_price: novo, total: Number((novo * it.quantity).toFixed(2)) });
  }
  if (!mudou) continue;
  comDiferenca++;

  const bruto = novos.reduce((s, i) => s + i.total, 0);
  const desconto = Number(o.discount_percent ?? 0);
  const totalNovo = Number((bruto * (1 - desconto / 100)).toFixed(2));
  correcoes.push({ pedido: o, itens: novos, totalNovo });
  console.log(
    `  #${o.order_number ?? o.id.slice(0, 8)} (${o.status}) ${brl(o.total)} → ${brl(totalNovo)}` +
      (desconto ? ` (desconto ${desconto}% mantido)` : ''),
  );
}

console.log(`\nPedidos com valor desatualizado: ${comDiferenca}`);
if (!APLICAR) {
  console.log('ENSAIO — nada gravado. Rode com --aplicar.');
  process.exit(0);
}

let ok = 0;
for (const c of correcoes) {
  for (const it of c.itens) {
    await db.from('order_items').update({ unit_price: it.unit_price, total: it.total }).eq('id', it.id);
  }
  const { error } = await db
    .from('orders')
    .update({ total: c.totalNovo, updated_at: new Date().toISOString() })
    .eq('id', c.pedido.id);
  if (!error) ok++;
}
console.log(`REPRECIFICADO: ${ok} pedido(s).`);
