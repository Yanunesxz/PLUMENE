/** Pedidos parados por status/idade e tabelas de preço sem código do ERP. */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';
const RAIZ = process.argv[2] ?? path.resolve(import.meta.dirname, '..');
const envPath = path.join(RAIZ, 'apps/api/.env');
const require = createRequire(pathToFileURL(envPath));
const { createClient } = require('@supabase/supabase-js');
const env = {};
for (const l of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const todos = [];
for (let de = 0; ; de += 1000) {
  const { data, error } = await db
    .from('orders')
    .select('id, order_number, status, invoiced, created_at, erp_order_id')
    .range(de, de + 999);
  if (error) throw error;
  todos.push(...data);
  if (data.length < 1000) break;
}
const porStatus = {};
for (const o of todos) {
  const k = o.invoiced ? `${o.status} + FATURADO` : o.status;
  porStatus[k] = (porStatus[k] ?? 0) + 1;
}
console.log('pedidos:', todos.length);
console.log(porStatus);

const CORTE = new Date(process.argv[3] ?? '2026-08-12').getTime();
const parados = todos
  .filter((o) => !o.invoiced && ['pending_approval', 'pending_rep', 'approved'].includes(o.status))
  .filter((o) => new Date(o.created_at).getTime() < CORTE);
console.log(`parados ha mais de 30 dias sem faturar: ${parados.length}`);
for (const o of parados.slice(0, 12)) console.log(`  #${o.order_number} ${o.status} ${o.created_at.slice(0, 10)}`);

const { data: tabelas } = await db.from('price_tables').select('name, erp_code');
console.log('tabelas de preço:', tabelas?.map((t) => `${t.name}=${t.erp_code ?? 'SEM CODIGO'}`).join(' | '));

const { data: reps } = await db.from('users').select('name, role, erp_rep_id, active').eq('role', 'rep');
const semCodigo = (reps ?? []).filter((r) => r.active && !r.erp_rep_id);
console.log(`representantes ativos sem código do ERP: ${semCodigo.length}`, semCodigo.map((r) => r.name).join(', '));
