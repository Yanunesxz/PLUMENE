/**
 * Quais produtos ATIVOS do app não estão na TABELA DE PREÇO vigente?
 * "Tabela sempre a verdade": quem não está nela vende com preço de onde?
 * Uso: node conferir-fora-da-tabela.mjs caminho/tabelas.json
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

const arquivo = process.argv[2];
if (!arquivo) { console.error('Uso: node conferir-fora-da-tabela.mjs tabelas.json'); process.exit(1); }
const pdf = JSON.parse(readFileSync(arquivo, 'utf8'));
const refs = new Set(Object.values(pdf).flat().map((i) => i.ref));
console.log(`Referências na tabela: ${refs.size}`);

const { data } = await db
  .from('products')
  .select('sku, name, active')
  .eq('company_id', EMPRESA)
  .eq('active', true);
const fora = [...new Map((data ?? []).filter((p) => !refs.has(p.sku)).map((p) => [p.sku, p.name]))];
console.log(`Ativos FORA da tabela: ${fora.length}`);
for (const [sku, nome] of fora.sort()) console.log(`  ${sku} ${nome}`);
