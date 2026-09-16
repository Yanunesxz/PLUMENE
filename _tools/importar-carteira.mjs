/**
 * Importa a carteira de UM representante a partir do relatório Curva ABC.
 *
 * O arquivo NÃO tem código de cliente — o casamento é por CNPJ (dígitos), com
 * segunda chance por razão social exata. Regras de segurança:
 *
 *   • cliente já do rep         → só completa campo vazio, não mexe no vínculo
 *   • cliente sem dono          → atrela ao rep
 *   • cliente de OUTRO rep      → NÃO MEXE. Vai para a lista de conflitos.
 *   • sem casamento nenhum      → cria, já atrelado
 *   • CNPJ repetido (banco/arquivo) → não mexe, lista
 *
 * Nunca apaga, nunca rouba cliente de outro representante, nunca sobrescreve
 * campo preenchido de cliente existente.
 *
 * Uso: node importar-carteira.mjs "arquivo.xlsx" CODIGO_DO_REP [--aplicar]
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const RAIZ = path.resolve(import.meta.dirname, '..');
const EMPRESA = '4a9fccd7-6241-4b8e-9c0b-b18aca364fba'; // Corpo Sensual
const require = createRequire(pathToFileURL(path.join(RAIZ, 'apps/api/.env')));
const { createClient } = require('@supabase/supabase-js');
const XLSX = require(path.join(RAIZ, 'apps/web/node_modules/xlsx'));

const [arquivo, codigoRep] = [process.argv[2], process.argv[3]];
const APLICAR = process.argv.includes('--aplicar');
if (!arquivo || !codigoRep) {
  console.error('Uso: node importar-carteira.mjs "arquivo.xlsx" CODIGO_DO_REP [--aplicar]');
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
  return d.length >= 11 ? d : null; // CPF 11 / CNPJ 14; menos que isso é lixo
};
// Só é telefone o que tem número de telefone. A coluna "Contato zap" do Curva ABC
// traz o NOME de quem atende ("SILVANA PROPRIETÁRIA"); sem este filtro ele caía
// no campo WhatsApp quando a coluna Whatsapp vinha vazia — 11 clientes da CS
// ficaram com um nome no lugar do número nas cargas de agosto.
const telefone = (v) => {
  const s = txt(v);
  return s && s.replace(/\D/g, '').length >= 8 ? s : null;
};
const miolo = (v) => String(v ?? '').replace(/\D/g, '').replace(/^0+/, '');
const nomeChave = (v) => (txt(v) ?? '').toUpperCase().replace(/\s+/g, ' ').trim();

// ─── 1. O representante ──────────────────────────────────────────────────────
const { data: reps } = await db
  .from('users')
  .select('id, name, erp_rep_id, role, active')
  .eq('company_id', EMPRESA)
  .eq('role', 'rep');
const rep = (reps ?? []).find((u) => miolo(u.erp_rep_id) === miolo(codigoRep));
if (!rep) {
  console.error(`❌ Nenhum representante com código ${codigoRep} no app. Nada foi feito.`);
  process.exit(1);
}
const CODIGO = rep.erp_rep_id; // canônico, como está no cadastro dele
console.log(`Representante: ${rep.name} (código ${CODIGO})${rep.active === false ? '  ⚠ INATIVO' : ''}`);

// ─── 2. O arquivo ────────────────────────────────────────────────────────────
const wb = XLSX.readFile(arquivo, { cellDates: false });
const aba = wb.SheetNames[0];
const linhas = XLSX.utils.sheet_to_json(wb.Sheets[aba], { header: 1, defval: null, raw: false });

let headerIdx = -1;
let col = {};
for (let i = 0; i < Math.min(linhas.length, 10); i++) {
  const mapa = {};
  (linhas[i] || []).forEach((c, j) => {
    const h = txt(c);
    if (!h) return;
    if (mapa.razao == null && /raz.*social/i.test(h)) mapa.razao = j;
    if (mapa.cnpj == null && /cnpj|cpf/i.test(h)) mapa.cnpj = j;
    if (mapa.cidade == null && /cidade/i.test(h)) mapa.cidade = j;
    if (mapa.uf == null && /^u\.?\s*f\.?$/i.test(h)) mapa.uf = j;
    if (mapa.bairro == null && /bairro/i.test(h)) mapa.bairro = j;
    if (mapa.endereco == null && /endere/i.test(h)) mapa.endereco = j;
    if (mapa.tel == null && /telefone/i.test(h)) mapa.tel = j;
    if (mapa.whats == null && /^whatsapp$/i.test(h)) mapa.whats = j;
    if (mapa.zap == null && /contato zap/i.test(h)) mapa.zap = j;
  });
  if (mapa.razao != null && mapa.cnpj != null) { headerIdx = i; col = mapa; break; }
}
if (headerIdx < 0) {
  console.error('❌ Não achei o cabeçalho (Razão Social + CNPJ). Nada foi feito.');
  process.exit(1);
}

const brutas = linhas.slice(headerIdx + 1);
const doArquivo = [];
let semRazao = 0;
for (const l of brutas) {
  const razao = txt(l?.[col.razao]);
  if (!razao) { semRazao++; continue; }
  const cnpjTexto = txt(l[col.cnpj]);
  doArquivo.push({
    razao,
    cnpjTexto,
    cnpj: digitos(cnpjTexto),
    whatsapp: telefone(l[col.whats]) ?? telefone(l[col.zap]) ?? telefone(l[col.tel]),
    endereco: [
      txt(l[col.endereco]),
      txt(l[col.bairro]),
      [txt(l[col.cidade]), txt(l[col.uf])].filter(Boolean).join('/'),
    ].filter(Boolean).join(' - ') || null,
  });
}

// CNPJ repetido dentro do próprio arquivo: fica só a primeira, o resto é listado.
const vistos = new Map();
const dupNoArquivo = [];
const linhasImportar = [];
for (const c of doArquivo) {
  if (c.cnpj && vistos.has(c.cnpj)) { dupNoArquivo.push(c); continue; }
  if (c.cnpj) vistos.set(c.cnpj, c);
  linhasImportar.push(c);
}

// ─── 3. O banco ──────────────────────────────────────────────────────────────
const clientes = [];
for (let de = 0; ; de += 1000) {
  const { data, error } = await db
    .from('customers')
    .select('id, erp_id, name, cnpj, rep_erp_id, rep_id, whatsapp, address, email')
    .eq('company_id', EMPRESA)
    .range(de, de + 999);
  if (error) throw new Error(error.message);
  clientes.push(...data);
  if (data.length < 1000) break;
}

const porCnpj = new Map();
for (const c of clientes) {
  const d = digitos(c.cnpj);
  if (!d) continue;
  if (!porCnpj.has(d)) porCnpj.set(d, []);
  porCnpj.get(d).push(c);
}
const porNome = new Map();
for (const c of clientes) {
  const n = nomeChave(c.name);
  if (!n) continue;
  if (!porNome.has(n)) porNome.set(n, []);
  porNome.get(n).push(c);
}

const ehDoRep = (c) => miolo(c.rep_erp_id) === miolo(CODIGO);
const temOutroDono = (c) => !!c.rep_erp_id && !ehDoRep(c);

// ─── 4. O plano ──────────────────────────────────────────────────────────────
const b = { jaDoRep: [], atrelar: [], criar: [], conflito: [], ambiguo: [], semCnpjCriar: [] };

for (const c of linhasImportar) {
  let existente = null;
  let comoAchou = '';

  if (c.cnpj) {
    const hits = porCnpj.get(c.cnpj) ?? [];
    if (hits.length > 1) { b.ambiguo.push({ ...c, motivo: `CNPJ em ${hits.length} cadastros` }); continue; }
    if (hits.length === 1) { existente = hits[0]; comoAchou = 'cnpj'; }
  }
  if (!existente) {
    const hits = porNome.get(nomeChave(c.razao)) ?? [];
    if (hits.length === 1) {
      const h = hits[0];
      const cnpjDele = digitos(h.cnpj);
      if (!cnpjDele || !c.cnpj || cnpjDele === c.cnpj) { existente = h; comoAchou = 'nome'; }
      else { b.conflito.push({ ...c, motivo: `nome bate com cadastro de CNPJ diferente (${h.cnpj})`, existente: h }); continue; }
    } else if (hits.length > 1) {
      b.ambiguo.push({ ...c, motivo: `nome em ${hits.length} cadastros` });
      continue;
    }
  }

  if (!existente) {
    if (c.cnpj) b.criar.push(c);
    else b.semCnpjCriar.push(c);
    continue;
  }
  if (temOutroDono(existente)) {
    b.conflito.push({ ...c, motivo: `já pertence ao rep ${existente.rep_erp_id}`, existente });
    continue;
  }
  (ehDoRep(existente) ? b.jaDoRep : b.atrelar).push({ ...c, existente, comoAchou });
}

console.log(`\nArquivo: ${path.basename(arquivo)} — aba "${aba}"`);
console.log(`Linhas de cliente ......... ${doArquivo.length} (ignoradas sem razão: ${semRazao}; duplicadas no arquivo: ${dupNoArquivo.length})`);
console.log(`\n═══ PLANO ═══`);
console.log(`  já do ${rep.name.split(' ')[0]} (só completa vazio) ... ${b.jaDoRep.length}`);
console.log(`  atrelar (existem, sem dono) .... ${b.atrelar.length}`);
console.log(`  criar novos (com CNPJ) ......... ${b.criar.length}`);
console.log(`  criar novos (SEM CNPJ) ......... ${b.semCnpjCriar.length}`);
console.log(`  CONFLITO (não mexo) ............ ${b.conflito.length}`);
console.log(`  ambíguo (não mexo) ............. ${b.ambiguo.length}`);

if (b.conflito.length) {
  console.log(`\n⚠ CONFLITOS — cliente do arquivo já pertence a OUTRO representante (nada será feito nestes):`);
  for (const c of b.conflito) console.log(`   ${c.razao} · ${c.cnpjTexto ?? 'sem CNPJ'} → ${c.motivo}`);
}
if (b.ambiguo.length) {
  console.log(`\n⚠ AMBÍGUOS (nada será feito nestes):`);
  for (const c of b.ambiguo) console.log(`   ${c.razao} · ${c.motivo}`);
}
if (b.semCnpjCriar.length) {
  console.log(`\nSem CNPJ que seriam CRIADOS (confira se não são lojas já cadastradas com outro nome):`);
  for (const c of b.semCnpjCriar) console.log(`   ${c.razao}`);
}
console.log('\nAmostra dos que seriam criados:');
for (const c of b.criar.slice(0, 5)) console.log(`   ${c.razao} · ${c.cnpjTexto} · ${c.whatsapp ?? 'sem tel'}`);
console.log('Amostra dos que seriam atrelados:');
for (const c of b.atrelar.slice(0, 5)) console.log(`   ${c.razao} (achado por ${c.comoAchou})`);

if (!APLICAR) {
  console.log('\n(prévia — nada foi gravado. Rode com --aplicar para gravar.)');
  process.exit(0);
}

// ─── 5. Backup + gravação ────────────────────────────────────────────────────
mkdirSync(path.join(RAIZ, 'backups'), { recursive: true });
const bk = path.join(RAIZ, 'backups', `carteira-${miolo(CODIGO)}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`);
writeFileSync(bk, JSON.stringify(clientes, null, 1), 'utf8');
console.log(`\nbackup .......... ${bk} (${clientes.length} clientes como estavam)`);

const criar = [...b.criar, ...b.semCnpjCriar].map((c) => ({
  company_id: EMPRESA,
  erp_id: null,
  name: c.razao,
  cnpj: c.cnpjTexto,
  rep_erp_id: CODIGO,
  whatsapp: c.whatsapp,
  address: c.endereco,
  blocked: false,
  updated_at: new Date().toISOString(),
}));
for (let i = 0; i < criar.length; i += 200) {
  const { error } = await db.from('customers').insert(criar.slice(i, i + 200));
  if (error) throw new Error(`insert: ${error.message}`);
}
console.log(`criados ......... ${criar.length}`);

let atrelados = 0;
for (const c of b.atrelar) {
  const patch = { rep_erp_id: CODIGO, updated_at: new Date().toISOString() };
  if (!c.existente.cnpj && c.cnpjTexto) patch.cnpj = c.cnpjTexto;
  if (!c.existente.whatsapp && c.whatsapp) patch.whatsapp = c.whatsapp;
  if (!c.existente.address && c.endereco) patch.address = c.endereco;
  const { error } = await db.from('customers').update(patch).eq('id', c.existente.id);
  if (error) throw new Error(`update ${c.existente.id}: ${error.message}`);
  atrelados++;
}
console.log(`atrelados ....... ${atrelados}`);

let completados = 0;
for (const c of b.jaDoRep) {
  const patch = {};
  if (!c.existente.cnpj && c.cnpjTexto) patch.cnpj = c.cnpjTexto;
  if (!c.existente.whatsapp && c.whatsapp) patch.whatsapp = c.whatsapp;
  if (!c.existente.address && c.endereco) patch.address = c.endereco;
  if (Object.keys(patch).length === 0) continue;
  patch.updated_at = new Date().toISOString();
  const { error } = await db.from('customers').update(patch).eq('id', c.existente.id);
  if (error) throw new Error(`update ${c.existente.id}: ${error.message}`);
  completados++;
}
console.log(`completados ..... ${completados} (já eram dele, ganharam campo que faltava)`);

// ─── 6. Conferência ──────────────────────────────────────────────────────────
const { count } = await db
  .from('customers')
  .select('id', { count: 'exact', head: true })
  .eq('company_id', EMPRESA)
  .eq('rep_erp_id', CODIGO);
console.log(`\ncarteira do ${rep.name.split(' ')[0]} agora: ${count} clientes com o código ${CODIGO}`);
console.log('pronto.');
