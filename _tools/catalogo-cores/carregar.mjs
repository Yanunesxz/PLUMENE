/**
 * Carrega no banco as cores extraídas do catálogo (cores-extraidas.json).
 *
 * Regras do Yan:
 *   • produto com UMA cor  -> "Cor única"
 *   • bolinha rotulada VARIADAS -> "Variadas" (nunca "sortidas")
 *   • produto cuja única bolinha é VARIADAS -> "Cores variadas"
 *   • sem rótulo no catálogo -> não inventa Variadas
 *
 * Uso:  node carregar.mjs [--aplicar]
 * Sem --aplicar ele só mostra o que faria.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { montarCores } from './cores.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..', '..');
const APLICAR = process.argv.includes('--aplicar');

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

// ─── Carga ───────────────────────────────────────────────────────────────────
const extraido = JSON.parse(readFileSync(join(AQUI, 'cores-extraidas.json'), 'utf8'));

const { data: produtos, error: erroProd } = await db
  .from('products')
  .select('id, sku, company_id')
  .eq('active', true);
if (erroProd) {
  console.error('erro lendo produtos:', erroProd.message);
  process.exit(1);
}

const linhas = [];
let semCatalogo = 0;
for (const p of produtos) {
  const doCatalogo = extraido[p.sku];
  if (!doCatalogo) {
    semCatalogo++;
    continue;
  }
  for (const c of montarCores(doCatalogo.cores)) {
    linhas.push({ company_id: p.company_id, product_id: p.id, ...c });
  }
}

const porProduto = new Set(linhas.map((l) => l.product_id));
console.log(`produtos ativos: ${produtos.length}`);
console.log(`com cores no catálogo: ${porProduto.size}  (sem: ${semCatalogo})`);
console.log(`linhas de cor a gravar: ${linhas.length}`);

const amostra = linhas.slice(0, 8).map((l) => `${l.codigo} ${l.nome} ${l.hex ?? ''}`);
console.log('amostra:', amostra.join(' | '));

if (!APLICAR) {
  console.log('\n(simulação — rode com --aplicar para gravar)');
  process.exit(0);
}

// Apagar antes de gravar, e não só dar upsert: a numeração mudou (a bolinha
// VARIADAS virou "VAR" onde o catálogo não a numera) e produtos perderam cor.
// Um upsert deixaria as linhas velhas para trás, e o lojista veria bolinha a
// mais.
const { error: erroApagar } = await db
  .from('product_colors')
  .delete()
  .in('product_id', [...porProduto]);
if (erroApagar) {
  console.error('\nERRO ao limpar as cores antigas:', erroApagar.message);
  process.exit(1);
}

// A 020 (hex_par, estampa) pode não ter rodado ainda. Se faltar, grava o que
// dá: a correção das cores é o que importa, o par entra quando a coluna existir.
let { error } = await db.from('product_colors').upsert(linhas, { onConflict: 'product_id,codigo' });
if (error && /hex_par|estampa/.test(error.message)) {
  console.warn('aviso: migração 020 não aplicada — gravando sem hex_par/estampa.');
  const semPar = linhas.map(({ hex_par, estampa, ...resto }) => resto);
  ({ error } = await db
    .from('product_colors')
    .upsert(semPar, { onConflict: 'product_id,codigo' }));
}

if (error) {
  console.error('\nERRO ao gravar:', error.message);
  if (/does not exist|schema cache|Could not find/i.test(error.message)) {
    console.error('-> a migração 019 ainda não foi aplicada no Supabase.');
  }
  process.exit(1);
}

const { count } = await db.from('product_colors').select('id', { count: 'exact', head: true });
console.log(`\ngravado. product_colors tem ${count} linha(s).`);
