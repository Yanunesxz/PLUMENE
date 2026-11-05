/**
 * A 057 (fracionamento de pedidos: orders.split_group_id/split_index/
 * split_count/ship_date/split_at/split_by) está visível para a API — nos DOIS
 * bancos?
 *
 *   node _tools/conferir-057.mjs                         → Corpo Sensual (apps/api/.env deste app)
 *                                                          e PLUMENE (C:/Users/Yan/Desktop/PLUMENE)
 *   node _tools/conferir-057.mjs <raiz> [<raiz> …]       → só as instalações dadas
 *
 * Como mede: GET de verdade com `?select=<coluna>&limit=0` — a mesma pergunta
 * que o detectar() da API faz, sem trazer linha nenhuma. NUNCA HEAD: a
 * conferência por HEAD engole o PGRST205 e disse "aplicada" com a 046 ausente
 * (15/09/2026).
 *
 * Os dois índices parciais e a trava chk_orders_fracionamento não aparecem
 * pela API: as consultas para o SQL Editor estão no fim de
 * apps/api/src/config/migrations/057_fracionamento_de_pedidos.sql.
 * tests/migracao-057.test.ts confere que a lista abaixo é a mesma que a
 * migração cria.
 *
 * Só lê. Não imprime dado de pedido (limit 0: nenhuma linha volta).
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const PADRAO = [
  { marca: 'Corpo Sensual', raiz: path.resolve(import.meta.dirname, '..') },
  { marca: 'PLUMENE', raiz: 'C:/Users/Yan/Desktop/PLUMENE' },
];
const instalacoes = process.argv.length > 2
  ? process.argv.slice(2).map((raiz) => ({ marca: raiz, raiz }))
  : PADRAO;

const AUSENCIA = ['42703', '42P01', 'PGRST204', 'PGRST205'];

const colunas = {
  // A — as entregas do pedido fracionado
  orders: ['split_group_id', 'split_index', 'split_count', 'ship_date', 'split_at', 'split_by'],
};

/** Confere uma instalação. Devolve true quando a 057 está inteira e visível. */
async function conferir({ marca, raiz }) {
  console.log(`\n── ${marca}`);
  const envPath = path.join(raiz, 'apps/api/.env');
  if (!existsSync(envPath)) {
    console.log('  SEM .env em', envPath);
    return false;
  }
  const require = createRequire(pathToFileURL(envPath));
  const { createClient } = require('@supabase/supabase-js');
  const env = {};
  for (const l of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = l.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  console.log('  banco:', env.SUPABASE_URL);

  let faltas = 0;
  let erros = 0;
  for (const [tabela, lista] of Object.entries(colunas)) {
    for (const coluna of lista) {
      // limit(0): o PostgREST responde a pergunta sobre o schema sem devolver linha.
      const { error } = await db.from(tabela).select(coluna).limit(0);
      if (!error) {
        console.log(`  OK    ${tabela}.${coluna}`);
      } else if (AUSENCIA.includes(error.code ?? '')) {
        faltas++;
        console.log(`  FALTA ${tabela}.${coluna} (${error.code})`);
      } else {
        erros++;
        console.log(`  ERRO  ${tabela}.${coluna} (${error.code ?? '?'}): ${error.message}`);
      }
    }
  }

  if (faltas === 0 && erros === 0) {
    console.log('  057 visível para a API neste banco.');
    return true;
  }
  console.log(`  057 INCOMPLETA neste banco: ${faltas} faltando, ${erros} com erro.`);
  console.log("  Se acabou de colar o SQL, confira se ele terminou com NOTIFY pgrst, 'reload schema'.");
  return false;
}

let tudoCerto = true;
for (const instalacao of instalacoes) {
  if (!(await conferir(instalacao))) tudoCerto = false;
}

console.log('');
if (tudoCerto) {
  console.log('057 visível para a API em todos os bancos conferidos.');
  console.log('Os índices parciais e a trava do fracionamento só se conferem no SQL Editor (fim da migração).');
} else {
  console.log('A 057 NÃO está completa em todos os bancos: cole _tools/SQL-PARA-RODAR-057.sql onde faltou.');
  process.exitCode = 1;
}
