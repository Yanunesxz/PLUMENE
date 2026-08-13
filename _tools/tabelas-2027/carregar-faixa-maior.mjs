/**
 * Preenche `product_prices.price_larger` com o preço da FAIXA MAIOR das tabelas
 * oficiais (EG / XG / 48-54) — a segunda linha de cada referência no PDF.
 *
 * O `preco_maior` já era extraído pelo `extrair.py` desde sempre; o que faltava
 * era onde guardá-lo. A migração 026 abriu a coluna, este script a preenche.
 *
 * PRÉ-REQUISITO: rodar antes a migração 026 no SQL Editor do Supabase. Sem a
 * coluna, este script recusa em vez de gravar pela metade.
 *
 * O que faz:
 *   1. confere que a coluna existe
 *   2. backup em backups/ do estado atual de product_prices
 *   3. grava price_larger por (produto × tabela), lendo tabelas-2027.json
 *   4. confere o resultado e mostra as divergências
 *
 * Só toca na company da Corpo Sensual. NÃO altera nenhum preço normal.
 *
 * Uso:  node carregar-faixa-maior.mjs [--aplicar]
 * Sem --aplicar só mostra o que faria.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..', '..');
const APLICAR = process.argv.includes('--aplicar');
const COMPANY_ID = '4a9fccd7-6241-4b8e-9c0b-b18aca364fba'; // Corpo Sensual

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

// Qual chave do JSON corresponde a qual tabela do banco.
const CHAVE_DA_TABELA = {
  'TABELA 01 - 2027': '01',
  'TABELA 02 - 2027': '02',
  'TABELA 03 - 2027': '03',
};

// ─── 1. A coluna existe? ─────────────────────────────────────────────────────
const { error: semColuna } = await db.from('product_prices').select('price_larger').limit(1);
if (semColuna) {
  morra(
    'a coluna price_larger não existe — rode antes a migração 026 ' +
      '(apps/api/src/config/migrations/026_preco_da_faixa_maior.sql) no SQL Editor do Supabase',
    semColuna,
  );
}

// ─── 2. Leitura ──────────────────────────────────────────────────────────────
const precos2027 = JSON.parse(readFileSync(join(AQUI, 'tabelas-2027.json'), 'utf8'));

const { data: tabelas, error: e1 } = await db
  .from('price_tables')
  .select('id, name')
  .eq('company_id', COMPANY_ID);
if (e1) morra('lendo price_tables', e1);

const { data: produtos, error: e2 } = await db
  .from('products')
  .select('id, sku, active')
  .eq('company_id', COMPANY_ID);
if (e2) morra('lendo products', e2);

const skuDoProduto = new Map(produtos.map((p) => [p.id, p.sku]));

const precos = [];
for (let de = 0; ; de += 1000) {
  const { data, error } = await db
    .from('product_prices')
    .select('id, product_id, price_table_id, price, price_larger')
    .in('price_table_id', tabelas.map((t) => t.id))
    .range(de, de + 999);
  if (error) morra('lendo product_prices', error);
  precos.push(...data);
  if (data.length < 1000) break;
}

console.log(`empresa ............. Corpo Sensual`);
console.log(`tabelas ............. ${tabelas.map((t) => t.name).join(' · ')}`);
console.log(`linhas de preço ..... ${precos.length}`);

// ─── 3. O que gravar ─────────────────────────────────────────────────────────
const aGravar = [];
const semCorrespondencia = [];

for (const linha of precos) {
  const tabela = tabelas.find((t) => t.id === linha.price_table_id);
  const chave = CHAVE_DA_TABELA[tabela?.name];
  const sku = skuDoProduto.get(linha.product_id);
  if (!chave || !sku) {
    semCorrespondencia.push(`${sku ?? linha.product_id} em ${tabela?.name ?? '(tabela desconhecida)'}`);
    continue;
  }

  const doPdf = precos2027[chave]?.[sku];
  if (!doPdf) {
    semCorrespondencia.push(`${sku} não está no PDF da ${tabela.name}`);
    continue;
  }

  // Referência de preço único (infantil/juvenil): price_larger fica NULL mesmo.
  if (doPdf.preco_maior == null) continue;
  // Já está certo — não gasta requisição à toa.
  if (Number(linha.price_larger) === doPdf.preco_maior) continue;

  aGravar.push({ id: linha.id, sku, tabela: tabela.name, price_larger: doPdf.preco_maior });
}

const porTabela = {};
for (const g of aGravar) porTabela[g.tabela] = (porTabela[g.tabela] ?? 0) + 1;

console.log(`\na gravar ............ ${aGravar.length} linhas`);
for (const [nome, n] of Object.entries(porTabela).sort()) console.log(`   ${nome}: ${n}`);
if (semCorrespondencia.length) {
  console.log(`sem correspondência . ${semCorrespondencia.length}`);
  for (const s of semCorrespondencia.slice(0, 10)) console.log(`   ${s}`);
  if (semCorrespondencia.length > 10) console.log(`   … e mais ${semCorrespondencia.length - 10}`);
}

// Amostra para conferir a olho antes de aplicar.
console.log('\namostra:');
for (const g of aGravar.slice(0, 8)) {
  const atual = precos.find((p) => p.id === g.id);
  console.log(`   ${g.sku}  ${g.tabela}  normal R$ ${atual.price}  →  faixa maior R$ ${g.price_larger}`);
}

if (!APLICAR) {
  console.log('\n(simulação — rode com --aplicar para gravar)');
  process.exit(0);
}

// ─── 4. Backup ───────────────────────────────────────────────────────────────
mkdirSync(join(RAIZ, 'backups'), { recursive: true });
const arquivo = join(
  RAIZ,
  'backups',
  `faixa-maior-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`,
);
writeFileSync(arquivo, JSON.stringify({ tabelas, precos }, null, 1), 'utf8');
console.log(`\nbackup .............. ${arquivo} (${precos.length} linhas)`);

// ─── 5. Gravação ─────────────────────────────────────────────────────────────
// Uma a uma: são ~400 linhas com valores diferentes, e um upsert em lote
// exigiria mandar as outras colunas junto — inclusive `price`, que não deve
// mudar. Preferir o caminho que não tem como estragar o preço normal.
let gravadas = 0;
for (const g of aGravar) {
  const { error } = await db
    .from('product_prices')
    .update({ price_larger: g.price_larger })
    .eq('id', g.id);
  if (error) morra(`gravando ${g.sku} em ${g.tabela}`, error);
  gravadas += 1;
  if (gravadas % 100 === 0) console.log(`   ${gravadas}/${aGravar.length}…`);
}
console.log(`gravadas ............ ${gravadas}`);

// ─── 6. Conferência ──────────────────────────────────────────────────────────
const conferencia = [];
for (let de = 0; ; de += 1000) {
  const { data, error } = await db
    .from('product_prices')
    .select('product_id, price_table_id, price, price_larger')
    .in('price_table_id', tabelas.map((t) => t.id))
    .range(de, de + 999);
  if (error) morra('conferindo', error);
  conferencia.push(...data);
  if (data.length < 1000) break;
}

console.log('\nresultado por tabela:');
for (const t of tabelas.sort((a, b) => a.name.localeCompare(b.name))) {
  const linhas = conferencia.filter((c) => c.price_table_id === t.id);
  const comMaior = linhas.filter((c) => c.price_larger != null);
  const invertido = comMaior.filter((c) => Number(c.price_larger) < Number(c.price));
  console.log(`   ${t.name}: ${linhas.length} refs · ${comMaior.length} com faixa maior`);
  // Faixa maior mais barata que a normal seria erro de carga, não desconto.
  if (invertido.length) console.log(`      ⚠ ${invertido.length} com faixa maior MENOR que a normal`);
}
console.log('\npronto.');
