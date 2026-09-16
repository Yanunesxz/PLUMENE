/**
 * Conserta o WhatsApp dos clientes que ficaram com um NOME no lugar do número.
 *
 * Causa: até 16/09/2026 o importar-carteira.mjs aceitava qualquer texto da
 * coluna "Contato zap" do Curva ABC como telefone. Quando "Whatsapp" vinha
 * vazia (ou "0"), o nome de quem atende ("MANUELA", "JUNIOR") caía no campo.
 *
 * Regras:
 *   • só mexe em cliente cujo whatsapp atual tem MENOS de 8 dígitos;
 *   • o número novo vem de "Telefone1" das planilhas do Curva ABC em Downloads,
 *     casado pelo CNPJ — e TODAS as planilhas que têm o cliente precisam
 *     concordar no número, senão não mexe e lista;
 *   • backup antes de gravar; grava um a um conferindo que o valor atual ainda
 *     é o ruim (ninguém editou no meio).
 *
 * Uso: node _tools/consertar-whatsapp-com-nome.mjs [--aplicar] [pasta-das-planilhas]
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const RAIZ = path.resolve(import.meta.dirname, '..');
const EMPRESA = '4a9fccd7-6241-4b8e-9c0b-b18aca364fba'; // Corpo Sensual
const require = createRequire(pathToFileURL(path.join(RAIZ, 'apps/api/.env')));
const { createClient } = require('@supabase/supabase-js');
const XLSX = require(path.join(RAIZ, 'apps/web/node_modules/xlsx'));

const APLICAR = process.argv.includes('--aplicar');
const PASTA = process.argv.slice(2).find((a) => a !== '--aplicar') ?? path.join(process.env.USERPROFILE ?? '', 'Downloads');

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
const digitos = (v) => String(v ?? '').replace(/\D/g, '');
const ehTelefone = (v) => !!v && digitos(v).length >= 8;

// ─── 1. Quem está errado no banco ────────────────────────────────────────────
const clientes = [];
for (let de = 0; ; de += 1000) {
  const { data, error } = await db
    .from('customers')
    // updated_at vai junto para o backup: a gravação troca o carimbo.
    .select('id, name, cnpj, rep_erp_id, whatsapp, updated_at')
    .eq('company_id', EMPRESA)
    .range(de, de + 999);
  if (error) throw new Error(error.message);
  clientes.push(...data);
  if (data.length < 1000) break;
}
const errados = clientes.filter((c) => c.whatsapp && !ehTelefone(c.whatsapp));
console.log(`Banco: ${clientes.length} clientes; com nome (ou lixo) no WhatsApp: ${errados.length}`);
if (errados.length === 0) process.exit(0);

// ─── 2. O que as planilhas dizem (Telefone1, por CNPJ) ───────────────────────
const alvos = new Set(errados.map((c) => digitos(c.cnpj)).filter((d) => d.length >= 11));
const fontes = new Map(); // cnpj → Map<telefone, [arquivos]>
// "arquivo (1).xlsx" costuma ser o MESMO download duas vezes: cópia byte a byte
// não é uma segunda fonte, e contar em dobro inflava o "N planilhas concordam".
const conteudosVistos = new Set();
for (const f of readdirSync(PASTA).filter((f) => /\.xlsx$/i.test(f))) {
  let wb;
  try {
    const bytes = readFileSync(path.join(PASTA, f));
    const hash = createHash('md5').update(bytes).digest('hex');
    if (conteudosVistos.has(hash)) continue;
    conteudosVistos.add(hash);
    wb = XLSX.read(bytes, { type: 'buffer', cellDates: false });
  } catch { continue; }
  const linhas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null, raw: false });
  let col = null;
  for (let i = 0; i < Math.min(linhas.length, 10); i++) {
    const m = {};
    (linhas[i] || []).forEach((c, j) => {
      const h = txt(c);
      if (!h) return;
      if (m.razao == null && /raz.*social/i.test(h)) m.razao = j;
      if (m.cnpj == null && /cnpj|cpf/i.test(h)) m.cnpj = j;
      if (m.whats == null && /^whatsapp$/i.test(h)) m.whats = j;
      if (m.zap == null && /contato zap/i.test(h)) m.zap = j;
      if (m.tel == null && /telefone/i.test(h)) m.tel = j;
    });
    if (m.razao != null && m.cnpj != null && m.tel != null) { col = { ...m, i }; break; }
  }
  if (!col) continue;
  for (const l of linhas.slice(col.i + 1)) {
    const d = digitos(l?.[col.cnpj]);
    if (!alvos.has(d)) continue;
    // A mesma preferência do importador consertado: Whatsapp, Contato zap,
    // Telefone1 — o primeiro que for número de telefone.
    const numero = [l[col.whats], l[col.zap], l[col.tel]].map(txt).find(ehTelefone) ?? null;
    if (!numero) continue;
    if (!fontes.has(d)) fontes.set(d, new Map());
    const porNumero = fontes.get(d);
    if (!porNumero.has(numero)) porNumero.set(numero, []);
    porNumero.get(numero).push(f);
  }
}

// ─── 3. O plano ──────────────────────────────────────────────────────────────
const plano = [];
const semFonte = [];
const discordam = [];
for (const c of errados) {
  const d = digitos(c.cnpj);
  const porNumero = fontes.get(d);
  if (!porNumero || porNumero.size === 0) { semFonte.push(c); continue; }
  if (porNumero.size > 1) { discordam.push({ c, opcoes: [...porNumero.entries()] }); continue; }
  const [numero, arquivos] = [...porNumero.entries()][0];
  plano.push({ c, numero, arquivos });
}

console.log(`\n═══ PLANO ═══`);
for (const p of plano) console.log(`  [${p.c.rep_erp_id}] ${p.c.name} · "${p.c.whatsapp}" → "${p.numero}"  (${p.arquivos.length} planilha${p.arquivos.length > 1 ? 's' : ''} concordam)`);
if (discordam.length) {
  console.log(`\n⚠ planilhas DISCORDAM (não mexo):`);
  for (const { c, opcoes } of discordam) console.log(`  [${c.rep_erp_id}] ${c.name} · ${opcoes.map(([n, fs]) => `"${n}" (${fs.join(', ')})`).join(' | ')}`);
}
if (semFonte.length) {
  console.log(`\n⚠ sem número em planilha nenhuma (não mexo):`);
  for (const c of semFonte) console.log(`  [${c.rep_erp_id}] ${c.name} · "${c.whatsapp}"`);
}
if (!APLICAR) {
  console.log('\n(prévia — nada foi gravado. Rode com --aplicar para gravar.)');
  process.exit(0);
}

// ─── 4. Backup + gravação ────────────────────────────────────────────────────
mkdirSync(path.join(RAIZ, 'backups'), { recursive: true });
const bk = path.join(RAIZ, 'backups', `whatsapp-com-nome-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`);
writeFileSync(bk, JSON.stringify(errados, null, 1), 'utf8');
console.log(`\nbackup .......... ${bk} (${errados.length} clientes como estavam)`);

let gravados = 0;
for (const p of plano) {
  // `.eq('whatsapp', valor ruim)`: se alguém corrigiu à mão no meio, não sobrescreve.
  const { data, error } = await db
    .from('customers')
    .update({ whatsapp: p.numero, updated_at: new Date().toISOString() })
    .eq('id', p.c.id)
    .eq('company_id', EMPRESA)
    .eq('whatsapp', p.c.whatsapp)
    .select('id');
  if (error) throw new Error(`update ${p.c.id}: ${error.message}`);
  if ((data ?? []).length === 1) gravados++;
  else console.log(`  ⚠ ${p.c.name}: o WhatsApp já não era "${p.c.whatsapp}" — não mexi`);
}
console.log(`gravados ........ ${gravados} de ${plano.length}`);

const { data: restam } = await db
  .from('customers')
  .select('id, name, whatsapp')
  .eq('company_id', EMPRESA)
  .in('id', errados.map((c) => c.id));
const aindaRuins = (restam ?? []).filter((c) => c.whatsapp && !ehTelefone(c.whatsapp));
console.log(`ainda com nome no WhatsApp: ${aindaRuins.length}`);
console.log('pronto.');
