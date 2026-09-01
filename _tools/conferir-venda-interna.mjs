/** Quem tem a chave venda_interna ligada — e se Simone/Nicoli existem. */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const RAIZ = path.resolve(import.meta.dirname, '..');
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

const { data } = await db
  .from('users')
  .select('name, email, role, erp_rep_id, venda_interna, active')
  .eq('company_id', '4a9fccd7-6241-4b8e-9c0b-b18aca364fba')
  .eq('role', 'rep')
  .or('venda_interna.eq.true,name.ilike.%simone%,name.ilike.%nicoli%,erp_rep_id.eq.04518,erp_rep_id.eq.5525,erp_rep_id.eq.05525');

for (const u of data ?? []) {
  console.log(
    `${u.name} | cod ${u.erp_rep_id ?? '—'} | venda_interna: ${u.venda_interna ? 'SIM' : 'não'} | ${u.active === false ? 'INATIVO' : 'ativo'} | ${u.email}`,
  );
}
if (!data?.length) console.log('Ninguém encontrado.');
