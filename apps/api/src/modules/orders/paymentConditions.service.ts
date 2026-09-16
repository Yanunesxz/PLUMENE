/**
 * Condições de pagamento do Control (migração 028).
 *
 * O app não cria condição: a lista veio do Control e é dele. O que este módulo
 * faz é servir a lista para o seletor (rep e loja escolhem no pedido) e validar
 * a escolhida na hora de gravar.
 *
 * Todo caminho aqui tolera a migração não aplicada — o deploy pode chegar antes
 * do SQL, e vender não pode depender da ordem (mesmo padrão das detecções em
 * orders.service.ts). Sem a tabela: lista vazia, escolha ignorada, pedido segue.
 */
import { supabase } from '../../config/supabase.js';
import { detectar } from '../../lib/detectarColuna.js';
import type { PaymentCondition } from '@csb/shared';

export async function detectarCondicoes(): Promise<boolean> {
  return detectar('payment_conditions', 'id');
}

/** `orders.payment_condition_id` — chega na mesma migração, detectada à parte. */
export async function detectarColunaDaCondicao(): Promise<boolean> {
  return detectar('orders', 'payment_condition_id');
}

/**
 * `payment_conditions.valor_minimo` vem da migração 049. Pedir a coluna antes
 * do SQL faria o PostgREST recusar a lista inteira — e sem lista o seletor de
 * condição some do pedido. Sem ela, a resposta é a de hoje, sem o campo.
 */
export async function detectarValorMinimo(): Promise<boolean> {
  return detectar('payment_conditions', 'valor_minimo');
}

/**
 * O NUMERIC do Postgres em número. Nulo, vazio ou ilegível = sem mínimo
 * (`null`) — nunca um zero inventado, que a tela leria como "mínimo de R$ 0".
 */
export function normalizarValorMinimo(valor: unknown): number | null {
  if (valor == null || valor === '') return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

/**
 * As condições ativas da empresa, em ordem de código — a ordem do Control, que
 * é a que a fábrica reconhece. São ~146: cabem inteiras numa resposta, e o
 * seletor filtra no aparelho (funciona offline com o cache do Dexie).
 *
 * Com a 049, cada uma traz `valor_minimo`: a tela AVISA quando o total do
 * pedido fica abaixo dele. Só avisa — nem a tela nem o servidor bloqueiam
 * (`condicaoValida` não olha o mínimo, de propósito).
 */
export async function getCondicoesDePagamento(company_id: string): Promise<PaymentCondition[]> {
  if (!(await detectarCondicoes())) return [];
  const comMinimo = await detectarValorMinimo();
  const colunas = comMinimo
    ? 'id, code, description, active, valor_minimo'
    : 'id, code, description, active';

  const { data, error } = await supabase
    .from('payment_conditions')
    .select(colunas)
    .eq('company_id', company_id)
    .eq('active', true)
    .order('code', { ascending: true });

  if (error || !data) return [];
  const condicoes = data as unknown as PaymentCondition[];
  if (!comMinimo) return condicoes;
  return condicoes.map((c) => ({ ...c, valor_minimo: normalizarValorMinimo(c.valor_minimo) }));
}

/**
 * A condição escolhida, validada: precisa existir, ser DESTA empresa e estar
 * ativa. Devolve `null` quando não dá para gravar — e aí o pedido segue SEM
 * condição, nunca é recusado por causa dela. A condição é acessória (como o
 * e-mail): perder uma venda porque um id veio errado seria o dano maior.
 */
export async function condicaoValida(
  payment_condition_id: string | undefined,
  company_id: string,
): Promise<string | null> {
  if (!payment_condition_id) return null;
  if (!(await detectarColunaDaCondicao())) return null;

  const { data } = await supabase
    .from('payment_conditions')
    .select('id, active')
    .eq('id', payment_condition_id)
    .eq('company_id', company_id)
    .maybeSingle();

  const cond = data as { id: string; active: boolean } | null;
  return cond?.active ? cond.id : null;
}
