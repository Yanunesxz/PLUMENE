/**
 * Carrega o HISTÓRICO DE COMPRA (migração 036) a partir dos relatórios
 * Curva ABC do Control: Últ.Compra → last_purchase_at, R$ Total Comprado →
 * total_purchased, R$ Vencido → overdue_amount.
 *
 * Regras — é uma CARGA DE RETRATO, não uma importação de carteira:
 *   • nunca cria cliente, nunca mexe em vínculo de representante
 *   • casa por CNPJ (dígitos); segunda chance por razão social exata e ÚNICA
 *   • last_purchase_at só anda PARA FRENTE (o app pode já ter data mais nova
 *     de pedido faturado — retrato velho não desfaz compra real)
 *   • total_purchased / overdue_amount são o retrato do Control e sobrescrevem
 *
 * Uso: node carregar-historico-abc.mjs [--aplicar] "arq1.xlsx" "arq2.xlsx" …
 * Sem --aplicar é ensaio: mostra o que faria, não escreve nada.
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const RAIZ = path.resolve(import.meta.dirname, '..');
const EMPRESA = '4a9fccd7-6241-4b8e-9c0b-b18aca364fba'; // Corpo Sensual
const require = createRequire(pathToFileURL(path.join(RAIZ, 'apps/api/.env')));
const { createClient } = require('@supabase/supabase-js');
const XLSX = require(path.join(RAIZ, 'apps/web/node_modules/xlsx'));

const APLICAR = process.argv.includes('--aplicar');
const arquivos = process.argv.slice(2).filter((a) => a !== '--aplicar');
if (arquivos.length === 0) {
  console.error('Uso: node carregar-historico-abc.mjs [--aplicar] "arquivo.xlsx" …');
  process.exit(1);
}

const env = {};
for (const l of readFileSync(path.join(RAIZ, 'apps/api/.env'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const txt = (v) => {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};
const digitos = (v) => {
  const s = txt(v);
  if (!s) return null;
  const d = s.replace(/\D/g, '');
  return d.length >= 11 ? d : null;
};
const nomeChave = (v) => (txt(v) ?? '').toUpperCase().replace(/\s+/g, ' ').trim();

/** "10/08/26" ou "10/08/2026" → "2026-08-10". Fora disso, null. */
function dataIso(v) {
  const s = txt(v);
  if (!s) return null;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const [, d, mes, aa] = m;
  const ano = aa.length === 2 ? `20${aa}` : aa;
  const iso = `${ano}-${mes.padStart(2, '0')}-${d.padStart(2, '0')}`;
  return Number.isNaN(new Date(iso).getTime()) ? null : iso;
}

