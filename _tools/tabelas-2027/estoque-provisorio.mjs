/**
 * Estoque provisório de 100 peças por tamanho nos produtos novos (1035–1043),
 * para eles ficarem vendáveis antes do sync do ERP rodar na fábrica.
 *
 * Só mexe em produto ATIVO cujos tamanhos estão TODOS zerados — hoje, só os 9
 * novos. Tamanho esgotado de produto que já tem estoque do ERP fica como está:
 * ali o zero é informação verdadeira, não falta de carga.
 *
 * ⚠ É número inventado. O primeiro sync do ERP sobrescreve com o real.
 *
 * Uso:  node estoque-provisorio.mjs [--aplicar]
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..', '..');
const APLICAR = process.argv.includes('--aplicar');
const COMPANY_ID = '4a9fccd7-6241-4b8e-9c0b-b18aca364fba';
const QUANTIDADE = 100;

const { createClient } = await import(
  pathToFileURL(join(RAIZ, 'apps/api/node_modules/@supabase/supabase-js/dist/index.mjs')).href
);
const env = {};
for (const linha of readFileSync(join(RAIZ, 'apps/api/.env'), 'utf8').split(/\r?\n/)) {
  const m = linha.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const morra = (msg, erro) => {
  console.error(`✖ ${msg}${erro ? `: ${erro.message}` : ''}`);
  process.exit(1);
};

const { data: produtos, error: e1 } = await db
  .from('products')
  .select('id, sku, name')
  .eq('company_id', COMPANY_ID)
  .eq('active', true);
if (e1) morra('lendo products', e1);
const porId = new Map(produtos.map((p) => [p.id, p]));

const variantes = [];
for (let de = 0; ; de += 1000) {
  const { data, error } = await db
    .from('product_variants')
    .select('id, product_id, size, stock_quantity, stock_committed')
    .eq('company_id', COMPANY_ID)
    .range(de, de + 999);
  if (error) morra('lendo product_variants', error);
  variantes.push(...data.filter((v) => porId.has(v.product_id)));
  if (data.length < 1000) break;
}

const disponivel = (v) => Math.max(0, v.stock_quantity - v.stock_committed);

const porProduto = new Map();
for (const v of variantes) {
  if (!porProduto.has(v.product_id)) porProduto.set(v.product_id, []);
  porProduto.get(v.product_id).push(v);
}

const alvo = [];
for (const [product_id, vs] of porProduto) {
  if (vs.every((v) => disponivel(v) === 0)) alvo.push(...vs);
}

console.log(`variantes a receber ${QUANTIDADE} peças: ${alvo.length}`);
for (const [product_id, vs] of porProduto) {
  if (!vs.every((v) => disponivel(v) === 0)) continue;
  const p = porId.get(product_id);
  console.log(`  ${p.sku}  ${p.name}  (${vs.map((v) => v.size).join(', ')})`);
}
const outrasZeradas = variantes.filter(
  (v) => disponivel(v) === 0 && !alvo.some((a) => a.id === v.id),
).length;
console.log(`\ntamanhos zerados que NÃO serão tocados (esgotados de verdade): ${outrasZeradas}`);

if (!APLICAR) {
  console.log('\n(simulação — rode com --aplicar para gravar)');
  process.exit(0);
}

for (let i = 0; i < alvo.length; i += 200) {
  const { error } = await db
    .from('product_variants')
    .update({ stock_quantity: QUANTIDADE, stock_committed: 0, updated_at: new Date().toISOString() })
    .in(
      'id',
      alvo.slice(i, i + 200).map((v) => v.id),
    );
  if (error) morra('gravando o estoque provisório', error);
}
console.log(`\nestoque gravado ....... ${alvo.length} tamanhos × ${QUANTIDADE} peças`);
console.log('pronto.');
