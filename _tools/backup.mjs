/**
 * Backup completo do banco em JSON.
 *
 * POR QUE ISTO EXISTE: o projeto está no plano Free do Supabase, que NÃO tem
 * backup automático. Um `DELETE` sem `WHERE` no SQL Editor, um sync com bug, ou
 * o projeto ser pausado por inatividade — em qualquer um desses casos, hoje, não
 * existe de onde restaurar.
 *
 * Catálogo, preços e clientes dá para reconstruir do ERP. O que NÃO dá:
 * pedidos, usuários, comissões e o vínculo representante↔carteira. É esse o
 * registro do negócio, e é ele que este script protege.
 *
 * Uso:
 *   pnpm backup                  → grava em ./backups/AAAA-MM-DD_HHMM/
 *   pnpm backup -- --dir=D:/bkp  → grava em outro lugar (pendrive, OneDrive…)
 *
 * O arquivo sai com os hashes de senha dentro: trate como dado sensível, não
 * jogue em pasta compartilhada pública.
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const RAIZ = path.resolve(import.meta.dirname, '..');
const ENV = path.join(RAIZ, 'apps/api/.env');

const require = createRequire(pathToFileURL(ENV));
const { createClient } = require('@supabase/supabase-js');

const env = {};
for (const linha of readFileSync(ENV, 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(linha.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Faltam SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY em apps/api/.env');
  process.exit(1);
}

const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Ordem importa na hora de restaurar: pai antes de filho (as FKs cobram isso).
const TABELAS = [
  'companies',
  'price_tables',
  'users',
  'customers',
  'products',
  'product_variants',
  'product_prices',
  'orders',
  'order_items',
  'erp_sync_log',
];

const PAGINA = 1000; // teto do PostgREST por requisição

async function baixarTudo(tabela) {
  const linhas = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await sb
      .from(tabela)
      .select('*')
      .range(de, de + PAGINA - 1);
    if (error) throw new Error(`${tabela}: ${error.message}`);
    linhas.push(...data);
    if (data.length < PAGINA) break;
  }
  return linhas;
}

const argDir = process.argv.find((a) => a.startsWith('--dir='))?.slice('--dir='.length);
const agora = new Date();
const carimbo = agora.toISOString().slice(0, 16).replace('T', '_').replace(':', '');
const destino = path.join(argDir ?? path.join(RAIZ, 'backups'), carimbo);
mkdirSync(destino, { recursive: true });

console.log(`Backup em ${destino}\n`);

const resumo = {};
let total = 0;
let falhou = false;

for (const tabela of TABELAS) {
  try {
    const linhas = await baixarTudo(tabela);
    writeFileSync(path.join(destino, `${tabela}.json`), JSON.stringify(linhas, null, 1), 'utf8');
    resumo[tabela] = linhas.length;
    total += linhas.length;
    console.log(`  ${tabela.padEnd(18)} ${String(linhas.length).padStart(6)} linhas`);
  } catch (err) {
    falhou = true;
    resumo[tabela] = `ERRO: ${err.message}`;
    console.error(`  ${tabela.padEnd(18)} FALHOU — ${err.message}`);
  }
}

writeFileSync(
  path.join(destino, '_resumo.json'),
  JSON.stringify({ gerado_em: agora.toISOString(), supabase_url: env.SUPABASE_URL, tabelas: resumo, total_linhas: total }, null, 2),
  'utf8',
);

console.log(`\n${total} linhas em ${TABELAS.length} tabelas.`);
if (falhou) {
  console.error('\nAlguma tabela falhou — o backup está INCOMPLETO. Não conte com ele.');
  process.exit(1);
}
console.log('Backup completo.');
