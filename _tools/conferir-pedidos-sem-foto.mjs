/**
 * Pedidos lançados no Control, sem nota, SEM a foto do "Atualizar no ERP" (046)
 * e que MUDARAM depois do lançamento (updated_at > synced_at). Para esses o app
 * não tem como saber o que o Control conhece: só alguém conferindo lá.
 * Só leitura.
 */
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

const { data: lancados, error } = await db
  .from('orders')
  .select('id, order_number, erp_order_id, rep_id, updated_at, synced_at, invoiced')
  .eq('status', 'sent_erp')
  .limit(1000);
if (error) throw error;
const { data: fotos } = await db.from('order_erp_sync').select('order_id').limit(1000);
const comFoto = new Set((fotos ?? []).map((f) => f.order_id));
const { data: reps } = await db.from('users').select('id, name, venda_interna').eq('role', 'rep');
const rep = new Map((reps ?? []).map((r) => [r.id, r]));

const semFoto = lancados.filter((o) => !comFoto.has(o.id));
const abertos = semFoto.filter((o) => !o.invoiced);
const mudaram = abertos.filter((o) => o.synced_at && o.updated_at && new Date(o.updated_at) > new Date(o.synced_at));

console.log(env.SUPABASE_URL);
console.log(`lançados: ${lancados.length} | com foto: ${lancados.length - semFoto.length} | sem foto: ${semFoto.length} (${abertos.length} sem nota)`);
console.log(`sem foto, sem nota e alterados DEPOIS do lançamento: ${mudaram.length}`);
for (const o of mudaram) {
  const r = rep.get(o.rep_id);
  console.log(`  #${o.order_number} ${o.erp_order_id ?? '(sem nº)'} · ${r?.name ?? '?'}${r?.venda_interna ? ' (venda interna)' : ''} · lançado ${o.synced_at?.slice(0, 16)} · mudou ${o.updated_at?.slice(0, 16)}`);
}
