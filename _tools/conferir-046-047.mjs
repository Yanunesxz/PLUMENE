/** 046 e 047 visíveis para a API? GET de uma linha, nunca HEAD (ver memória conferir-migracao-com-get). */
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
console.log(env.SUPABASE_URL);
for (const [nome, tabela, coluna] of [
  ['046 order_erp_sync', 'order_erp_sync', 'order_id'],
  ['046 order_erp_sync.assinatura_pedida', 'order_erp_sync', 'assinatura_pedida'],
  ['047 customers.varejo', 'customers', 'varejo'],
]) {
  const { error } = await db.from(tabela).select(coluna).limit(1);
  console.log(error ? `  FALTA ${nome} (${error.code})` : `  OK    ${nome}`);
}
