/** A 046 (order_erp_sync, o botão "Atualizar no ERP") já rodou neste banco? */
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
const { count, error } = await db.from('order_erp_sync').select('order_id', { count: 'exact', head: true });
const falta = error && ['42703', '42P01', 'PGRST204', 'PGRST205'].includes(error.code ?? '');
console.log(env.SUPABASE_URL, '→', falta ? 'FALTA a 046' : error ? `ERRO ${error.message}` : `OK, 046 aplicada (${count} fotos guardadas)`);
