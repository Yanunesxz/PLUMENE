/**
 * A 049 (integração com o Control: as respostas) está visível para a API?
 *
 *   node _tools/conferir-049.mjs                     → banco deste app (apps/api/.env)
 *   node _tools/conferir-049.mjs <raiz da PLUMENE>   → banco da PLUMENE
 *
 * Como mede: GET de verdade com `?select=<coluna>&limit=0` — a mesma pergunta
 * que o detectar() da API faz, sem trazer linha nenhuma. NUNCA HEAD: a
 * conferência por HEAD disse "aplicada" com a 046 ausente (15/09/2026).
 *
 * Travas, índices e o CHECK novo de order_erp_events.tipo não aparecem pela
 * API: as consultas para o SQL Editor estão no fim de
 * apps/api/src/config/migrations/049_integracao_control_respostas.sql.
 * tests/migracao-049.test.ts confere que a lista abaixo é a mesma que a
 * migração acrescenta.
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
  // A — pedido solicitado ao Control
  orders: ['erp_requested_at', 'erp_requested_by'],
  // B — e-mail do representante no Control
  users: ['erp_email'],
  // C — nota substituída
  order_invoices: ['substituida_por', 'substituida_em'],
  // D — sincronização pedida à mão
  companies: ['sync_solicitado_em', 'sync_solicitado_por'],
  // E — carimbo do Control, retrato e pendência financeira do cliente
  customers: [
    'erp_updated_at', 'retrato_referencia_em', 'pendencia_financeira',
    'pendencia_financeira_em', 'titulos_vencidos',
  ],
  // F — tabelas de preço e condições de pagamento como o Control manda
  price_tables: ['erp_description', 'erp_updated_at', 'active'],
  payment_conditions: ['erp_description', 'erp_updated_at', 'valor_minimo'],
  // G — catálogo, preço e estoque com o carimbo do Control
  products: ['erp_updated_at'],
  product_variants: ['stock_updated_at'],
  product_prices: ['erp_updated_at', 'preco_original', 'desconto_percentual'],
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

console.log('');
if (faltas === 0 && erros === 0) {
  console.log('049 visível para a API neste banco.');
  console.log('O CHECK novo de order_erp_events.tipo só se confere no SQL Editor (fim da migração).');
} else {
  console.log(`049 INCOMPLETA neste banco: ${faltas} faltando, ${erros} com erro.`);
  console.log("Se acabou de colar o SQL, confira se ele terminou com NOTIFY pgrst, 'reload schema'.");
  console.log('Se o SQL parou logo no começo, a 048 ainda não rodou neste banco: cole-a antes.');
  process.exitCode = 1;
}
