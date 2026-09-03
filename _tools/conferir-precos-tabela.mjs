/**
 * Confere (e corrige) os preços do banco contra as TABELAS DE PREÇO em PDF.
 *
 * Entrada: `tabelas.json` — {"1": [{ref, desc, faixa, preco}], "2": …, "3": …},
 * gerado do PDF oficial. Cada referência aparece em DUAS linhas: a faixa normal
 * (PP AO GG, P AO GG, 2-4-6-8…) e a FAIXA MAIOR (EG ou 48-50-52-54), que custa
 * mais — a mesma régua de `packages/shared/src/pricing/faixaDeTamanho.ts`.
 *
 * Nunca casa tabela por pedaço do nome: "TABELA 01 - 2027" contém "02" dentro
 * do ano e já trocou preços de tabela uma vez. O casamento é pelo NÚMERO
 * isolado no começo do nome.
 *
 * Uso: node conferir-precos-tabela.mjs caminho/tabelas.json [--aplicar]
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
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
const APLICAR = process.argv.includes('--aplicar');
if (!arquivo) {
  console.error('Uso: node conferir-precos-tabela.mjs tabelas.json [--aplicar]');
  process.exit(1);
}
const doPdf = JSON.parse(readFileSync(arquivo, 'utf8'));

/** A faixa MAIOR do PDF: EG (e irmãos) ou a grade 48-54. */
const ehFaixaMaior = (faixa) => /^(EG|EGG|EGGG|XG\d?)$/i.test(faixa.trim()) || /48/.test(faixa);

const brl = (v) => (v == null ? '—' : `R$ ${Number(v).toFixed(2).replace('.', ',')}`);

// ─── As tabelas do banco ─────────────────────────────────────────────────────
const { data: tabelas } = await db
  .from('price_tables')
  .select('id, name')
  .eq('company_id', EMPRESA)
  .order('name');
console.log('Tabelas no banco:');
for (const t of tabelas ?? []) console.log(`  ${t.name}`);

/** Número da tabela pelo nome: "TABELA 03 - 2027" → 3. O ano fica de fora. */
function numeroDaTabela(nome) {
  const m = /TABELA\s*0?(\d)/i.exec(nome);
  return m ? Number(m[1]) : null;
}
const tabelaPorNumero = new Map();
for (const t of tabelas ?? []) {
  const n = numeroDaTabela(t.name);
  if (n && !tabelaPorNumero.has(n)) tabelaPorNumero.set(n, t);
}
console.log('\nCasamento PDF → tabela:');
for (const n of [1, 2, 3]) {
  console.log(`  PDF ${n} → ${tabelaPorNumero.get(n)?.name ?? '❌ NENHUMA'}`);
}
if ([1, 2, 3].some((n) => !tabelaPorNumero.has(n))) {
  console.error('\n❌ Falta tabela no banco. Nada foi feito.');
  process.exit(1);
}

// ─── Produtos (sku → id) ─────────────────────────────────────────────────────
const produtos = [];
for (let de = 0; ; de += 1000) {
  const { data } = await db
    .from('products')
    .select('id, sku, name, active')
    .eq('company_id', EMPRESA)
    .range(de, de + 999);
  produtos.push(...(data ?? []));
  if (!data || data.length < 1000) break;
}
// Uma referência pode ter VÁRIAS cores (produtos distintos com o mesmo SKU
// base). O preço é da referência, então todos recebem o mesmo valor.
const porSku = new Map();
for (const p of produtos) {
  const base = String(p.sku ?? '').trim().toUpperCase();
  if (!base) continue;
  porSku.set(base, [...(porSku.get(base) ?? []), p]);
}

// ─── Preços do banco ─────────────────────────────────────────────────────────
const precos = [];
for (let de = 0; ; de += 1000) {
  const { data } = await db
    .from('product_prices')
    .select('id, product_id, price_table_id, price, price_larger')
    .range(de, de + 999);
  precos.push(...(data ?? []));
  if (!data || data.length < 1000) break;
}
const precoDe = new Map(); // `${product_id}|${table_id}` → linha
for (const p of precos) precoDe.set(`${p.product_id}|${p.price_table_id}`, p);

// ─── Comparação ──────────────────────────────────────────────────────────────
const relatorio = { certos: 0, corrigir: [], semProduto: new Set(), semLinha: [], ambiguos: [] };

