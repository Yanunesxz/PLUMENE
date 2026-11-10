/**
 * Passa a carteira de um representante para outro, pelos CNPJs de um relatório
 * do Control (Curva ABC / "Relação de clientes").
 *
 * É o irmão do `importar-carteira.mjs`, que de propósito NUNCA move cliente de
 * outro rep — ele lista o conflito e espera a decisão do Yan. Quando a decisão
 * é "esses passam para o outro", a mudança é esta, e só ela:
 *
 *     customers.rep_erp_id  →  o código do representante de destino
 *
 * O que este script NÃO toca, de propósito:
 *
 *   • `price_table_id` — o preço é do CADASTRO do cliente. Cliente sem tabela
 *     própria segue a do representante, então mudar de dono pode mudar o preço
 *     dele: o script AVISA quantos estão nessa situação e qual é a diferença,
 *     mas não carimba tabela por conta própria (ver a conversa de 10/11/2026,
 *     em que a decisão foi deixar os 63 passarem para a T2).
 *   • `rep_id` — é "quem cadastrou no app", histórico. Mas a carteira que a
 *     tela mostra é `rep_id` OU `rep_erp_id` (getCustomers), então quem cadastrou
 *     CONTINUA vendo o cliente depois da troca de dono. O script lista esses
 *     casos; limpar o rastro é decisão de quem está rodando, não dele.
 *   • pedidos — o pedido fica com o representante que o tirou. O histórico de
 *     venda não muda de mão porque a carteira mudou.
 *
 * Casa só por CNPJ/CPF exato (dígitos). Linha que não casa é listada, nunca
 * criada: criar cliente é trabalho do `importar-carteira.mjs`.
 *
 * Uso: node mover-carteira.mjs "arquivo.xlsx" CODIGO_DO_REP_DESTINO [--aplicar]
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { exigirCanalDeCarga } from './canal-de-carga.mjs';

const RAIZ = path.resolve(import.meta.dirname, '..');
const EMPRESA = '4a9fccd7-6241-4b8e-9c0b-b18aca364fba'; // Corpo Sensual
const require = createRequire(pathToFileURL(path.join(RAIZ, 'apps/api/.env')));
const { createClient } = require('@supabase/supabase-js');
const XLSX = require(path.join(RAIZ, 'apps/web/node_modules/xlsx'));

const [arquivo, codigoDestino] = [process.argv[2], process.argv[3]];
const APLICAR = process.argv.includes('--aplicar');
if (!arquivo || !codigoDestino) {
  console.error('Uso: node mover-carteira.mjs "arquivo.xlsx" CODIGO_DO_REP_DESTINO [--aplicar]');
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

// Mesma trava da carga de carteira: se o cadastro desta empresa já vem do
// Control, quem manda na carteira é ele, e a planilha não.
await exigirCanalDeCarga(db, {
  empresas: EMPRESA,
  canais: ['cadastro'],
  acao: 'A troca de dono da carteira por planilha',
});

const txt = (v) => {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};
const digitos = (v) => {
  const d = String(v ?? '').replace(/\D/g, '');
  return d.length >= 11 ? d : null; // CPF 11 / CNPJ 14; menos que isso é lixo
};
/** Para CASAR código: "#04010" = "4010" = "04010". Igual ao codigoMiolo do app. */
const miolo = (v) => String(v ?? '').replace(/\D/g, '').replace(/^0+/, '');

// ─── 1. O representante de destino ───────────────────────────────────────────
const { data: reps } = await db
  .from('users')
  .select('id, name, erp_rep_id, active, price_table_id')
  .eq('company_id', EMPRESA)
  .eq('role', 'rep');
const destino = (reps ?? []).find((r) => miolo(r.erp_rep_id) === miolo(codigoDestino));
if (!destino) {
  console.error(`❌ Nenhum representante com código ${codigoDestino} no app. Nada foi feito.`);
  process.exit(1);
}
const CODIGO = destino.erp_rep_id; // canônico, como está no cadastro dele
console.log(`Destino: ${destino.name} (código ${CODIGO})${destino.active === false ? '  ⚠ INATIVO' : ''}`);

/** O nome de um código. Código vazio é "SEM REP" — nunca casa com rep sem código. */
const nomeDoCodigo = (codigo) => {
  if (!miolo(codigo)) return 'SEM REP';
  const r = (reps ?? []).find((x) => miolo(x.erp_rep_id) === miolo(codigo));
  return r ? r.name : `(código ${codigo} sem login no app)`;
};

// ─── 2. O arquivo ────────────────────────────────────────────────────────────
const wb = XLSX.readFile(arquivo, { cellDates: false });
const aba = wb.SheetNames[0];
const grade = XLSX.utils.sheet_to_json(wb.Sheets[aba], { header: 1, defval: null, raw: false });

// O relatório tem título e subtítulo antes do cabeçalho — acha a linha que tem
// Razão Social e CNPJ, como o importar-carteira faz.
let cabecalho = -1;
let col = {};
for (let i = 0; i < Math.min(grade.length, 10); i++) {
  const mapa = {};
  (grade[i] || []).forEach((c, j) => {
    const h = txt(c);
    if (!h) return;
    if (mapa.razao == null && /raz.*social/i.test(h)) mapa.razao = j;
    if (mapa.cnpj == null && /cnpj|cpf/i.test(h)) mapa.cnpj = j;
  });
  if (mapa.razao != null && mapa.cnpj != null) { cabecalho = i; col = mapa; break; }
}
if (cabecalho < 0) {
  console.error('❌ Não achei o cabeçalho (Razão Social + CNPJ). Nada foi feito.');
  process.exit(1);
}