/** "R$ 11,283.60" (formato do relatório: vírgula de milhar, ponto decimal) → 11283.6 */
function reais(v) {
  const s = txt(v);
  if (!s) return null;
  const n = Number.parseFloat(s.replace(/R\$\s*/i, '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

// ─── O banco inteiro, uma vez ────────────────────────────────────────────────
const clientes = [];
for (let de = 0; ; de += 1000) {
  const { data, error } = await db
    .from('customers')
    .select('id, name, cnpj, last_purchase_at')
    .eq('company_id', EMPRESA)
    .range(de, de + 999);
  if (error) { console.error('❌ banco:', error.message); process.exit(1); }
  clientes.push(...(data ?? []));
  if (!data || data.length < 1000) break;
}
const porCnpj = new Map();
const porNome = new Map();
for (const c of clientes) {
  const d = digitos(c.cnpj);
  if (d && !porCnpj.has(d)) porCnpj.set(d, c);
  const k = nomeChave(c.name);
  porNome.set(k, porNome.has(k) ? 'ambiguo' : c);
}
console.log(`Banco: ${clientes.length} clientes.\n`);

// ─── Cada arquivo ────────────────────────────────────────────────────────────
const totais = { atualizados: 0, dataAndou: 0, semCasamento: 0, semDados: 0, falhas: 0 };
const naoEncontrados = [];

for (const arquivo of arquivos) {
  const wb = XLSX.readFile(arquivo, { cellDates: false });
  const linhas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null, raw: false });

  let headerIdx = -1;
  let col = {};
  for (let i = 0; i < Math.min(linhas.length, 10); i++) {
    const mapa = {};
    (linhas[i] || []).forEach((c, j) => {
      const h = txt(c);
      if (!h) return;
      if (mapa.razao == null && /raz.*social/i.test(h)) mapa.razao = j;
      if (mapa.cnpj == null && /cnpj|cpf/i.test(h)) mapa.cnpj = j;
      // "Últ.Compra" sim; "R$ Últ.Compra" não — o valor da última compra não interessa.
      if (mapa.ult == null && /^[uú]lt/i.test(h) && /compra/i.test(h)) mapa.ult = j;
      if (mapa.total == null && /total\s*comprado/i.test(h)) mapa.total = j;
      if (mapa.vencido == null && /^r\$\s*vencido$/i.test(h)) mapa.vencido = j;
    });
    if (mapa.razao != null && mapa.cnpj != null && mapa.ult != null) { headerIdx = i; col = mapa; break; }
  }
  const nomeArq = path.basename(arquivo);
  if (headerIdx < 0) {
    console.log(`⚠ ${nomeArq}: sem colunas de Curva ABC (Razão + CNPJ + Últ.Compra) — pulado.`);
    continue;
  }

  let casadas = 0, atualizadas = 0, semCasar = 0, semDados = 0;
  const pendentes = [];
  for (const l of linhas.slice(headerIdx + 1)) {
    const razao = txt(l?.[col.razao]);
    if (!razao) continue;
    const ult = dataIso(l[col.ult]);
    const total = col.total != null ? reais(l[col.total]) : null;
    const vencido = col.vencido != null ? reais(l[col.vencido]) : null;
    if (ult == null && total == null && vencido == null) { semDados++; continue; }

    const cnpj = digitos(l[col.cnpj]);
    let cli = cnpj ? porCnpj.get(cnpj) : null;
    if (!cli) {
      const porN = porNome.get(nomeChave(razao));
      if (porN && porN !== 'ambiguo') cli = porN;
    }
    if (!cli) { semCasar++; naoEncontrados.push(`${nomeArq}: ${razao}`); continue; }
    casadas++;

    // Data só anda para frente; valores são o retrato do Control.
    const update = {};
    if (ult && (!cli.last_purchase_at || cli.last_purchase_at < ult)) update.last_purchase_at = ult;
    if (total != null) update.total_purchased = total;
    if (vencido != null) update.overdue_amount = vencido;
    if (Object.keys(update).length === 0) continue;
    if (update.last_purchase_at) totais.dataAndou++;
    pendentes.push({ id: cli.id, update });
  }

  if (APLICAR) {
    // Em blocos de 8 pra não afogar o PostgREST.
    for (let i = 0; i < pendentes.length; i += 8) {
      const bloco = pendentes.slice(i, i + 8);
      const rs = await Promise.all(
        bloco.map(({ id, update }) =>
          db.from('customers').update(update).eq('id', id).eq('company_id', EMPRESA),
        ),
      );
      for (const r of rs) r.error ? totais.falhas++ : atualizadas++;
    }
  } else {
    atualizadas = pendentes.length;
  }

  totais.atualizados += atualizadas;
  totais.semCasamento += semCasar;
  totais.semDados += semDados;
  console.log(
    `${APLICAR ? '✔' : '·'} ${nomeArq}: ${casadas} casadas, ${atualizadas} ${APLICAR ? 'atualizadas' : 'a atualizar'}, ${semCasar} sem casamento, ${semDados} sem dados`,
  );
}

console.log(`\n${APLICAR ? 'CARGA FEITA' : 'ENSAIO (nada gravado — rode com --aplicar)'}`);
console.log(`Atualizados: ${totais.atualizados} · datas que andaram: ${totais.dataAndou} · sem casamento: ${totais.semCasamento} · sem dados: ${totais.semDados} · falhas: ${totais.falhas}`);
if (naoEncontrados.length > 0) {
  console.log(`\nSem casamento (${naoEncontrados.length}):`);
  for (const n of naoEncontrados.slice(0, 40)) console.log('  - ' + n);
  if (naoEncontrados.length > 40) console.log(`  … e mais ${naoEncontrados.length - 40}`);
}