for (const n of [1, 2, 3]) {
  const tabela = tabelaPorNumero.get(n);
  const linhas = doPdf[String(n)] ?? [];

  // Agrupa por referência: normal × maior.
  const porRef = new Map();
  for (const l of linhas) {
    const alvo = porRef.get(l.ref) ?? { ref: l.ref, desc: l.desc, normais: [], maior: null };
    if (ehFaixaMaior(l.faixa)) alvo.maior = l.preco;
    else alvo.normais.push({ faixa: l.faixa, preco: l.preco });
    porRef.set(l.ref, alvo);
  }

  for (const item of porRef.values()) {
    // Duas faixas normais com preços diferentes (infantil 2-4-6-8 e 10-12-14-16):
    // o app só guarda um preço normal por tabela — anota e usa o MENOR, que é o
    // que a régua entrega hoje para qualquer tamanho fora da faixa maior.
    const valores = [...new Set(item.normais.map((x) => x.preco))];
    if (valores.length > 1) {
      relatorio.ambiguos.push(`T${n} ${item.ref} ${item.desc}: ${item.normais.map((x) => `${x.faixa}=${brl(x.preco)}`).join(' / ')}`);
    }
    const precoNormal = valores.length ? Math.min(...valores) : null;
    if (precoNormal == null) continue;

    const produtosDaRef = porSku.get(item.ref.toUpperCase()) ?? [];
    if (produtosDaRef.length === 0) {
      relatorio.semProduto.add(item.ref);
      continue;
    }

    for (const p of produtosDaRef) {
      const atual = precoDe.get(`${p.id}|${tabela.id}`);
      if (!atual) {
        relatorio.semLinha.push(`T${n} ${item.ref} (${p.name})`);
        continue;
      }
      const mesmoNormal = Number(atual.price) === precoNormal;
      const mesmoMaior =
        item.maior == null
          ? atual.price_larger == null || Number(atual.price_larger) === precoNormal
          : Number(atual.price_larger) === item.maior;
      if (mesmoNormal && mesmoMaior) {
        relatorio.certos++;
        continue;
      }
      relatorio.corrigir.push({
        id: atual.id,
        tabela: n,
        ref: item.ref,
        nome: p.name,
        de: { price: Number(atual.price), larger: atual.price_larger == null ? null : Number(atual.price_larger) },
        para: { price: precoNormal, larger: item.maior },
      });
    }
  }
}

console.log(`\n── Conferência ─────────────────────────────`);
console.log(`Já corretos: ${relatorio.certos}`);
console.log(`A corrigir:  ${relatorio.corrigir.length}`);
console.log(`Sem linha de preço na tabela: ${relatorio.semLinha.length}`);
console.log(`Referências do PDF sem produto no app: ${relatorio.semProduto.size}`);

if (relatorio.ambiguos.length) {
  console.log(`\n⚠ Referências com DUAS faixas normais no PDF (usei o menor preço):`);
  for (const a of relatorio.ambiguos.slice(0, 20)) console.log('   ' + a);
  if (relatorio.ambiguos.length > 20) console.log(`   … e mais ${relatorio.ambiguos.length - 20}`);
}

if (relatorio.corrigir.length) {
  console.log(`\nDiferenças (primeiras 40):`);
  for (const c of relatorio.corrigir.slice(0, 40)) {
    console.log(
      `  T${c.tabela} ${c.ref} ${c.nome.slice(0, 34).padEnd(34)} ` +
        `normal ${brl(c.de.price)} → ${brl(c.para.price)} | maior ${brl(c.de.larger)} → ${brl(c.para.larger)}`,
    );
  }
  if (relatorio.corrigir.length > 40) console.log(`  … e mais ${relatorio.corrigir.length - 40}`);
}
if (relatorio.semLinha.length) {
  console.log(`\nSem linha de preço (o produto não vende nessa tabela):`);
  for (const s of relatorio.semLinha.slice(0, 15)) console.log('   ' + s);
  if (relatorio.semLinha.length > 15) console.log(`   … e mais ${relatorio.semLinha.length - 15}`);
}
if (relatorio.semProduto.size) {
  console.log(`\nNo PDF mas sem produto no app: ${[...relatorio.semProduto].join(', ')}`);
}

// ─── Aplicar ─────────────────────────────────────────────────────────────────
if (!APLICAR) {
  console.log(`\nENSAIO — nada gravado. Rode com --aplicar para corrigir.`);
  process.exit(0);
}

// Antes de escrever: o estado ANTERIOR em disco. São centenas de preços em
// produção; sem isto, "voltar como estava" viraria arqueologia.
const backup = path.join(RAIZ, '_tools', `backup-precos-${new Date().toISOString().slice(0, 10)}.json`);
writeFileSync(backup, JSON.stringify(relatorio.corrigir, null, 1), 'utf8');
console.log(`\nEstado anterior salvo em ${path.basename(backup)} (${relatorio.corrigir.length} linhas).`);

let ok = 0;
let falhas = 0;
for (let i = 0; i < relatorio.corrigir.length; i += 8) {
  const bloco = relatorio.corrigir.slice(i, i + 8);
  const rs = await Promise.all(
    bloco.map((c) =>
      db
        .from('product_prices')
        .update({ price: c.para.price, price_larger: c.para.larger })
        .eq('id', c.id),
    ),
  );
  for (const r of rs) (r.error ? falhas++ : ok++);
}
console.log(`\nCORRIGIDO: ${ok} preço(s). Falhas: ${falhas}.`);
