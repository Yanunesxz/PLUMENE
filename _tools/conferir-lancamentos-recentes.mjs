/** Os lançamentos no Control mais recentes, e se cada um ganhou a foto da 046. Só leitura. */
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

const { data: fotos, error: eFotos } = await db.from('order_erp_sync').select('order_id, confirmado_em');
console.log(env.SUPABASE_URL, '| fotos:', eFotos ? `ERRO ${eFotos.code} ${eFotos.message}` : fotos.length);
const comFoto = new Set((fotos ?? []).map((f) => f.order_id));

const { data } = await db
  .from('orders')
  .select('order_number, erp_order_id, synced_at, updated_at, id')
  .eq('status', 'sent_erp')
  .not('synced_at', 'is', null)
  .order('synced_at', { ascending: false })
  .limit(8);
for (const o of data ?? []) {
  const folga = Math.round((new Date(o.updated_at) - new Date(o.synced_at)) / 1000);
  console.log(`  #${o.order_number} ${o.erp_order_id ?? '-'} lançado ${o.synced_at} · updated ${folga}s depois · foto: ${comFoto.has(o.id) ? 'SIM' : 'não'}`);
}
