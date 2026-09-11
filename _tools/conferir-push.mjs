/** Alguém já ativou avisos? Se sim, as chaves VAPID estão no Railway. */
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
const { count, error } = await db.from('push_subscriptions').select('id', { count: 'exact', head: true });
console.log(env.SUPABASE_URL, '→ aparelhos com aviso ligado:', error ? `ERRO ${error.message}` : count);
const { count: usuarios } = await db.from('users').select('id', { count: 'exact', head: true }).eq('active', true);
console.log('  logins ativos:', usuarios);
