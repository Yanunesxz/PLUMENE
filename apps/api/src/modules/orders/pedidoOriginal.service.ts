import { supabase } from '../../config/supabase.js';
import { detectar, detectarComCerteza } from '../../lib/detectarColuna.js';
import type { Order, PedidoOriginal } from '@csb/shared';

/**
 * A CÓPIA DO PEDIDO ORIGINAL (migração 044).
 *
 * Pedido do Yan (11/09/2026): "o pedido original vem montado mas depois que a
 * gente fatura pode tirar algumas peças que não temos e o pedido vem com
 * menos; precisamos deixar uma cópia do pedido original e como que o pedido
 * foi faturado".
 *
 * A regra é uma só: a foto é tirada UM INSTANTE ANTES do primeiro corte, e
 * nunca mais. Rascunho não entra — enquanto o pedido está sendo montado, cada
 * mudança é a própria montagem, não um corte. O "como foi faturado" não
 * precisa de cópia: depois do carimbo o pedido não muda mais.
 */

/** `order_originals` vem da 044 — o código sobe antes do SQL, como sempre. */
async function detectarTabela(): Promise<boolean> {
  return detectar('order_originals', 'order_id');
}

/**
 * O select rico: as peças já com referência e tamanho, para a tela não
 * depender de um produto que pode ser renomeado (ou sair do catálogo) depois.
 *
 * `erp_id` vai junto porque é o código que o Control usa nos itens da nota
 * (048): sem ele, a peça faturada de um produto cujo `sku` difere do `erp_id`
 * não casaria com a linha do original. `erp_id` existe em `products` desde a
 * 001, então pedi-lo não arrisca o select.
 */
const COLUNAS_DA_FOTO =
  '*, items:order_items(*, product:products(sku, erp_id, name), variant:product_variants(size))';

function contarPecas(itens: Array<{ quantity?: number | null }>): number {
  return itens.reduce((s, i) => s + Number(i.quantity ?? 0), 0);
}

/**
 * Guarda a foto do pedido, se ainda não houver uma.
 *
 * Nunca derruba quem chamou: é acessório do corte, não o corte. Sem a 044,
 * sem foto — e o app segue exatamente como era antes dela.
 */
export async function guardarOriginal(
  order: Pick<Order, 'id' | 'company_id' | 'status'>,
  motivo: 'edicao' | 'faturamento',
  quem?: string | null,
): Promise<'guardada' | 'ja_tinha' | 'sem_tabela' | 'falhou'> {
  // Rascunho não tem original: ele AINDA é a montagem.
  if (order.status === 'draft') return 'ja_tinha';
  // Um soluço do banco na sonda NÃO é "tabela ausente": seguir como se fosse
  // deixaria a edição de peças gravar sem a foto, e o original sumiria para
  // sempre. Na dúvida, 'falhou' — quem edita recusa e o usuário tenta de novo.
  const tabela = await detectarComCerteza('order_originals', 'order_id');
  if (tabela === 'nao_existe') return 'sem_tabela';
  if (tabela === 'nao_sei') {
    console.error(`[044] sem resposta do banco sobre order_originals; original do pedido ${order.id} não guardado`);
    return 'falhou';
  }

  // Pergunta antes de montar a foto: o caso comum é já existir, e aí nem vale
  // o select rico (que puxa produtos e variantes de um pedido inteiro).
  const { data: existente, error: erroExistente } = await supabase
    .from('order_originals')
    .select('order_id')
    .eq('order_id', order.id)
    .eq('company_id', order.company_id)
    .maybeSingle();
  if (erroExistente) {
    console.error(`[044] falha ao conferir o original do pedido ${order.id}: ${erroExistente.message}`);
    return 'falhou';
  }
  if (existente) return 'ja_tinha';

  let pedido: unknown = null;
  const rico = await supabase
    .from('orders')
    .select(COLUNAS_DA_FOTO)
    .eq('id', order.id)
    .eq('company_id', order.company_id)
    .maybeSingle();
  if (!rico.error && rico.data) {
    pedido = rico.data;
  } else {
    // Banco antigo, sem os embeds: melhor um retrato sem a referência do que
    // nenhum retrato.
    const simples = await supabase
      .from('orders')
      .select('*, items:order_items(*)')
      .eq('id', order.id)
      .eq('company_id', order.company_id)
      .maybeSingle();
    pedido = simples.data ?? null;
  }
  if (!pedido) {
    // Falha aqui é silenciosa para quem chamou (o corte segue), então fica
    // escrita: sem a foto do primeiro corte, o original some para sempre.
    console.error(`[044] sem pedido para fotografar o original: ${order.id}`);
    return 'falhou';
  }

  const p = pedido as { total?: number | null; items?: Array<{ quantity?: number | null }> };
  const { error } = await supabase.from('order_originals').insert({
    order_id: order.id,
    company_id: order.company_id,
    total: p.total ?? null,
    pecas: contarPecas(p.items ?? []),
    snapshot: pedido,
    motivo,
    guardado_por: quem ?? null,
  });
  // 23505 = outra requisição tirou a foto no mesmo instante. A primeira vence,
  // que é exatamente o combinado.
  if (error) {
    if ((error as { code?: string }).code === '23505') return 'ja_tinha';
    console.error(`[044] falha ao guardar o original do pedido ${order.id}: ${error.message}`);
    return 'falhou';
  }
  return 'guardada';
}

/**
 * A foto de um pedido, para a tela de detalhe. `null` quando não há — pedido
 * que nunca foi cortado não tem "original diferente", e é isso que a tela
 * mostra (nada).
 */
export async function lerOriginal(
  order_id: string,
  company_id: string,
): Promise<PedidoOriginal | null> {
  if (!(await detectarTabela())) return null;
  const { data } = await supabase
    .from('order_originals')
    .select('total, pecas, motivo, guardado_em, snapshot')
    .eq('order_id', order_id)
    .eq('company_id', company_id)
    .maybeSingle();
  if (!data) return null;
  const linha = data as {
    total: number | null;
    pecas: number;
    motivo: string | null;
    guardado_em: string;
    snapshot: PedidoOriginal['snapshot'];
  };
  return {
    order_id,
    total: linha.total,
    pecas: linha.pecas,
    motivo: linha.motivo === 'faturamento' ? 'faturamento' : 'edicao',
    guardado_em: linha.guardado_em,
    snapshot: linha.snapshot,
  };
}
