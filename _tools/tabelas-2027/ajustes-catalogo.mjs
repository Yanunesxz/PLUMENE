/**
 * Acerta o catálogo depois da carga das tabelas de 2027:
 *
 *   • cadastra os 9 produtos que só existem nos PDFs de 2027 (1035–1043),
 *     com tamanhos (estoque 0) e preço nas 3 tabelas;
 *   • desativa os 6 produtos ativos que ficaram fora dos PDFs.
 *
 * Os produtos novos entram com erp_id = sku e erp_sku "{sku}|{tamanho}", que são
 * as chaves de conflito do sync do ERP (company_id,sku e company_id,erp_sku) —
 * quando o sync rodar na fábrica ele COMPLETA estes registros (estoque, coleção,
 * marca, grupo) em vez de duplicar. Foto e cor não vêm do ERP: são do catálogo.
 *
 * Uso:  node ajustes-catalogo.mjs [--aplicar]
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..', '..');
const APLICAR = process.argv.includes('--aplicar');
const COMPANY_ID = '4a9fccd7-6241-4b8e-9c0b-b18aca364fba';

const DESATIVAR = ['0119', '0121', '0219', '0108', '0118', '2014'];

// Faixa impressa no PDF → tamanhos individuais, no código que o ERP usa
// (infantil/juvenil com dois dígitos: 02, 04, 06, 08).
const TAMANHOS = {
  'PP AO GG': ['PP', 'P', 'M', 'G', 'GG'],
  'P AO GG': ['P', 'M', 'G', 'GG'],
  EG: ['EG'],
  XG: ['XG'],
  '2-4-6-8': ['02', '04', '06', '08'],
  '2-4-6-8 anos': ['02', '04', '06', '08'],
  '1-2-4-6-8 anos': ['01', '02', '04', '06', '08'],
  '10-12-14-16': ['10', '12', '14', '16'],
  '10-12-14-16 anos': ['10', '12', '14', '16'],
  '48-50-52-54': ['48', '50', '52', '54'],
};

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

// ─── Faixas de tamanho de cada SKU, direto do PDF ────────────────────────────
const faixasPorSku = new Map(); // sku → Set(faixa)
{
  const linhas = JSON.parse(readFileSync(join(AQUI, 'linhas-2027.json'), 'utf8'));
  for (const l of linhas) {
    if (!faixasPorSku.has(l.sku)) faixasPorSku.set(l.sku, new Set());
    faixasPorSku.get(l.sku).add(l.tamanho);
  }
}

const precos2027 = JSON.parse(readFileSync(join(AQUI, 'tabelas-2027.json'), 'utf8'));

const { data: tabelas, error: e1 } = await db
  .from('price_tables')
  .select('id, name')
  .eq('company_id', COMPANY_ID)
  .like('name', '%2027');
if (e1) morra('lendo as tabelas de 2027', e1);
if (tabelas.length !== 3) morra(`esperava 3 tabelas de 2027, achei ${tabelas.length}`);
const idPorChave = new Map(tabelas.map((t) => [t.name.match(/TABELA (\d\d)/)[1], t.id]));

const { data: existentes, error: e2 } = await db
  .from('products')
  .select('id, sku, active')
  .eq('company_id', COMPANY_ID);
if (e2) morra('lendo products', e2);
const skusExistentes = new Set(existentes.map((p) => p.sku));

const novos = Object.keys(precos2027['01']).filter((s) => !skusExistentes.has(s));

console.log('produtos a cadastrar:');
for (const sku of novos) {
  const faixas = [...(faixasPorSku.get(sku) ?? [])];
  const tamanhos = faixas.flatMap((f) => TAMANHOS[f] ?? morra(`faixa desconhecida: "${f}" (SKU ${sku})`));
  console.log(
    `  ${sku}  ${precos2027['01'][sku].nome}\n` +
      `        tamanhos: ${tamanhos.join(', ')}\n` +
      `        preços:   ${['01', '02', '03'].map((c) => precos2027[c][sku].preco.toFixed(2)).join(' / ')}`,
  );
}
const aDesativar = existentes.filter((p) => DESATIVAR.includes(p.sku) && p.active);
console.log(`\nprodutos a desativar: ${aDesativar.map((p) => p.sku).join(', ')}`);

if (!APLICAR) {
  console.log('\n(simulação — rode com --aplicar para gravar)');
  process.exit(0);
}

// ─── 1. Produtos ─────────────────────────────────────────────────────────────
const { data: criados, error: e3 } = await db
  .from('products')
  .insert(
    novos.map((sku) => ({
      company_id: COMPANY_ID,
      erp_id: sku,
      sku,
      name: precos2027['01'][sku].nome.toUpperCase(),
      active: true,
    })),
  )
  .select('id, sku');
if (e3) morra('cadastrando os produtos novos', e3);
console.log(`\nprodutos cadastrados .. ${criados.length}`);

// ─── 2. Variantes (estoque 0 até o sync do ERP rodar) ────────────────────────
const variantes = [];
for (const p of criados) {
  for (const faixa of faixasPorSku.get(p.sku) ?? []) {
    for (const tamanho of TAMANHOS[faixa]) {
      variantes.push({
        product_id: p.id,
        company_id: COMPANY_ID,
        erp_sku: `${p.sku}|${tamanho}`,
        size: tamanho,
        stock_quantity: 0,
        stock_committed: 0,
        active: true,
      });
    }
  }
}
const { error: e4 } = await db.from('product_variants').insert(variantes);
if (e4) morra('cadastrando as variantes', e4);
console.log(`tamanhos criados ...... ${variantes.length}`);

// ─── 3. Preços nas 3 tabelas ─────────────────────────────────────────────────
const precos = [];
for (const p of criados) {
  for (const [chave, price_table_id] of idPorChave) {
    precos.push({ product_id: p.id, price_table_id, price: precos2027[chave][p.sku].preco });
  }
}
const { error: e5 } = await db.from('product_prices').insert(precos);
if (e5) morra('gravando os preços dos produtos novos', e5);
console.log(`preços gravados ....... ${precos.length}`);

// ─── 4. Desativa os que ficaram fora dos PDFs ────────────────────────────────
if (aDesativar.length) {
  const { error: e6 } = await db
    .from('products')
    .update({ active: false, updated_at: new Date().toISOString() })
    .in('id', aDesativar.map((p) => p.id));
  if (e6) morra('desativando os produtos fora do PDF', e6);
}
console.log(`desativados ........... ${aDesativar.length}`);
console.log('pronto.');
