/**
 * Carimba pedidos como FATURADOS em uma data passada.
 *
 * Existe por um motivo específico (Yan, 01/09/2026): pedidos que a fábrica
 * faturou no mês passado ficaram sem o carimbo no app. Marcá-los hoje pelo
 * botão jogaria o valor no "Faturado no mês" DESTE mês — mês que não é o
 * dele. Aqui a data entra à mão, e o valor cai no mês certo.
 *
 * A soma da Minha Área usa `invoiced_at` (não a data do pedido), então o
 * retroativo já sai fora do mês corrente sem mais nada.
 *
 * Também empurra `customers.last_purchase_at` (só PARA FRENTE), do mesmo jeito
 * que a rota de faturamento faz — a carteira não pode ficar mentindo.
 *
 * Uso:
 *   listar candidatos (sem faturar) de um representante:
 *     node faturar-retroativo.mjs --empresa=<uuid> --rep 04518 --listar
 *   carimbar pedidos numa data:
 *     node faturar-retroativo.mjs --empresa=<uuid> --rep 04518 --data 2026-08-29 --pedidos 14550,14551 [--aplicar]
 *
 * Sem --aplicar é ENSAIO: só conta o que faria e não escreve nada.
 *
 * Travas (fase 0 da integração com o Control):
 *   - `--empresa=<uuid>` é obrigatório e toda leitura e gravação filtra por ela
 *     (o banco da Corpo Sensual tem duas empresas; antes a empresa era fixa).
 *   - Recusa rodar quando `companies.canal_faturamento` da empresa é 'api': aí o
 *     faturado vem do Control pela API e um carimbo à mão seria um segundo
 *     escritor. Sem a migração 048 (coluna ausente) vale 'manual', como hoje.
 *   - Não imprime nome de representante, de cliente nem valor: só código,
 *     número do pedido, data e contagens.
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const RAIZ = path.resolve(import.meta.dirname, '..');
const require = createRequire(pathToFileURL(path.join(RAIZ, 'apps/api/.env')));
const { createClient } = require('@supabase/supabase-js');

/** `--nome=valor` ou `--nome valor`. */
const arg = (nome) => {
  const comIgual = process.argv.find((a) => a.startsWith(`--${nome}=`));
  if (comIgual) return comIgual.slice(nome.length + 3).trim() || null;
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};
const APLICAR = process.argv.includes('--aplicar');
const LISTAR = process.argv.includes('--listar');
const EMPRESA = arg('empresa');
const codigoRep = arg('rep');
const data = arg('data');
const pedidosArg = arg('pedidos');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!EMPRESA || !UUID.test(EMPRESA)) {
  console.error('Falta --empresa=<uuid> (a empresa dos pedidos; o banco pode ter mais de uma).');
  process.exit(1);
}
if (!codigoRep) {
  console.error('Falta --rep CODIGO (ex.: --rep 04518)');
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

const miolo = (v) => String(v ?? '').replace(/\D/g, '').replace(/^0+/, '');
const dia = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—');
const agoraIso = () => new Date().toISOString();

// ─── A empresa e o canal do faturamento ──────────────────────────────────────
const { data: empresa, error: erroEmpresa } = await db
  .from('companies')
  .select('id')
  .eq('id', EMPRESA)
  .maybeSingle();
if (erroEmpresa) {
  console.error(`❌ Falha ao conferir a empresa: ${erroEmpresa.message}`);
  process.exit(1);
}
if (!empresa) {
  console.error('❌ Empresa não encontrada neste banco.');
  process.exit(1);
}

const { data: canal, error: erroCanal } = await db
  .from('companies')
  .select('canal_faturamento')
  .eq('id', EMPRESA)
  .maybeSingle();
if (erroCanal) {
  const semColuna = erroCanal.code === '42703' || erroCanal.code === 'PGRST204'
    || /does not exist|schema cache/i.test(erroCanal.message ?? '');
  if (!semColuna) {
    // Não deu para saber o canal: na dúvida, não carimba.
    console.error(`❌ Falha ao ler o canal do faturamento: ${erroCanal.message}`);
    process.exit(1);
  }
  // Sem a 048: canal 'manual', o comportamento de hoje.
} else if (canal?.canal_faturamento === 'api') {
  console.error(
    '❌ O faturamento desta empresa vem do Control pela API (canal_faturamento=api). ' +
      'Carimbo retroativo à mão está recusado — o pedido fica faturado quando o Control mandar a nota.',
  );
  process.exit(1);
}

// ─── O representante ─────────────────────────────────────────────────────────
const { data: reps, error: erroReps } = await db
  .from('users')
  .select('id, erp_rep_id, venda_interna')
  .eq('company_id', EMPRESA)
  .eq('role', 'rep');
if (erroReps) {
  console.error(`❌ Falha ao ler os representantes: ${erroReps.message}`);
  process.exit(1);
}
const rep = (reps ?? []).find((u) => miolo(u.erp_rep_id) === miolo(codigoRep));
if (!rep) {
  console.error(`❌ Nenhum representante com código ${codigoRep} nesta empresa.`);
  process.exit(1);
}
console.log(`Representante: código ${rep.erp_rep_id}${rep.venda_interna ? ' · venda interna' : ''}\n`);

// ─── Os pedidos dele ─────────────────────────────────────────────────────────
const { data: pedidos, error: erroPedidos } = await db
  .from('orders')
  .select('id, order_number, status, invoiced, invoiced_at, created_at, customer_id')
  .eq('company_id', EMPRESA)
  .eq('rep_id', rep.id)
  .order('order_number', { ascending: true });
if (erroPedidos) {
  console.error(`❌ Falha ao ler os pedidos: ${erroPedidos.message}`);
  process.exit(1);
}

if (LISTAR) {
  const agora = new Date();
  const inicioDoMes = new Date(agora.getFullYear(), agora.getMonth(), 1);
  const candidatos = (pedidos ?? []).filter(
    (o) => !o.invoiced && new Date(o.created_at) < inicioDoMes && o.status !== 'rejected',
  );
  console.log(`SEM CARIMBO e de antes deste mês (${candidatos.length}):\n`);
  for (const o of candidatos) {
    console.log(`  #${o.order_number ?? o.id.slice(0, 8)} | ${dia(o.created_at)} | ${o.status}`);
  }
  const jaFaturados = (pedidos ?? []).filter((o) => o.invoiced).length;
  console.log(`\nTotal de pedidos dele: ${pedidos?.length ?? 0} · já faturados: ${jaFaturados}`);
  process.exit(0);
}

// ─── Carimbar ────────────────────────────────────────────────────────────────
if (!data || !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
  console.error('Falta --data AAAA-MM-DD (ex.: --data 2026-08-29)');
  process.exit(1);
}
if (!pedidosArg) {
  console.error('Falta --pedidos 14550,14551 (números do pedido, separados por vírgula)');
  process.exit(1);
}
// Meio-dia UTC (9h em Brasília): fuso não empurra o carimbo para o dia (nem o
// mês) vizinho, e o dia da compra é o próprio `--data`.
const quando = new Date(`${data}T12:00:00.000Z`).toISOString();
const diaDaCompra = data;
const numeros = pedidosArg.split(',').map((n) => Number(String(n).replace(/\D/g, ''))).filter(Boolean);

console.log(`Data do faturamento: ${dia(quando)}  (${numeros.length} pedido(s) pedidos)\n`);

let ok = 0;
let clientesAvancados = 0;
const problemas = [];
const clientesDaRodada = new Set();
for (const numero of numeros) {
  const o = (pedidos ?? []).find((p) => p.order_number === numero);
  if (!o) { problemas.push(`#${numero}: não é pedido deste representante`); continue; }
  if (o.invoiced) { problemas.push(`#${numero}: JÁ faturado em ${dia(o.invoiced_at)} — não mexi`); continue; }

  if (!APLICAR) {
    ok++;
    if (o.customer_id) clientesDaRodada.add(o.customer_id);
    continue;
  }

  // `invoiced=false` no filtro: se alguém faturou no meio do caminho, não regrava.
  const { data: gravados, error } = await db
    .from('orders')
    .update({ invoiced: true, invoiced_at: quando, updated_at: agoraIso() })
    .eq('id', o.id)
    .eq('company_id', EMPRESA)
    .eq('invoiced', false)
    .select('id');
  if (error) { problemas.push(`#${numero}: falha ao gravar (${error.message})`); continue; }
  if (!gravados || gravados.length === 0) {
    problemas.push(`#${numero}: faturado por outro caminho durante a rodada — não mexi`);
    continue;
  }
  ok++;

  // A carteira acompanha: última compra só anda para frente (o filtro fica no
  // próprio update, então duas rodadas não recuam a data).
  if (o.customer_id) {
    const { data: avancados, error: erroCliente } = await db
      .from('customers')
      .update({ last_purchase_at: diaDaCompra, updated_at: agoraIso() })
      .eq('id', o.customer_id)
      .eq('company_id', EMPRESA)
      .or(`last_purchase_at.is.null,last_purchase_at.lt.${diaDaCompra}`)
      .select('id');
    if (erroCliente) {
      problemas.push(`#${numero}: pedido carimbado, mas a última compra do cliente não gravou (${erroCliente.message})`);
    } else if (avancados && avancados.length > 0) {
      clientesAvancados++;
    }
  }
}

if (APLICAR) {
  console.log(`\nFEITO: ${ok} pedido(s) carimbado(s); última compra avançada em ${clientesAvancados} cliente(s).`);
} else {
  console.log(
    `\nENSAIO (nada gravado — rode com --aplicar): ${ok} pedido(s) seriam carimbados, ` +
      `de ${clientesDaRodada.size} cliente(s).`,
  );
}
if (problemas.length) {
  console.log('\nAtenção:');
  for (const p of problemas) console.log('  - ' + p);
}
