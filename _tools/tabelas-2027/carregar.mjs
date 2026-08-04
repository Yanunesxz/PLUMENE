/**
 * Substitui as tabelas de preço da Corpo Sensual pelas 3 tabelas de 2027
 * extraídas dos PDFs oficiais (rodar `python extrair.py` antes).
 *
 * O que faz, nesta ordem:
 *   1. backup em backups/ de price_tables + product_prices da empresa
 *   2. cria TABELA 01/02/03 - 2027 (commercial_tier 1/2/3)
 *   3. grava um preço por produto por tabela (faixa normal do PDF)
 *   4. repõe o vínculo de reps e clientes: 2026 → equivalente de 2027
 *   5. apaga as tabelas antigas (product_prices vai junto por CASCADE)
 *
 * Só mexe na company da Corpo Sensual — a tabela da outra fábrica fica intacta.
 *
 * Uso:  node carregar.mjs [--aplicar]
 * Sem --aplicar só mostra o que faria.
 */
import { readFileSync, writeFileSync } from 'node:fs';
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

const NOVAS = [
  { chave: '01', name: 'TABELA 01 - 2027', commercial_tier: 1 },
  { chave: '02', name: 'TABELA 02 - 2027', commercial_tier: 2 },
  { chave: '03', name: 'TABELA 03 - 2027', commercial_tier: 3 },
];

// Para quem já usava uma tabela de 2026, qual das novas assume o lugar.
// As três variantes da 02 (normal, atualizado, 50%) caem na 02 de 2027;
// INDUSTRIALIZAÇÃO e PLUMENE não têm equivalente e ficam sem tabela.
const EQUIVALENTE = {
  '00014': '01', // TABELA 01 - 2026
  '00015': '02', // TABELA 02 - 2026
  '00022': '02', // TABELA 02 - 2026 - ATUALIZADO
  '00025': '02', // TABELA 02 50% - 2026
  '00016': '03', // TABELA 3 - 2026 (MARISTELA)
};

const morra = (msg, erro) => {
  console.error(`✖ ${msg}${erro ? `: ${erro.message}` : ''}`);
  process.exit(1);
};

// ─── 1. Leitura do estado atual ──────────────────────────────────────────────
const precos2027 = JSON.parse(readFileSync(join(AQUI, 'tabelas-2027.json'), 'utf8'));

const { data: antigas, error: e1 } = await db
  .from('price_tables')
  .select('id, name, erp_code')
  .eq('company_id', COMPANY_ID);
if (e1) morra('lendo price_tables', e1);

const { data: produtos, error: e2 } = await db
  .from('products')
  .select('id, sku, name, active')
  .eq('company_id', COMPANY_ID);
if (e2) morra('lendo products', e2);

const porSku = new Map(produtos.map((p) => [p.sku, p]));
const skusPdf = Object.keys(precos2027['01']);
const semProduto = skusPdf.filter((s) => !porSku.has(s));
const semPreco = produtos.filter((p) => p.active && !precos2027['01'][p.sku]);

console.log(`empresa .............. Corpo Sensual (${COMPANY_ID})`);
console.log(`tabelas a excluir .... ${antigas.length}: ${antigas.map((t) => t.name).join(' · ')}`);
console.log(`SKUs nos PDFs ........ ${skusPdf.length}`);
console.log(`produtos com preço ... ${skusPdf.length - semProduto.length}`);
console.log(`SKUs sem produto ..... ${semProduto.length}${semProduto.length ? `: ${semProduto.join(', ')}` : ''}`);
console.log(
  `ativos sem preço ..... ${semPreco.length}${semPreco.length ? `: ${semPreco.map((p) => p.sku).join(', ')}` : ''}`,
);

if (!APLICAR) {
  console.log('\n(simulação — rode com --aplicar para gravar)');
  process.exit(0);
}

// ─── 2. Backup ───────────────────────────────────────────────────────────────
// Paginado: o PostgREST devolve no máximo 1.000 linhas por requisição e são
// milhares de preços — sem isso o backup sai truncado e o rollback é ilusório.
const precosAntigos = [];
for (let de = 0; ; de += 1000) {
  const { data, error } = await db
    .from('product_prices')
    .select('*')
    .in('price_table_id', antigas.map((t) => t.id))
    .range(de, de + 999);
  if (error) morra('lendo product_prices', error);
  precosAntigos.push(...data);
  if (data.length < 1000) break;
}

