/**
 * A mesa do financeiro está recebendo? Lista quem é financeiro e os pedidos
 * que hoje esperam o aceite (pending_approval) — o que cai na fila "Chegaram".
 * Uso: node conferir-mesa-financeiro.mjs [nome-para-procurar]
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
const procurar = (process.argv[2] ?? '').toLowerCase();
const brl = (v) => `R$ ${Number(v ?? 0).toFixed(2).replace('.', ',')}`;
const dia = (iso) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

const { data: users } = await db
  .from('users')
  .select('id, name, email, role, active, last_login_at')
  .eq('company_id', EMPRESA)
  .or(`role.eq.financeiro${procurar ? `,name.ilike.%${procurar}%` : ''}`);
console.log('Logins do financeiro (ou com o nome procurado):');
for (const u of users ?? []) {
  console.log(`  ${u.name} | ${u.role} | ${u.active === false ? 'INATIVO' : 'ativo'} | ${u.email} | último login: ${u.last_login_at ? dia(u.last_login_at) : '—'}`);
}
if (!users?.length) console.log('  (nenhum)');

const { data: fila } = await db
  .from('orders')
  .select('id, order_number, status, total, created_at, rep_id, customer_id, updated_at')
  .eq('company_id', EMPRESA)
  .eq('status', 'pending_approval')
  .order('created_at', { ascending: true });
const reps = new Map();
const { data: rs } = await db.from('users').select('id, name').eq('company_id', EMPRESA);
for (const r of rs ?? []) reps.set(r.id, r.name);
const clientes = new Map();
if (fila?.length) {
  const ids = [...new Set(fila.map((o) => o.customer_id).filter(Boolean))];
  const { data: cs } = await db.from('customers').select('id, name').in('id', ids);
  for (const c of cs ?? []) clientes.set(c.id, c.name);
}
console.log(`\nNa mesa do financeiro agora (pending_approval): ${fila?.length ?? 0}`);
for (const o of fila ?? []) {
  console.log(`  #${o.order_number ?? o.id.slice(0, 8)} | ${dia(o.created_at)} | ${brl(o.total)} | rep ${reps.get(o.rep_id) ?? '—'} | ${clientes.get(o.customer_id) ?? '—'}`);
}
