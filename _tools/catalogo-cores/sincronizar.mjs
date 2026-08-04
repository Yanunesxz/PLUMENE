/**
 * Sincroniza o app com os catálogos vigentes:
 *
 *   1. produto que NÃO está nos catálogos → active = false (some do catálogo,
 *      e o payload de /products encolhe junto — era o pedido do Yan de "não
 *      pesar no site"). Nada é apagado: o histórico de pedidos continua de pé.
 *   2. produto que está → active = true e recebe as cores daquele catálogo.
 *
 * Uso:
 *   node sincronizar.mjs refs.json cores.json [--aplicar]
 *
 * Sem --aplicar só mostra o que faria.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { montarCores } from './cores.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..', '..');
const APLICAR = process.argv.includes('--aplicar');
const [arqRefs, arqCores] = process.argv.slice(2).filter((a) => !a.startsWith('--'));

if (!arqRefs || !arqCores) {
  console.error('uso: node sincronizar.mjs refs.json cores.json [--aplicar]');
  process.exit(1);
}

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

const refs = JSON.parse(readFileSync(resolve(arqRefs), 'utf8'));
const cores = JSON.parse(readFileSync(resolve(arqCores), 'utf8'));
const noCatalogo = new Set(Object.keys(refs));

// Lê TODOS os produtos, ativos ou não: um que foi escondido numa rodada anterior
// precisa voltar se entrar no catálogo novo.
let produtos = [];
for (let de = 0; ; de += 1000) {
  const { data, error } = await db
    .from('products')
    .select('id, sku, company_id, active')
    .order('id')
    .range(de, de + 999);
  if (error) {
    console.error('erro lendo produtos:', error.message);
    process.exit(1);
  }
  produtos = produtos.concat(data);
  if (data.length < 1000) break;
}

const manter = produtos.filter((p) => noCatalogo.has(p.sku));
const esconder = produtos.filter((p) => !noCatalogo.has(p.sku));
const semProduto = [...noCatalogo].filter((sku) => !produtos.some((p) => p.sku === sku));

console.log(`produtos no banco: ${produtos.length}`);
console.log(`referencias nos catalogos: ${noCatalogo.size}`);
console.log(`  ficam VISIVEIS: ${manter.length}  (hoje ativos: ${manter.filter((p) => p.active).length})`);
console.log(`  ficam ESCONDIDOS: ${esconder.length}  (hoje ativos: ${esconder.filter((p) => p.active).length})`);
console.log(`  no catalogo mas sem produto cadastrado: ${semProduto.length}`);

const linhasCor = [];
for (const p of manter) {
  const doCatalogo = cores[p.sku];
  if (!doCatalogo) continue;
  for (const c of montarCores(doCatalogo.cores)) {
    linhasCor.push({ company_id: p.company_id, product_id: p.id, ...c });
  }
}
const comCor = new Set(linhasCor.map((l) => l.product_id));
console.log(`\ncores a gravar: ${linhasCor.length} em ${comCor.size} produtos`);
console.log(`visiveis SEM cor: ${manter.length - comCor.size}`);

if (!APLICAR) {
  console.log('\n(simulação — rode com --aplicar para gravar)');
  process.exit(0);
}

// 1. esconde o que saiu de catálogo
const idsEsconder = esconder.filter((p) => p.active).map((p) => p.id);
for (let i = 0; i < idsEsconder.length; i += 200) {
  const { error } = await db
    .from('products')
    .update({ active: false })
    .in('id', idsEsconder.slice(i, i + 200));
  if (error) {
    console.error('erro escondendo:', error.message);
    process.exit(1);
  }
}

// 2. reativa o que voltou ao catálogo
const idsMostrar = manter.filter((p) => !p.active).map((p) => p.id);
for (let i = 0; i < idsMostrar.length; i += 200) {
  const { error } = await db
    .from('products')
    .update({ active: true })
    .in('id', idsMostrar.slice(i, i + 200));
  if (error) {
    console.error('erro reativando:', error.message);
    process.exit(1);
  }
}

// 3. troca as cores: apaga as antigas dos produtos visíveis e grava as novas.
// Sem o delete, uma cor que saiu do catálogo novo ficaria para sempre.
const idsManter = manter.map((p) => p.id);
for (let i = 0; i < idsManter.length; i += 200) {
  await db.from('product_colors').delete().in('product_id', idsManter.slice(i, i + 200));
}
for (let i = 0; i < linhasCor.length; i += 300) {
  const { error } = await db.from('product_colors').insert(linhasCor.slice(i, i + 300));
  if (error) {
    console.error('erro gravando cores:', error.message);
    process.exit(1);
  }
}

const { count: ativos } = await db
  .from('products')
  .select('id', { count: 'exact', head: true })
  .eq('active', true);
const { count: nCores } = await db.from('product_colors').select('id', { count: 'exact', head: true });
console.log(`\naplicado. produtos ativos: ${ativos}   linhas de cor: ${nCores}`);
