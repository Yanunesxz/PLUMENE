/**
 * Cobertura: todo produto ATIVO tem preço nas TRÊS tabelas? Lista quem não tem.
 * "Coloca todos nessa tabela" (Yan, 02/09/2026) — esta é a prova de que
 * ninguém ficou de fora, ou a lista exata de quem ficou (e por quê).
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

const { data: tabelas } = await db.from('price_tables').select('id, name').eq('company_id', EMPRESA).order('name');
const produtos = [];
for (let de = 0; ; de += 1000) {
  const { data } = await db.from('products').select('id, sku, name, active').eq('company_id', EMPRESA).range(de, de + 999);
  produtos.push(...(data ?? []));
  if (!data || data.length < 1000) break;
}
const precos = new Set();
for (let de = 0; ; de += 1000) {
  const { data } = await db.from('product_prices').select('product_id, price_table_id').range(de, de + 999);
  for (const p of data ?? []) precos.add(`${p.product_id}|${p.price_table_id}`);
  if (!data || data.length < 1000) break;
}

const ativos = produtos.filter((p) => p.active);
const inativos = produtos.filter((p) => !p.active);
console.log(`Produtos: ${produtos.length} (${ativos.length} ativos, ${inativos.length} inativos) · tabelas: ${tabelas.map((t) => t.name).join(' / ')}`);

const faltando = [];
for (const p of ativos) {
  const sem = tabelas.filter((t) => !precos.has(`${p.id}|${t.id}`)).map((t) => t.name);
  if (sem.length) faltando.push({ sku: p.sku, name: p.name, sem });
}
const refsAtivas = new Set(ativos.map((p) => p.sku));
console.log(`Referências ativas distintas: ${refsAtivas.size}`);
console.log(`Ativos SEM preço em alguma tabela: ${faltando.length}`);
for (const f of faltando.slice(0, 40)) console.log(`  ${f.sku} ${f.name} → falta em ${f.sem.join(', ')}`);
if (faltando.length > 40) console.log(`  … e mais ${faltando.length - 40}`);