const { data: usuarios } = await db
  .from('users')
  .select('id, name, price_table_id')
  .eq('company_id', COMPANY_ID);
const { data: repTabelas } = await db.from('rep_price_tables').select('*').eq('company_id', COMPANY_ID);
const { data: clientes } = await db
  .from('customers')
  .select('id, price_table_id')
  .eq('company_id', COMPANY_ID)
  .not('price_table_id', 'is', null);

const arquivo = join(RAIZ, 'backups', `price-tables-${new Date().toISOString().slice(0, 10)}.json`);
writeFileSync(
  arquivo,
  JSON.stringify({ antigas, precosAntigos, usuarios, repTabelas, clientes }, null, 1),
  'utf8',
);
console.log(`\nbackup .............. ${arquivo} (${precosAntigos.length} preços)`);

// ─── 3. Cria as 3 tabelas de 2027 ────────────────────────────────────────────
// Sem erp_code: elas vêm do PDF, não do ERP — o sync não deve sobrescrevê-las.
const { data: criadas, error: e4 } = await db
  .from('price_tables')
  .insert(
    NOVAS.map((t) => ({
      company_id: COMPANY_ID,
      name: t.name,
      price_column: 1,
      commercial_tier: t.commercial_tier,
    })),
  )
  .select('id, name');
if (e4) morra('criando as tabelas de 2027', e4);

const idPorChave = new Map(NOVAS.map((t) => [t.chave, criadas.find((c) => c.name === t.name).id]));
for (const [chave, id] of idPorChave) console.log(`criada .............. ${NOVAS.find((n) => n.chave === chave).name}  ${id}`);

// ─── 4. Preços ───────────────────────────────────────────────────────────────
for (const { chave, name } of NOVAS) {
  const linhas = [];
  for (const [sku, reg] of Object.entries(precos2027[chave])) {
    const produto = porSku.get(sku);
    if (produto) {
      linhas.push({ product_id: produto.id, price_table_id: idPorChave.get(chave), price: reg.preco });
    }
  }
  for (let i = 0; i < linhas.length; i += 500) {
    const { error } = await db.from('product_prices').insert(linhas.slice(i, i + 500));
    if (error) morra(`gravando preços de ${name}`, error);
  }
  console.log(`preços .............. ${name}: ${linhas.length}`);
}

// ─── 5. Repõe os vínculos antes de apagar ────────────────────────────────────
const novoIdDe = (idAntigo) => {
  const antiga = antigas.find((t) => t.id === idAntigo);
  const chave = antiga && EQUIVALENTE[antiga.erp_code];
  return chave ? idPorChave.get(chave) : null;
};

for (const u of usuarios ?? []) {
  if (!u.price_table_id) continue;
  const novo = novoIdDe(u.price_table_id);
  if (novo === undefined) continue;
  const { error } = await db.from('users').update({ price_table_id: novo }).eq('id', u.id);
  if (error) morra(`remapeando o usuário ${u.name}`, error);
  console.log(`rep ................. ${u.name} → ${criadas.find((c) => c.id === novo)?.name ?? '(sem tabela)'}`);
}

for (const r of repTabelas ?? []) {
  const novo = novoIdDe(r.price_table_id);
  if (!novo) continue;
  const { error } = await db
    .from('rep_price_tables')
    .insert({ company_id: COMPANY_ID, user_id: r.user_id, price_table_id: novo });
  if (error && error.code !== '23505') morra('remapeando rep_price_tables', error);
}
console.log(`rep_price_tables .... ${repTabelas?.length ?? 0} vínculos repostos`);

const porNova = new Map();
for (const c of clientes ?? []) {
  const novo = novoIdDe(c.price_table_id);
  if (!novo) continue;
  if (!porNova.has(novo)) porNova.set(novo, []);
  porNova.get(novo).push(c.id);
}
for (const [novo, ids] of porNova) {
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await db
      .from('customers')
      .update({ price_table_id: novo })
      .in('id', ids.slice(i, i + 200));
    if (error) morra('remapeando clientes', error);
  }
  console.log(`clientes ............ ${ids.length} → ${criadas.find((c) => c.id === novo).name}`);
}

// ─── 6. Apaga as tabelas de 2026 ─────────────────────────────────────────────
const { error: e5 } = await db
  .from('price_tables')
  .delete()
  .in('id', antigas.map((t) => t.id));
if (e5) morra('apagando as tabelas antigas', e5);
console.log(`\nexcluídas ........... ${antigas.length} tabelas antigas (preços foram junto)`);
console.log('pronto.');
