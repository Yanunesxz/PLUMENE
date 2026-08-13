/**
 * Corrige os pedidos que foram montados ANTES da faixa maior existir.
 *
 * Até a migração 026 o sistema tinha um preço só por referência, então todo EG,
 * XG e peça da grade plus entrou no pedido pelo preço do tamanho normal. Este
 * script refaz a conta pela tabela do pedido e regrava `unit_price`, o `total`
 * do item e o `total` do pedido.
 *
 * O QUE ELE NÃO TOCA, de propósito:
 *
 *   - pedido FATURADO (`invoiced`). A fábrica já emitiu a nota por aquele valor;
 *     reescrever aqui criaria uma segunda verdade, diferente da que está no
 *     Control. Se algum aparecer, o script lista e deixa a decisão com o Yan.
 *   - pedido já enviado ao ERP (`sent_erp`), pelo mesmo motivo.
 *   - pedido recusado (`rejected`), que não vira dinheiro.
 *
 * Ou seja: só mexe no que ainda está em montagem ou na fila de decisão —
 * rascunho, triagem do representante e espera do gerente.
 *
 * Uso:  node corrigir-pedidos-faixa-maior.mjs [--aplicar]
 * Sem --aplicar só mostra o que faria.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..', '..');
const APLICAR = process.argv.includes('--aplicar');
const COMPANY_ID = '4a9fccd7-6241-4b8e-9c0b-b18aca364fba'; // Corpo Sensual

/** Só estes seguem em aberto; o resto já virou compromisso com a fábrica. */
const CORRIGIVEIS = new Set(['draft', 'pending_rep', 'pending_approval']);

