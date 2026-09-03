/** Conferência pontual: o 0161 nas três tabelas + o estado do 0113 e 0395. */
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
const EMPRESA = '4a9fccd7-6241-4b8e-9c0b-b18aca364fba';

const { data: tabelas } = await db.from('price_tables').select('id, name').eq('company_id', EMPRESA);
const nomeTab = new Map((tabelas ?? []).map((t) => [t.id, t.name]));

// Os SKUs vêm da linha de comando; sem nada, os de sempre.
const skus = process.argv.slice(2).length ? process.argv.slice(2) : ['0161', '0113', '0395'];
for (const sku of skus) {
  const { data: prods } = await db
    .from('products')
    .select('id, sku, name, active')
    .eq('company_id', EMPRESA)
    .eq('sku', sku);
  for (const p of prods ?? []) {
    console.log(`\n${p.sku} · ${p.name} · ${p.active ? 'ATIVO' : 'inativo'}`);
    const { data: precos } = await db
      .from('product_prices')
      .select('price_table_id, price, price_larger')
      .eq('product_id', p.id);
    if (!precos?.length) {
      console.log('   ⚠ sem preço em NENHUMA tabela — não vende');
      continue;
    }
    for (const pr of precos.sort((a, b) => (nomeTab.get(a.price_table_id) ?? '').localeCompare(nomeTab.get(b.price_table_id) ?? ''))) {
      console.log(
        `   ${nomeTab.get(pr.price_table_id)}: normal R$ ${Number(pr.price).toFixed(2)} | maior ${pr.price_larger == null ? '—' : 'R$ ' + Number(pr.price_larger).toFixed(2)}`,
      );
    }
  }
}
