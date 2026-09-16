import { supabase } from '../../config/supabase.js';
import { detectar } from '../../lib/detectarColuna.js';
import { registrarEventoErp } from './eventosErp.service.js';

/**
 * O CONTROL EXCLUIU O PEDIDO — e o app exclui também (decisão de 16/09/2026).
 *
 * Pedido com número do Control não pode ser apagado pela tela (nem pelo
 * admin): apagar aqui deixaria o Control com um pedido que o app não conhece
 * mais. O caminho inverso é este: quando o Control exclui do lado dele, avisa
 * por POST /partner/v1/pedidos/:id/excluir e o app apaga — com a cópia em
 * `deleted_orders` (040) NO MESMO FORMATO que o `deleteOrder` da tela guarda
 * (a aba "Excluídos" do admin lê as duas), `deleted_by_name` = o nome do
 * parceiro, e o evento 'excluido' (048) com origem 'api', o parceiro e o
 * motivo — como a decisão 12 manda. ('excluido_pelo_erp' só existe no CHECK
 * depois da 049: num banco com a 048 e sem a 049 o rastro de uma exclusão feita
 * por sistema externo seria recusado e sumiria.)
 *
 * SÓ o que o Control TEM (revisão de 16/09/2026): pedido com número do
 * Control, ou solicitado ao Control pelo financeiro (049 — o Control pode tê-lo
 * importado e excluído antes de confirmar). Rascunho, pedido aguardando aceite,
 * aprovado nunca solicitado, pedido da loja ou da vitrine: o Control nunca os
 * recebeu, e uma chave vazada, um id trocado ou um laço errado no robô não
 * apaga pedido de representante — 409 ORDER_NOT_IN_CONTROL.
 *
 * Pedido FATURADO não é apagado: tem nota e conta como venda; o Control
 * desfaz o faturamento antes (POST /faturamento com "faturado": false).
 *
 * O DELETE repete as condições (não faturado e ainda no Control): um
 * faturamento que chegue entre a leitura e a exclusão não é apagado. Nesse
 * caso a cópia recém-gravada sai do histórico — o pedido continua existindo.
 *
 * Com a tabela da 040 no ar, a cópia é obrigatória: não gravou, não apaga —
 * é exatamente o "sumiu sem rastro" que a 040 existe para evitar. Sem a
 * tabela (migração ainda não rodada), exclui como a tela sempre excluiu.
 */

export type ExclusaoPeloControl =
  | { outcome: 'ok'; excluido_em: string; numero: number | null; pedido_erp: string | null }
  | { outcome: 'not_found' }
  | { outcome: 'faturado' }
  /** Sem número do Control e não solicitado: o Control nunca recebeu este pedido. */
  | { outcome: 'fora_do_control' }
  | { outcome: 'sem_copia' }
  | { outcome: 'falhou'; erro: string };

/** Postgres: "invalid input syntax for type uuid" — o id não tem forma de id. */
const ID_MALFORMADO = '22P02';

/**
 * A cópia leva o que a aba precisa mostrar sem consultar mais nada: as peças
 * já com referência e tamanho, o cliente e o representante — porque, depois
 * do DELETE, os itens não existem mais para serem resolvidos. É a MESMA
 * seleção de orders.service.ts (guardarCopiaAntesDeExcluir).
 */
const COLUNAS_DA_COPIA =
  '*, items:order_items(*, product:products(sku, name), variant:product_variants(size)), ' +
  'customer:customers(name, cnpj), rep:users!orders_rep_id_fkey(name)';

interface PedidoLido {
  id: string;
  order_number?: number | null;
  status?: string | null;
  invoiced?: boolean | null;
  erp_order_id?: string | null;
  /** 049. Ausente (a chave nem vem) em banco sem a coluna. */
  erp_requested_at?: string | null;
}

type ResultadoDaCopia = 'guardada' | 'sem_tabela' | 'falhou';

async function guardarCopia(pedido: PedidoLido, company_id: string, parceiro: string | null): Promise<ResultadoDaCopia> {
  if (!(await detectar('deleted_orders', 'id'))) return 'sem_tabela';

  // O select rico depende dos embeds; se algum faltar (banco antigo), a cópia
  // sai sem eles — melhor um retrato incompleto do que nenhum.
  let snapshot: unknown = null;
  const rico = await supabase
    .from('orders')
    .select(COLUNAS_DA_COPIA)
    .eq('id', pedido.id)
    .eq('company_id', company_id)
    .maybeSingle();
  if (!rico.error && rico.data) {
    snapshot = rico.data;
  } else {
    const simples = await supabase
      .from('orders')
      .select('*, items:order_items(*)')
      .eq('id', pedido.id)
      .eq('company_id', company_id)
      .maybeSingle();
    snapshot = simples.data ?? null;
  }
  if (!snapshot) return 'falhou';

  const { error } = await supabase.from('deleted_orders').insert({
    company_id,
    order_id: pedido.id,
    order_number: pedido.order_number ?? null,
    // Não há login por trás: quem apagou foi o parceiro, pelo nome.
    deleted_by: null,
    deleted_by_name: parceiro,
    snapshot,
  });
  return error ? 'falhou' : 'guardada';
}

