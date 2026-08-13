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
import type { PaymentCondition } from '@csb/shared';

let temCondicoes: boolean | null = null;

export async function detectarCondicoes(): Promise<boolean> {
  if (temCondicoes !== null) return temCondicoes;
  const { error } = await supabase.from('payment_conditions').select('id').limit(1);
  temCondicoes = !error;
  return temCondicoes;
}

/** `orders.payment_condition_id` — chega na mesma migração, detectada à parte. */
let temColunaDaCondicao: boolean | null = null;

export async function detectarColunaDaCondicao(): Promise<boolean> {
  if (temColunaDaCondicao !== null) return temColunaDaCondicao;
  const { error } = await supabase.from('orders').select('payment_condition_id').limit(1);
  temColunaDaCondicao = !error;
  return temColunaDaCondicao;
}

/**
 * As condições ativas da empresa, em ordem de código — a ordem do Control, que
 * é a que a fábrica reconhece. São ~146: cabem inteiras numa resposta, e o
 * seletor filtra no aparelho (funciona offline com o cache do Dexie).
 */
export async function getCondicoesDePagamento(company_id: string): Promise<PaymentCondition[]> {
  if (!(await detectarCondicoes())) return [];

  const { data, error } = await supabase
    .from('payment_conditions')
    .select('id, code, description, active')
    .eq('company_id', company_id)
    .eq('active', true)
    .order('code', { ascending: true });

  if (error || !data) return [];
  return data as PaymentCondition[];
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
