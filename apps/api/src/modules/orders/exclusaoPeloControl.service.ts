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
 * parceiro, e o evento 'excluido_pelo_erp' (049) com o motivo.
 *
 * Pedido FATURADO não é apagado: tem nota e conta como venda; o Control
 * desfaz o faturamento antes (POST /faturamento com "faturado": false).
 *
 * Com a tabela da 040 no ar, a cópia é obrigatória: não gravou, não apaga —
 * é exatamente o "sumiu sem rastro" que a 040 existe para evitar. Sem a
 * tabela (migração ainda não rodada), exclui como a tela sempre excluiu.
 */

export type ExclusaoPeloControl =
  | { outcome: 'ok'; excluido_em: string; numero: number | null; pedido_erp: string | null }
  | { outcome: 'not_found' }
  | { outcome: 'faturado' }
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

export async function excluirPedidoPeloControl(
  company_id: string,
  order_id: string,
  parceiro: string | null,
  motivo: string | null,
): Promise<ExclusaoPeloControl> {
  // Sempre dentro da empresa da chave: um parceiro nunca apaga pedido de outra
  // fábrica, mesmo acertando o id por acaso.
  const { data, error: erroBusca } = await supabase
    .from('orders')
    .select('id, order_number, status, invoiced, erp_order_id')
    .eq('id', order_id)
    .eq('company_id', company_id)
    .maybeSingle();
  // Id sem forma de UUID é "não existe", não "falhou".
  if (erroBusca && (erroBusca as { code?: string }).code !== ID_MALFORMADO) {
    return { outcome: 'falhou', erro: `falha ao buscar: ${erroBusca.message}` };
  }
  if (!data) return { outcome: 'not_found' };
  const pedido = data as PedidoLido;
  if (pedido.invoiced === true) return { outcome: 'faturado' };

  const copia = await guardarCopia(pedido, company_id, parceiro);
  if (copia === 'falhou') return { outcome: 'sem_copia' };

  // As peças antes do pedido (order_items tem ON DELETE CASCADE, mas apagar
  // explicitamente não depende disso); as notas (048) caem em cascata. A
  // empresa já foi conferida no pedido — order_items não tem company_id.
  const itens = await supabase.from('order_items').delete().eq('order_id', pedido.id);
  if (itens.error) return { outcome: 'falhou', erro: `falha ao apagar as peças: ${itens.error.message}` };
  const { error } = await supabase.from('orders').delete().eq('id', pedido.id).eq('company_id', company_id);
  if (error) return { outcome: 'falhou', erro: `falha ao apagar: ${error.message}` };

  const agora = new Date().toISOString();
  // O rastro sobrevive à exclusão (order_erp_events não tem FK para orders).
  await registrarEventoErp({
    company_id,
    order_id: pedido.id,
    order_number: pedido.order_number ?? null,
    tipo: 'excluido_pelo_erp',
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
