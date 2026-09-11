/** A 013 (rastro de quem decidiu cada pedido) existe neste banco? */
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
for (const [nome, tabela, coluna] of [
  ['013 order_status_history', 'order_status_history', 'id'],
  ['035 showcase_links.customer_id', 'showcase_links', 'customer_id'],
  ['028 payment_conditions', 'payment_conditions', 'id'],
]) {
  const { error } = await db.from(tabela).select(coluna).limit(1);
  const falta = error && ['42703', '42P01', 'PGRST204', 'PGRST205'].includes(error.code ?? '');
  console.log((falta ? 'FALTA' : error ? 'ERRO ' : 'OK   '), nome, error && !falta ? error.message : '');
}
