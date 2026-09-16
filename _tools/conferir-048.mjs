/**
 * A 048 (integração com o Control, fase 0) está visível para a API?
 *
 *   node _tools/conferir-048.mjs                     → banco deste app (apps/api/.env)
 *   node _tools/conferir-048.mjs <raiz da PLUMENE>   → banco da PLUMENE
 *
 * Como mede: GET de verdade com `?select=<coluna>&limit=0` — a mesma pergunta
 * que o detectar() da API faz, sem trazer linha nenhuma. NUNCA HEAD: a
 * conferência por HEAD disse "aplicada" com a 046 ausente (15/09/2026).
 *
 * A função public.codigo_miolo é conferida por GET em /rpc (só calcula, não lê
 * tabela) contra os mesmos casos de tests/codigo-miolo.test.ts. Travas e
 * índices não aparecem pela API: as consultas para o SQL Editor estão no fim de
 * apps/api/src/config/migrations/048_integracao_control_fase_0.sql.
 *
 * Só lê. Não imprime dado de cliente.
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const RAIZ = process.argv[2] ?? path.resolve(import.meta.dirname, '..');
const envPath = path.join(RAIZ, 'apps/api/.env');
if (!existsSync(envPath)) {
  console.log('SEM .env em', envPath);
  process.exit(1);
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

console.log('banco:', env.SUPABASE_URL);

const AUSENCIA = ['42703', '42P01', 'PGRST204', 'PGRST205'];

const colunas = {
  // A — registro das chamadas do parceiro
  erp_sync_log: [
    'parceiro', 'rota', 'metodo', 'http_status', 'recebidos', 'gravados',
    'sem_mudanca', 'ignorados', 'detalhe', 'created_at', 'updated_at',
  ],
  // B — canal oficial por empresa
  companies: [
    'canal_pedido_erp', 'canal_faturamento', 'canal_cadastro', 'canal_retrato',
    'canal_catalogo', 'canais_atualizados_em',
  ],
  // C — origem do número do Control
  orders: ['erp_order_source', 'erp_order_set_at', 'erp_order_set_by'],
  // D — rastro do pedido com o Control
  order_erp_events: [
    'id', 'company_id', 'order_id', 'order_number', 'tipo', 'origem', 'parceiro',
    'por', 'por_nome', 'motivo', 'antes', 'depois', 'created_at', 'updated_at',
  ],
  // H — users.updated_at
  users: ['updated_at'],
  // N — notas e itens faturados
  order_invoices: [
    'id', 'company_id', 'order_id', 'numero', 'serie', 'chave', 'emitida_em',
    'valor', 'cancelada_em', 'origem', 'created_at', 'updated_at',
  ],
  order_invoice_items: [
    'id', 'company_id', 'invoice_id', 'order_id', 'produto', 'tamanho', 'variant_id',
    'quantidade', 'preco_unitario', 'created_at', 'updated_at',
  ],
};

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

// F — a função do miolo, pelos mesmos casos do teste de paridade.
const casosDoMiolo = [
  ['#02225', '2225'],
  [' 02225 ', '2225'],
  ['cs779', 'CS779'],
  ['CS 779', 'CS779'],
  ['0A1', 'A1'],
  ['000', '0'],
  ['#', null],
  ['', null],
];
for (const [entrada, esperado] of casosDoMiolo) {
  const { data, error } = await db.rpc('codigo_miolo', { t: entrada }, { get: true });
  const rotulo = `codigo_miolo(${JSON.stringify(entrada)})`;
  if (error) {
    const ausente = AUSENCIA.includes(error.code ?? '') || error.code === 'PGRST202';
    if (ausente) faltas++;
    else erros++;
    console.log(`  ${ausente ? 'FALTA' : 'ERRO '} ${rotulo} (${error.code ?? '?'}): ${error.message}`);
  } else if (data !== esperado) {
    erros++;
    console.log(`  DIFERENTE ${rotulo}: esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(data)}`);
  } else {
    console.log(`  OK    ${rotulo} = ${JSON.stringify(data)}`);
  }
}

console.log('');
if (faltas === 0 && erros === 0) {
  console.log('048 visível para a API neste banco.');
} else {
  console.log(`048 INCOMPLETA neste banco: ${faltas} faltando, ${erros} com erro.`);
  console.log("Se acabou de colar o SQL, confira se ele terminou com NOTIFY pgrst, 'reload schema'.");
  process.exitCode = 1;
}
