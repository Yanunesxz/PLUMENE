/** Clientes que nenhum representante enxerga, e-mail em branco, e a régua em vigor. */
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

const { data: empresas } = await db.from('companies').select('name, carteira_atencao_dias, carteira_esfriado_dias');
console.log('régua em vigor:', empresas?.map((e) => `${e.name}=${e.carteira_atencao_dias}/${e.carteira_esfriado_dias}`).join(' | '));

const { data: reps } = await db.from('users').select('erp_rep_id').eq('role', 'rep').eq('active', true);
const codigosVivos = new Set((reps ?? []).map((r) => r.erp_rep_id).filter(Boolean));

const todos = [];
for (let de = 0; ; de += 1000) {
  const { data } = await db.from('customers').select('rep_id, rep_erp_id, email').range(de, de + 999);
  todos.push(...(data ?? []));
  if ((data ?? []).length < 1000) break;
}
const orfaos = todos.filter((c) => !c.rep_id && !codigosVivos.has(c.rep_erp_id));
const semDonoNenhum = todos.filter((c) => !c.rep_id && !c.rep_erp_id);
const semEmail = todos.filter((c) => !c.email || !String(c.email).trim());
console.log(`clientes: ${todos.length}`);
console.log(`  invisíveis para todo representante: ${orfaos.length} (${((orfaos.length / todos.length) * 100).toFixed(0)}%)`);
console.log(`    destes, sem dono nenhum: ${semDonoNenhum.length}`);
console.log(`  sem e-mail cadastrado: ${semEmail.length} (${((semEmail.length / todos.length) * 100).toFixed(0)}%)`);
console.log(`  representantes ativos com código: ${codigosVivos.size}`);