const { createClient } = await import(
  pathToFileURL(join(RAIZ, 'apps/api/node_modules/@supabase/supabase-js/dist/index.mjs')).href
);
const env = {};
for (const l of readFileSync(join(RAIZ, 'apps/api/.env'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const morra = (msg, erro) => {
  console.error(`✖ ${msg}${erro ? `: ${erro.message}` : ''}`);
  process.exit(1);
};

// A MESMA regra de packages/shared/src/pricing/faixaDeTamanho.ts. Repetida aqui
// porque este script roda solto com node, sem passar pelo build do workspace.
const MAIORES = new Set(['EG', 'EGG', 'EGGG', 'XG', 'XG2', 'XG3', 'XG4', '48', '50', '52', '54']);
const norm = (s) => {
  const t = String(s ?? '').trim().toUpperCase().replace(/\s+/g, '');
  return /^\d+$/.test(t) ? String(Number(t)) : t;
};
const ehFaixaMaior = (s) => MAIORES.has(norm(s));

const pagina = async (tabela, select, filtro = (q) => q) => {
  const tudo = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await filtro(db.from(tabela).select(select)).range(de, de + 999);
    if (error) morra(`lendo ${tabela}`, error);
    tudo.push(...data);
    if (data.length < 1000) break;
  }
  return tudo;
};

// ─── 1. Leitura ──────────────────────────────────────────────────────────────
const pedidos = await pagina(
  'orders',
  'id, order_number, status, total, customer_id, rep_id, price_table_id, invoiced',
  (q) => q.eq('company_id', COMPANY_ID),
);
const itens = await pagina('order_items', 'id, order_id, product_id, variant_id, quantity, unit_price, total');
const variantes = await pagina('product_variants', 'id, size', (q) => q.eq('company_id', COMPANY_ID));
const precos = await pagina('product_prices', 'product_id, price_table_id, price, price_larger');
const clientes = await pagina('customers', 'id, price_table_id', (q) => q.eq('company_id', COMPANY_ID));
const usuarios = await pagina('users', 'id, price_table_id', (q) => q.eq('company_id', COMPANY_ID));

const sizeDe = new Map(variantes.map((v) => [v.id, v.size]));
const tabelaDoCliente = new Map(clientes.map((c) => [c.id, c.price_table_id]));
const tabelaDoRep = new Map(usuarios.map((u) => [u.id, u.price_table_id]));
const precoDe = new Map(precos.map((p) => [`${p.product_id}|${p.price_table_id}`, p]));
const itensDe = new Map();
for (const i of itens) {
  if (!itensDe.has(i.order_id)) itensDe.set(i.order_id, []);
  itensDe.get(i.order_id).push(i);
}

// ─── 2. O que corrigir ───────────────────────────────────────────────────────
const aCorrigir = [];
const intocaveis = [];

for (const o of pedidos) {
  // A mesma dedução da API: a tabela DO pedido (025), caindo para a do cliente
  // e depois para a do representante.
  const tabela = o.price_table_id ?? tabelaDoCliente.get(o.customer_id) ?? tabelaDoRep.get(o.rep_id) ?? null;
  const linhas = [];

  for (const i of itensDe.get(o.id) ?? []) {
    const size = i.variant_id ? sizeDe.get(i.variant_id) : null;
    if (!ehFaixaMaior(size)) continue;
    const p = tabela ? precoDe.get(`${i.product_id}|${tabela}`) : null;
    if (!p || p.price_larger == null) continue;
    const certo = Number(p.price_larger);
    if (Math.abs(certo - Number(i.unit_price)) < 0.005) continue;
    linhas.push({
      id: i.id,
      size,
      quantity: i.quantity,
      de: Number(i.unit_price),
      para: certo,
      totalNovo: Number((i.quantity * certo).toFixed(2)),
    });
  }

  if (linhas.length === 0) continue;

  const dif = linhas.reduce((s, l) => s + (l.para - l.de) * l.quantity, 0);
  const registro = { ...o, tabela, linhas, dif, totalNovo: Number((Number(o.total) + dif).toFixed(2)) };

  if (o.invoiced || !CORRIGIVEIS.has(o.status)) intocaveis.push(registro);
  else aCorrigir.push(registro);
}

console.log(`pedidos ............. ${pedidos.length}`);
console.log(`a corrigir .......... ${aCorrigir.length}`);
console.log(`intocaveis .......... ${intocaveis.length} (faturado / enviado ao ERP / recusado)\n`);

for (const o of aCorrigir) {
  console.log(`pedido #${o.order_number ?? o.id}  [${o.status}]`);
  for (const l of o.linhas) {
    console.log(`   ${String(l.size).padEnd(4)} ${String(l.quantity).padStart(3)} un  R$ ${l.de.toFixed(2)} → R$ ${l.para.toFixed(2)}`);
  }
  console.log(`   total  R$ ${Number(o.total).toFixed(2)} → R$ ${o.totalNovo.toFixed(2)}  (+R$ ${o.dif.toFixed(2)})\n`);
}

if (intocaveis.length) {
  console.log('NÃO corrigidos — precisam de decisão sua, porque já viraram compromisso:');
  for (const o of intocaveis) {
    console.log(`   #${o.order_number ?? o.id} [${o.status}${o.invoiced ? ' FATURADO' : ''}]  deveria ser +R$ ${o.dif.toFixed(2)}`);
  }
  console.log('');
}

if (aCorrigir.length === 0) {
  console.log('nada a fazer.');
  process.exit(0);
}

if (!APLICAR) {
  console.log('(simulação — rode com --aplicar para gravar)');
  process.exit(0);
}

// ─── 3. Backup ───────────────────────────────────────────────────────────────
mkdirSync(join(RAIZ, 'backups'), { recursive: true });
const arquivo = join(
  RAIZ,
  'backups',
  `pedidos-faixa-maior-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`,
);
const idsAfetados = new Set(aCorrigir.map((o) => o.id));
writeFileSync(
  arquivo,
  JSON.stringify(
    {
      pedidos: pedidos.filter((p) => idsAfetados.has(p.id)),
      itens: itens.filter((i) => idsAfetados.has(i.order_id)),
    },
    null,
    1,
  ),
  'utf8',
);
console.log(`backup .............. ${arquivo}`);

// ─── 4. Gravação ─────────────────────────────────────────────────────────────
// Item primeiro, pedido depois: se parar no meio, o total do pedido fica menor
// que a soma dos itens — divergência visível — em vez de maior, que passaria
// despercebida e cobraria do lojista sem lastro nas linhas.
for (const o of aCorrigir) {
  for (const l of o.linhas) {
    const { error } = await db
      .from('order_items')
      .update({ unit_price: l.para, total: l.totalNovo })
      .eq('id', l.id);
    if (error) morra(`gravando item ${l.id} do pedido ${o.order_number}`, error);
  }
  const { error } = await db.from('orders').update({ total: o.totalNovo }).eq('id', o.id);
  if (error) morra(`gravando o total do pedido ${o.order_number}`, error);
  console.log(`corrigido ........... #${o.order_number}  +R$ ${o.dif.toFixed(2)}`);
}

// ─── 5. Conferência ──────────────────────────────────────────────────────────
const conferir = await pagina('orders', 'id, order_number, total', (q) =>
  q.eq('company_id', COMPANY_ID).in('id', [...idsAfetados]),
);
const itensDepois = await pagina('order_items', 'order_id, total', (q) => q.in('order_id', [...idsAfetados]));

console.log('\nconferência (total do pedido × soma dos itens):');
let divergente = 0;
for (const o of conferir) {
  const soma = itensDepois
    .filter((i) => i.order_id === o.id)
    .reduce((s, i) => s + Number(i.total), 0);
  const bate = Math.abs(soma - Number(o.total)) < 0.02;
  if (!bate) divergente += 1;
  console.log(
    `   #${o.order_number}  pedido R$ ${Number(o.total).toFixed(2)}  itens R$ ${soma.toFixed(2)}  ${bate ? 'ok' : '⚠ DIVERGENTE'}`,
  );
}
console.log(divergente === 0 ? '\npronto.' : `\n⚠ ${divergente} pedido(s) divergentes — conferir à mão.`);