/** Lê o pedido dentro da empresa. `*`: traz `erp_requested_at` só onde a 049 existe, sem sonda. */
async function lerPedido(
  company_id: string,
  order_id: string,
): Promise<{ pedido: PedidoLido | null } | { erro: string }> {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('id', order_id)
    .eq('company_id', company_id)
    .maybeSingle();
  // Id sem forma de UUID é "não existe", não "falhou".
  if (error && (error as { code?: string }).code !== ID_MALFORMADO) return { erro: error.message };
  return { pedido: (data as PedidoLido | null) ?? null };
}

/** O Control tem este pedido? Número dele, ou solicitado pelo financeiro (049). */
const estaNoControl = (p: PedidoLido): boolean => Boolean(p.erp_order_id) || Boolean(p.erp_requested_at);

/** O desfecho de recusa pelo estado do pedido; `null` = pode apagar. */
function recusaPeloEstado(p: PedidoLido): ExclusaoPeloControl | null {
  if (p.invoiced === true) return { outcome: 'faturado' };
  if (!estaNoControl(p)) return { outcome: 'fora_do_control' };
  return null;
}

export async function excluirPedidoPeloControl(
  company_id: string,
  order_id: string,
  parceiro: string | null,
  motivo: string | null,
): Promise<ExclusaoPeloControl> {
  // Sempre dentro da empresa da chave: um parceiro nunca apaga pedido de outra
  // fábrica, mesmo acertando o id por acaso.
  const leitura = await lerPedido(company_id, order_id);
  if ('erro' in leitura) return { outcome: 'falhou', erro: `falha ao buscar: ${leitura.erro}` };
  const pedido = leitura.pedido;
  if (!pedido) return { outcome: 'not_found' };
  const recusa = recusaPeloEstado(pedido);
  if (recusa) return recusa;

  const copia = await guardarCopia(pedido, company_id, parceiro);
  if (copia === 'falhou') return { outcome: 'sem_copia' };

  // Só o pedido: order_items, as notas (048) e a foto (046) têm ON DELETE
  // CASCADE. Apagar as peças numa chamada separada deixava, se o DELETE do
  // pedido falhasse, um pedido sem peças. As condições da leitura vão junto.
  const colunaNoControl = pedido.erp_order_id ? 'erp_order_id' : 'erp_requested_at';
  const { data: apagados, error } = await supabase
    .from('orders')
    .delete()
    .eq('id', pedido.id)
    .eq('company_id', company_id)
    .or('invoiced.is.null,invoiced.eq.false')
    .not(colunaNoControl, 'is', null)
    .select('id');
  if (error) {
    await tirarCopia(company_id, pedido.id, copia);
    return { outcome: 'falhou', erro: `falha ao apagar: ${error.message}` };
  }

  if (Array.isArray(apagados) && apagados.length === 0) {
    // Alguém mexeu entre a leitura e a exclusão (faturou, por exemplo): o
    // pedido continua existindo, então a cópia não pode ficar no histórico.
    await tirarCopia(company_id, pedido.id, copia);
    const relida = await lerPedido(company_id, order_id);
    if ('erro' in relida) return { outcome: 'falhou', erro: `falha ao reler: ${relida.erro}` };
    if (!relida.pedido) return { outcome: 'not_found' };
    return recusaPeloEstado(relida.pedido) ?? { outcome: 'falhou', erro: 'nenhuma linha apagada' };
  }

  const agora = new Date().toISOString();
  // O rastro sobrevive à exclusão (order_erp_events não tem FK para orders).
  await registrarEventoErp({
    company_id,
    order_id: pedido.id,
    order_number: pedido.order_number ?? null,
    tipo: 'excluido',
    origem: 'api',
    parceiro,
    motivo,
    antes: { erp_order_id: pedido.erp_order_id ?? null, status: pedido.status ?? null },
    depois: null,
  });

  return {
    outcome: 'ok',
    excluido_em: agora,
    numero: pedido.order_number ?? null,
    pedido_erp: pedido.erp_order_id ?? null,
  };
}

/**
 * A cópia gravada para um pedido que NÃO foi apagado sai do histórico — senão
 * a aba "Excluídos" e o GET /partner/v1/pedidos/excluidos mostrariam como
 * excluído um pedido que continua de pé. Só as cópias deste pedido, nesta
 * empresa; o pedido existe, então nenhuma delas é de uma exclusão de verdade.
 */
async function tirarCopia(company_id: string, order_id: string, copia: ResultadoDaCopia): Promise<void> {
  if (copia !== 'guardada') return;
  const { error } = await supabase
    .from('deleted_orders')
    .delete()
    .eq('company_id', company_id)
    .eq('order_id', order_id);
  if (error) {
    console.error(`[excluir-pelo-control] cópia do pedido ${order_id} ficou no histórico sem exclusão: ${error.message}`);
  }
}
