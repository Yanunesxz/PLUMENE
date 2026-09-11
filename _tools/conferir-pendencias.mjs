/**
 * O que JÁ está aplicado no banco e o que ainda falta — a verdade, não o
 * arquivo de migração. Roda contra o Supabase configurado em apps/api/.env.
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const RAIZ = process.argv[2] ?? path.resolve(import.meta.dirname, '..');
const envPath = path.join(RAIZ, 'apps/api/.env');
if (!existsSync(envPath)) {
  console.log('SEM .env em', envPath);
  process.exit(0);
}
const require = createRequire(pathToFileURL(envPath));
const { createClient } = require('@supabase/supabase-js');
const env = {};
for (const l of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

console.log('banco:', env.SUPABASE_URL);

/** Uma coluna existe? Pergunta ao PostgREST e lê o código do erro. */
async function temColuna(tabela, coluna) {
  const { error } = await db.from(tabela).select(coluna).limit(1);
  if (!error) return true;
  const c = error.code ?? '';
  if (['42703', '42P01', 'PGRST204', 'PGRST205'].includes(c)) return false;
  return `ERRO(${c}): ${error.message}`;
}

const checagens = [
  ['034 push_subscriptions', 'push_subscriptions', 'id'],
  ['037 rep_tasks', 'rep_tasks', 'id'],
  ['039 customers.inactivity_reason', 'customers', 'inactivity_reason'],
  ['040 deleted_orders', 'deleted_orders', 'id'],
  ['041 customers.cep', 'customers', 'cep'],
  ['041 customers.cnpj_digits', 'customers', 'cnpj_digits'],
  ['043 companies.carteira_atencao_dias', 'companies', 'carteira_atencao_dias'],
  ['044 order_originals', 'order_originals', 'order_id'],
];

for (const [nome, tabela, coluna] of checagens) {
  const r = await temColuna(tabela, coluna);
  console.log(String(r === true ? 'OK   ' : r === false ? 'FALTA' : 'ERRO '), nome, r === true || r === false ? '' : r);
}

// 042 é um ÍNDICE — não dá para ver pelo PostgREST. O jeito honesto é olhar se
// existe número repetido (o que o índice impediria).
const { data: pedidos } = await db
  .from('orders')
  .select('company_id, erp_order_id')
  .not('erp_order_id', 'is', null)
  .limit(1000);
const vistos = new Map();
let repetidos = 0;
for (const p of pedidos ?? []) {
  const k = `${p.company_id}|${p.erp_order_id}`;
  if (vistos.has(k)) repetidos++;
  vistos.set(k, true);
}
console.log(`042 (índice único): ${pedidos?.length ?? 0} pedidos com número do Control, ${repetidos} repetidos`);
