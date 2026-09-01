/**
 * Carimba pedidos como FATURADOS em uma data passada.
 *
 * Existe por um motivo específico (Yan, 01/09/2026): pedidos que a fábrica
 * faturou no mês passado ficaram sem o carimbo no app. Marcá-los hoje pelo
 * botão jogaria o valor no "Faturado no mês" DESTE mês — mês que não é o
 * dele. Aqui a data entra à mão, e o valor cai no mês certo.
 *
 * A soma da Minha Área usa `invoiced_at` (não a data do pedido), então o
 * retroativo já sai fora do mês corrente sem mais nada.
 *
 * Também empurra `customers.last_purchase_at` (só PARA FRENTE), do mesmo jeito
 * que a rota de faturamento faz — a carteira não pode ficar mentindo.
 *
 * Uso:
 *   listar candidatos (sem faturar) de um representante:
 *     node faturar-retroativo.mjs --rep 04518 --listar
 *   carimbar pedidos numa data:
 *     node faturar-retroativo.mjs --rep 04518 --data 2026-08-29 --pedidos 14550,14551 [--aplicar]
 *
 * Sem --aplicar é ensaio: mostra o que faria e não escreve nada.
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const RAIZ = path.resolve(import.meta.dirname, '..');
const EMPRESA = '4a9fccd7-6241-4b8e-9c0b-b18aca364fba'; // Corpo Sensual
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

const arg = (nome) => {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : null;
};
const APLICAR = process.argv.includes('--aplicar');
const LISTAR = process.argv.includes('--listar');
const codigoRep = arg('rep');
const data = arg('data');
const pedidosArg = arg('pedidos');

if (!codigoRep) {
  console.error('Falta --rep CODIGO (ex.: --rep 04518)');
  process.exit(1);
}

const miolo = (v) => String(v ?? '').replace(/\D/g, '').replace(/^0+/, '');
const brl = (v) => `R$ ${Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
const dia = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—');

// ─── O representante ─────────────────────────────────────────────────────────
const { data: reps } = await db
  .from('users')
  .select('id, name, erp_rep_id, venda_interna')
  .eq('company_id', EMPRESA)
  .eq('role', 'rep');
const rep = (reps ?? []).find((u) => miolo(u.erp_rep_id) === miolo(codigoRep));
if (!rep) {
  console.error(`❌ Nenhum representante com código ${codigoRep}.`);
  process.exit(1);
}
console.log(`Representante: ${rep.name} (${rep.erp_rep_id})${rep.venda_interna ? ' · venda interna' : ''}\n`);

// ─── Os pedidos dele ─────────────────────────────────────────────────────────
const { data: pedidos } = await db
  .from('orders')
  .select('id, order_number, status, total, invoiced, invoiced_at, created_at, customer_id')
  .eq('company_id', EMPRESA)
  .eq('rep_id', rep.id)
  .order('order_number', { ascending: true });

const clientes = new Map();
for (let de = 0; ; de += 1000) {
  const { data } = await db
    .from('customers')
    .select('id, name, last_purchase_at')
    .eq('company_id', EMPRESA)
    .range(de, de + 999);
  for (const c of data ?? []) clientes.set(c.id, c);
  if (!data || data.length < 1000) break;
}
const nomeDo = (id) => clientes.get(id)?.name ?? '—';

if (LISTAR) {
  const agora = new Date();
  const inicioDoMes = new Date(agora.getFullYear(), agora.getMonth(), 1);
  const candidatos = (pedidos ?? []).filter(
    (o) => !o.invoiced && new Date(o.created_at) < inicioDoMes && o.status !== 'rejected',
  );
  console.log(`SEM CARIMBO e de antes deste mês (${candidatos.length}):\n`);
  for (const o of candidatos) {
    console.log(
      `  #${o.order_number ?? o.id.slice(0, 8)} | ${dia(o.created_at)} | ${brl(o.total)} | ${o.status} | ${nomeDo(o.customer_id)}`,
    );
  }
  const jaFaturados = (pedidos ?? []).filter((o) => o.invoiced).length;
  console.log(`\nTotal de pedidos dele: ${pedidos?.length ?? 0} · já faturados: ${jaFaturados}`);
  console.log(`Soma dos candidatos: ${brl(candidatos.reduce((s, o) => s + Number(o.total ?? 0), 0))}`);
  process.exit(0);
}

// ─── Carimbar ────────────────────────────────────────────────────────────────
if (!data || !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
  console.error('Falta --data AAAA-MM-DD (ex.: --data 2026-08-29)');
  process.exit(1);
}
if (!pedidosArg) {
  console.error('Falta --pedidos 14550,14551 (números do pedido, separados por vírgula)');
  process.exit(1);
}
// Meio-dia: fuso não empurra o carimbo para o dia (nem o mês) vizinho.
const quando = new Date(`${data}T12:00:00.000Z`).toISOString();
const numeros = pedidosArg.split(',').map((n) => Number(String(n).replace(/\D/g, ''))).filter(Boolean);

console.log(`Data do faturamento: ${dia(quando)}  (${numeros.length} pedido(s) pedidos)\n`);

let ok = 0;
const problemas = [];
for (const numero of numeros) {
  const o = (pedidos ?? []).find((p) => p.order_number === numero);
  if (!o) { problemas.push(`#${numero}: não é pedido de ${rep.name}`); continue; }
  if (o.invoiced) { problemas.push(`#${numero}: JÁ faturado em ${dia(o.invoiced_at)} — não mexi`); continue; }

  console.log(`  #${numero} | ${brl(o.total)} | ${nomeDo(o.customer_id)} → faturado em ${dia(quando)}`);
  if (!APLICAR) { ok++; continue; }

  const { error } = await db
    .from('orders')
    .update({ invoiced: true, invoiced_at: quando, updated_at: new Date().toISOString() })
    .eq('id', o.id)
    .eq('company_id', EMPRESA);
  if (error) { problemas.push(`#${numero}: falha ao gravar (${error.message})`); continue; }
  ok++;

  // A carteira acompanha: última compra só anda para frente.
  const cli = clientes.get(o.customer_id);
  const diaDaCompra = quando.slice(0, 10);
  if (cli && (!cli.last_purchase_at || cli.last_purchase_at < diaDaCompra)) {
    await db.from('customers').update({ last_purchase_at: diaDaCompra }).eq('id', cli.id);
  }
}

console.log(`\n${APLICAR ? 'FEITO' : 'ENSAIO (nada gravado — rode com --aplicar)'}: ${ok} pedido(s).`);
if (problemas.length) {
  console.log('\nAtenção:');
  for (const p of problemas) console.log('  - ' + p);
}
