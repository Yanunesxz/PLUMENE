/**
 * Os pedidos mandados pra fábrica desde uma data chegaram na mesa do
 * financeiro e foram tratados por quem? Lista status atual e quem decidiu.
 * Uso: node conferir-chegada-financeiro.mjs 2026-09-01
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
const desde = process.argv[2] ?? '2026-09-01';
const brl = (v) => `R$ ${Number(v ?? 0).toFixed(2).replace('.', ',')}`;
const dia = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');

const { data: users } = await db.from('users').select('id, name, role').eq('company_id', EMPRESA);
const nome = new Map((users ?? []).map((u) => [u.id, `${u.name} (${u.role})`]));

const { data: pedidos } = await db
  .from('orders')
  .select('id, order_number, status, total, created_at, updated_at, rep_id, approved_by, invoiced')
  .eq('company_id', EMPRESA)
  .gte('created_at', `${desde}T00:00:00Z`)
  .in('status', ['pending_approval', 'approved', 'sent_erp', 'rejected'])
  .order('created_at', { ascending: true });

console.log(`Pedidos que foram pra fábrica desde ${desde}: ${pedidos?.length ?? 0}\n`);
const porDecisor = new Map();
for (const o of pedidos ?? []) {
  const quem = o.approved_by ? nome.get(o.approved_by) ?? o.approved_by : '— (ainda na fila)';
  porDecisor.set(quem, (porDecisor.get(quem) ?? 0) + 1);
  console.log(
    `  #${o.order_number ?? o.id.slice(0, 8)} | criado ${dia(o.created_at)} | ${o.status}${o.invoiced ? ' + FATURADO' : ''} | ${brl(o.total)} | rep ${nome.get(o.rep_id) ?? '—'} | decidido por: ${quem}`,
  );
}
console.log('\nQuem decidiu:');
for (const [q, n] of porDecisor) console.log(`  ${q}: ${n}`);
