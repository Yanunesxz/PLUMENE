import { supabase } from '../../config/supabase.js';
import { detectar, detectarOuFalhar } from '../../lib/detectarColuna.js';
import type { ItemDaNota, NotaDoPedido, NotaSubstituida } from '@csb/shared';

/**
 * AS NOTAS FISCAIS DO PEDIDO (migração 048, bloco N; 049, bloco C).
 *
 * O "como o pedido foi faturado" de verdade: o Control manda, pelo
 * POST /partner/v1/faturamento, a nota (número, série, emissão, valor) e as
 * peças que ela levou. É isto que deixa o cartão "Pedido original" mostrar o
 * corte feito dentro do Control, peça por peça, em vez de só o total.
 *
 * UM PEDIDO TEM UMA NOTA (decisão de 16/09/2026). Nota cancelada ou devolvida
 * no Control não chega como aviso: o Control sobe OUTRA nota, com número
 * diferente, para o mesmo pedido — e a anterior fica SUBSTITUÍDA
 * (cancelada_em + substituida_por/substituida_em, da 049). A leitura devolve a
 * nota ativa junto com o histórico (as substituídas e as canceladas, marcadas);
 * a tela usa só a ativa (`notasAtivas`, em @csb/shared) e o rastro usa o
 * histórico (`lerSubstituicoesDoPedido`).
 *
 * As duas tabelas nascem juntas na 048 e o código sobe antes do SQL: sem elas,
 * a leitura devolve lista vazia e a tela segue como antes. Sem a 049, as notas
 * saem sem os dois campos da substituição (e a nova convive com a antiga, como
 * era até aqui).
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

/** As colunas da substituição (049) existem em order_invoices? Nascem juntas. */
export async function detectarSubstituicao(): Promise<boolean> {
  return detectar('order_invoices', 'substituida_por');
}

/**
 * A mesma pergunta para quem GRAVA a substituição: lança quando o banco não
 * respondeu. Um soluço lido como "sem a 049" deixaria a nota nova conviver com
 * a antiga — e a tela somaria as peças das duas.
 */
export async function detectarSubstituicaoOuFalhar(): Promise<boolean> {
  return detectarOuFalhar('order_invoices', 'substituida_por');
}

interface LinhaDaNota {
  numero: string | null;
  serie: string | null;
  emitida_em: string | null;
  valor: number | string | null;
  cancelada_em: string | null;
  substituida_por?: string | null;
  substituida_em?: string | null;
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
 * antigas para as mais novas: a nota ativa e o histórico (canceladas e
 * substituídas, marcadas). Nunca lança: é acessório do detalhe — sem a 048,
 * ou se a leitura falhar, lista vazia. Com a 049, cada nota diz por qual foi
 * substituída (`substituida_por`, o id da nova) e quando; sem ela, os dois
 * campos não vêm.
 */
export async function lerNotasDoPedido(order_id: string, company_id: string): Promise<NotaDoPedido[]> {
  try {
    if (!(await detectarNotas())) return [];
    const comSubstituicao = await detectarSubstituicao();
    const colunasDaNota = comSubstituicao
      ? 'numero, serie, emitida_em, valor, cancelada_em, substituida_por, substituida_em, created_at'
      : 'numero, serie, emitida_em, valor, cancelada_em, created_at';
    const { data, error } = await supabase
      .from('order_invoices')
      .select(
        `${colunasDaNota}, itens:order_invoice_items(produto, tamanho, variant_id, quantidade, preco_unitario)`,
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
      ...(comSubstituicao
        ? { substituida_por: n.substituida_por ?? null, substituida_em: n.substituida_em ?? null }
        : {}),
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

interface LinhaDaSubstituicao {
  id: string;
  numero: string | null;
  serie: string | null;
  substituida_por: string | null;
  substituida_em: string | null;
}

/**
 * O histórico de substituições do pedido, das mais antigas para as mais novas:
 * "a 1234 foi substituída pela 1260 em 16/09". Resolve o id da nota nova no
 * número e série dela — é o que o rastro e a ficha do pedido mostram.
 *
 * Nunca lança: sem a 049 (ou sem substituição nenhuma), lista vazia.
 */
export async function lerSubstituicoesDoPedido(order_id: string, company_id: string): Promise<NotaSubstituida[]> {
  try {
    if (!(await detectarNotas()) || !(await detectarSubstituicao())) return [];
    const { data, error } = await supabase
      .from('order_invoices')
      .select('id, numero, serie, substituida_por, substituida_em')
      .eq('order_id', order_id)
      .eq('company_id', company_id)
      .order('created_at', { ascending: true });
    if (error) {
      console.error(`[049] falha ao ler as substituições do pedido ${order_id}: ${error.message}`);
      return [];
    }
    const linhas = (Array.isArray(data) ? data : []) as LinhaDaSubstituicao[];
    const porId = new Map(linhas.map((n) => [n.id, n]));
    const historico: NotaSubstituida[] = [];
    for (const n of linhas) {
      if (!n.substituida_por) continue;
      const nova = porId.get(n.substituida_por);
      // A nota nova apagada (FK ON DELETE SET NULL deixaria null, mas na dúvida):
      // sem ela não há "pela qual", e o par não conta.
      if (!nova) continue;
      historico.push({
        anterior: { numero: n.numero ?? '', serie: n.serie ?? '' },
        nova: { numero: nova.numero ?? '', serie: nova.serie ?? '' },
        substituida_em: n.substituida_em ?? '',
      });
    }
    return historico;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[049] falha ao ler as substituições do pedido ${order_id}: ${msg}`);
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
