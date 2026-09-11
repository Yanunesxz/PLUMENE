/**
 * O retrato do cadastro antes/depois da migração 041: quantos clientes têm
 * código do ERP, quantos têm endereço, quantos têm CPF/CNPJ inválido ou
 * repetido. É o que diz se o selo "Sem código no ERP" vira sinal ou ruído.
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
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

// A mesma régua do app (packages/shared/src/cadastro/documento.ts), copiada
// aqui porque o script roda fora do bundle.
const digitos = (v) => (v ?? '').replace(/\D/g, '');
const iguais = (d) => /^(\d)\1+$/.test(d);
function cpfOk(d) {
  if (d.length !== 11 || iguais(d)) return false;
  const dv = (n) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}
function cnpjOk(d) {
  if (d.length !== 14 || iguais(d)) return false;
  const dv = (n) => {
    const p = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(d[i]) * p[i];
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(d[12]) && dv(13) === Number(d[13]);
}
const docOk = (v) => {
  const d = digitos(v);
  return (d.length === 11 && cpfOk(d)) || (d.length === 14 && cnpjOk(d));
};

const clientes = [];
for (let de = 0; ; de += 1000) {
  const { data, error } = await db
    .from('customers')
    .select('id, name, cnpj, erp_id, rep_id, rep_erp_id, address')
    .eq('company_id', EMPRESA)
    .range(de, de + 999);
  if (error) { console.error('❌', error.message); process.exit(1); }
  clientes.push(...(data ?? []));
  if (!data || data.length < 1000) break;
}

const semCodigo = clientes.filter((c) => !c.erp_id);
const nascidosNoApp = semCodigo.filter((c) => c.rep_id);
const semCodigoNemRep = semCodigo.filter((c) => !c.rep_id);
const semDoc = clientes.filter((c) => !digitos(c.cnpj));
const docInvalido = clientes.filter((c) => digitos(c.cnpj) && !docOk(c.cnpj));
const semEndereco = clientes.filter((c) => !(c.address ?? '').trim());

const porDoc = new Map();
for (const c of clientes) {
  const d = digitos(c.cnpj);
  if (!d) continue;
  porDoc.set(d, [...(porDoc.get(d) ?? []), c]);
}
const repetidos = [...porDoc.entries()].filter(([, l]) => l.length > 1);

const pct = (n) => `${((n / clientes.length) * 100).toFixed(1)}%`;
console.log(`Clientes: ${clientes.length}\n`);
console.log(`Com código do ERP:            ${clientes.length - semCodigo.length} (${pct(clientes.length - semCodigo.length)})`);
console.log(`SEM código do ERP:            ${semCodigo.length} (${pct(semCodigo.length)})`);
console.log(`   ├─ cadastrados no app:     ${nascidosNoApp.length}`);
console.log(`   └─ vindos das cargas ABC:  ${semCodigoNemRep.length}`);
console.log(`\nSem CPF/CNPJ nenhum:          ${semDoc.length} (${pct(semDoc.length)})`);
console.log(`Com CPF/CNPJ INVÁLIDO:        ${docInvalido.length} (${pct(docInvalido.length)})`);
console.log(`Sem endereço:                 ${semEndereco.length} (${pct(semEndereco.length)})`);
console.log(`Documentos repetidos:         ${repetidos.length} (${repetidos.reduce((s, [, l]) => s + l.length, 0)} cadastros)`);

if (docInvalido.length) {
  console.log('\nPrimeiros com documento inválido:');
  for (const c of docInvalido.slice(0, 10)) console.log(`  ${c.name} | ${c.cnpj} | ${c.erp_id ?? 'sem código'}`);
}
if (repetidos.length) {
  console.log('\nPrimeiros documentos repetidos:');
  for (const [d, l] of repetidos.slice(0, 10)) {
    console.log(`  ${d}: ${l.map((c) => `${c.name}${c.erp_id ? ` (${c.erp_id})` : ''}`).join(' / ')}`);
  }
}