const doArquivo = [];
let semRazao = 0;
for (const l of grade.slice(cabecalho + 1)) {
  const razao = txt(l?.[col.razao]);
  if (!razao) { semRazao++; continue; }
  const cnpjTexto = txt(l[col.cnpj]);
  doArquivo.push({ razao, cnpjTexto, cnpj: digitos(cnpjTexto) });
}

// ─── 3. O banco ──────────────────────────────────────────────────────────────
const clientes = [];
for (let de = 0; ; de += 1000) {
  const { data, error } = await db
    .from('customers')
    .select('id, name, cnpj, rep_erp_id, rep_id, price_table_id')
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
  porCnpj.set(d, [...(porCnpj.get(d) ?? []), c]);
}

// ─── 4. O plano ──────────────────────────────────────────────────────────────
const mover = [];
const jaDoDestino = [];
const semCasamento = [];
const ambiguo = [];
const vistos = new Set();
for (const linha of doArquivo) {
  if (!linha.cnpj) { semCasamento.push(`${linha.razao} · sem CNPJ no arquivo`); continue; }
  if (vistos.has(linha.cnpj)) continue; // CNPJ repetido no arquivo: a primeira vale
  vistos.add(linha.cnpj);

  const achados = porCnpj.get(linha.cnpj) ?? [];
  if (achados.length === 0) { semCasamento.push(`${linha.razao} · ${linha.cnpjTexto}`); continue; }
  if (achados.length > 1) { ambiguo.push(`${linha.razao} · CNPJ em ${achados.length} cadastros`); continue; }

  const c = achados[0];
  (miolo(c.rep_erp_id) === miolo(CODIGO) ? jaDoDestino : mover).push(c);
}

const deQuem = {};
for (const c of mover) {
  const k = `${c.rep_erp_id ?? '—'} ${nomeDoCodigo(c.rep_erp_id)}`;
  deQuem[k] = (deQuem[k] ?? 0) + 1;
}

console.log(`\nArquivo: ${path.basename(arquivo)} — aba "${aba}"`);
console.log(`Linhas de cliente ......... ${doArquivo.length} (ignoradas sem razão: ${semRazao})`);
console.log(`\n═══ PLANO ═══`);
console.log(`  já são do destino ....... ${jaDoDestino.length}`);
console.log(`  A MOVER ................. ${mover.length}`, deQuem);
console.log(`  sem casamento (não crio)  ${semCasamento.length}`);
console.log(`  ambíguo (não mexo) ...... ${ambiguo.length}`);
for (const s of semCasamento) console.log(`   ⚠ sem casamento: ${s}`);
for (const s of ambiguo) console.log(`   ⚠ ambíguo: ${s}`);

// O preço do cliente sem tabela própria é o da tabela do REPRESENTANTE: trocar
// de dono troca o preço dele. Quem roda precisa ver isso ANTES de gravar.
const semTabela = mover.filter((c) => !c.price_table_id);
if (semTabela.length) {
  const { data: tabelas } = await db.from('price_tables').select('id, name').eq('company_id', EMPRESA);
  const nomeTab = (id) => tabelas?.find((t) => t.id === id)?.name ?? 'NENHUMA';
  console.log(
    `\n⚠ ${semTabela.length} dos que vão mudar de dono NÃO têm tabela própria: ` +
      `passam a comprar pela tabela do destino (${nomeTab(destino.price_table_id)}).`,
  );
}
const comRepId = mover.filter((c) => c.rep_id);
if (comRepId.length) {
  console.log(
    `\n⚠ ${comRepId.length} tem "cadastrado por" no app: a carteira da tela é rep_id OU rep_erp_id, ` +
      `então quem cadastrou CONTINUA vendo o cliente depois da troca:`,
  );
  for (const c of comRepId) {
    const quem = (reps ?? []).find((r) => r.id === c.rep_id);
    console.log(`   ${c.name} — cadastrado por ${quem?.name ?? c.rep_id}`);
  }
}

if (!APLICAR) {
  console.log('\n(prévia — nada foi gravado. Rode com --aplicar para gravar.)');
  process.exit(0);
}

// ─── 5. Gravação ─────────────────────────────────────────────────────────────
// O Supabase já faz backup do banco (decisão de 03/11/2026), mas o estado
// ANTERIOR destas linhas vai para disco: é a lista exata para desfazer sem
// precisar de restore, e é pequena.
mkdirSync(path.join(RAIZ, 'backups'), { recursive: true });
const antes = path.join(
  RAIZ,
  'backups',
  `mover-carteira-${miolo(CODIGO)}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`,
);
writeFileSync(
  antes,
  JSON.stringify(
    mover.map((c) => ({ id: c.id, name: c.name, cnpj: c.cnpj, rep_erp_id: c.rep_erp_id, rep_id: c.rep_id })),
    null,
    1,
  ),
  'utf8',
);
console.log(`\nestado anterior ... ${antes} (${mover.length} linhas, com o dono de antes)`);

let movidos = 0;
let falhas = 0;
for (const c of mover) {
  const { error } = await db
    .from('customers')
    .update({ rep_erp_id: CODIGO, updated_at: new Date().toISOString() })
    .eq('id', c.id)
    .eq('company_id', EMPRESA);
  if (error) { falhas++; console.error(`   falhou ${c.name}: ${error.message}`); } else movidos++;
}
console.log(`MOVIDOS ........... ${movidos}  ·  falhas: ${falhas}`);
console.log(
  `\nO Control não sabe desta troca (o cadastro desta empresa não vem dele). ` +
    `A carteira de lá precisa ser mudada no Control também, senão a próxima carga devolve o cliente ao dono antigo.`,
);
