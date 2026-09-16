import { supabase } from '../../config/supabase.js';
import { detectar, detectarOuFalhar } from '../../lib/detectarColuna.js';
import type { ItemDaNota, NotaDoPedido } from '@csb/shared';

/**
 * AS NOTAS FISCAIS DO PEDIDO (migração 048, bloco N).
 *
 * O "como o pedido foi faturado" de verdade: o Control manda, pelo
 * POST /partner/v1/faturamento, a nota (número, série, emissão, valor) e as
 * peças que ela levou. É isto que deixa o cartão "Pedido original" mostrar o
 * corte feito dentro do Control, peça por peça, em vez de só o total.
 *
 * As duas tabelas nascem juntas na 048 e o código sobe antes do SQL: sem elas,
 * a leitura devolve lista vazia e a tela segue como antes.
 */

/** As duas tabelas da nota existem? (nascem no mesmo SQL, mas pergunta pelas duas) */
export async function detectarNotas(): Promise<boolean> {
  return (await detectar('order_invoices', 'id')) && (await detectar('order_invoice_items', 'id'));
}

/**
 * A mesma pergunta para quem GRAVA: lança quando o banco não respondeu sobre o
 * schema. Um soluço lido como "sem a 048" descartaria a nota com o aviso da
 * migração, ou deixaria de cancelar as notas de um faturamento desfeito — e o
 * ERP não tem por que reenviar um registro que voltou sem erro.
 */
export async function detectarNotasOuFalhar(): Promise<boolean> {
  return (
    (await detectarOuFalhar('order_invoices', 'id')) && (await detectarOuFalhar('order_invoice_items', 'id'))
  );
}

interface LinhaDaNota {
  numero: string | null;
  serie: string | null;
  emitida_em: string | null;
  valor: number | string | null;
  cancelada_em: string | null;
  itens?: Array<{
    produto: string | null;
    tamanho: string | null;
    variant_id: string | null;
    quantidade: number | string | null;
    preco_unitario: number | string | null;
  }> | null;
}

function numeroOuNull(v: number | string | null | undefined): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * As notas de um pedido para a tela de detalhe (GET /orders/:id), das mais
 * antigas para as mais novas, com as canceladas marcadas. Nunca lança: é
 * acessório do detalhe — sem a 048, ou se a leitura falhar, lista vazia.
 */
export async function lerNotasDoPedido(order_id: string, company_id: string): Promise<NotaDoPedido[]> {
  try {
    if (!(await detectarNotas())) return [];
    const { data, error } = await supabase
      .from('order_invoices')
      .select(
        'numero, serie, emitida_em, valor, cancelada_em, created_at, itens:order_invoice_items(produto, tamanho, variant_id, quantidade, preco_unitario)',
      )
      .eq('order_id', order_id)
      .eq('company_id', company_id)
      .order('created_at', { ascending: true });
    if (error) {
      console.error(`[048] falha ao ler as notas do pedido ${order_id}: ${error.message}`);
      return [];
    }
    const linhas = (Array.isArray(data) ? data : []) as unknown as LinhaDaNota[];
    return linhas.map((n) => ({
      numero: n.numero ?? '',
      serie: n.serie ?? '',
      emitida_em: n.emitida_em ?? null,
      valor: numeroOuNull(n.valor),
      cancelada_em: n.cancelada_em ?? null,
      itens: (n.itens ?? []).map(
        (i): ItemDaNota => ({
          produto: i.produto ?? '',
          tamanho: i.tamanho ?? '',
          variant_id: i.variant_id ?? null,
          quantidade: numeroOuNull(i.quantidade) ?? 0,
          preco_unitario: numeroOuNull(i.preco_unitario),
        }),
      ),
    }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[048] falha ao ler as notas do pedido ${order_id}: ${msg}`);
    return [];
  }
}

/**
 * Cancela as notas ativas do pedido quando o faturado é DESFEITO pela tela —
 * o mesmo que o `faturado: false` da API faz. Sem isso, um pedido faturado de
 * novo à mão mostraria as peças de uma nota que já não vale.
 *
 * Nunca lança: é acessório do desfazer, que já foi gravado. Devolve as notas
 * canceladas ([] sem a 048 ou sem nota ativa) ou `null` quando não conseguiu
 * (fica no log).
 */
export async function cancelarNotasAtivas(
  order_id: string,
  company_id: string,
  agora: string,
): Promise<Array<{ numero: string; serie: string }> | null> {
  try {
    if (!(await detectarNotas())) return [];
    const ativas = await supabase
      .from('order_invoices')
      .select('id, numero, serie')
      .eq('company_id', company_id)
      .eq('order_id', order_id)
      .is('cancelada_em', null);
    if (ativas.error) {
      console.error(`[048] falha ao ler as notas ativas do pedido ${order_id}: ${ativas.error.message}`);
      return null;
    }
    const lista = (Array.isArray(ativas.data) ? ativas.data : []) as Array<{ numero: string | null; serie: string | null }>;
    if (lista.length === 0) return [];
    const { error } = await supabase
      .from('order_invoices')
      .update({ cancelada_em: agora, updated_at: agora })
      .eq('company_id', company_id)
      .eq('order_id', order_id)
      .is('cancelada_em', null);
    if (error) {
      console.error(`[048] falha ao cancelar as notas do pedido ${order_id}: ${error.message}`);
      return null;
    }
    return lista.map((n) => ({ numero: n.numero ?? '', serie: n.serie ?? '' }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[048] falha ao cancelar as notas do pedido ${order_id}: ${msg}`);
    return null;
  }
}
