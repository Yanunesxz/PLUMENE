import { supabase } from '../../config/supabase.js';
import { clienteDaCarteira } from '../access/invites.service.js';
import { podeTrocarClienteDoPedido, type PodeTrocarCliente } from '@csb/shared';
import type { AuthRole, Order, ResultadoDaTrocaDeCliente } from '@csb/shared';

/**
 * TROCAR O CLIENTE DO PEDIDO (Yan, 08/10/2026) — o representante escolheu a
 * loja errada. Quem pode e quando: `podeTrocarClienteDoPedido` (shared).
 *
 * Muda só `orders.customer_id`. O pedido continua com a tabela e os preços com
 * que foi feito: repreçar em silêncio mudaria o total que o rep combinou. Se o
 * cliente novo é de outra tabela, a resposta diz, e a tela avisa.
 *
 * Não precisa de migração: é uma coluna que já existe. Todos veem a troca na
 * próxima leitura do pedido — inclusive o aparelho do rep, que regrava o cache
 * a cada GET /orders.
 */

export type ResultadoDaTroca =
  | ({ ok: true; order: Order; mudou: boolean; antes: string | null } & ResultadoDaTrocaDeCliente)
  | { ok: false; reason: 'not_found' | 'cliente_nao_encontrado' | 'erro' | Exclude<PodeTrocarCliente, 'ok'> };

export async function trocarClienteDoPedido(
  id: string,
  company_id: string,
  quem: { id: string; role: AuthRole; erp_rep_id?: string | null },
  customer_id: string,
): Promise<ResultadoDaTroca> {
  // `*`: as colunas do Control (erp_order_id, erp_requested_at) só existem
  // depois das migrações delas — pedidas pelo nome, um banco sem elas
  // responderia 42703 e o pedido pareceria não existir.
  const { data: lido, error: erroLeitura } = await supabase
    .from('orders')
    .select('*')
    .eq('id', id)
    .eq('company_id', company_id)
    .maybeSingle();
  if (erroLeitura) {
    console.error(`[troca-cliente] falha ao ler o pedido ${id}: ${erroLeitura.message}`);
    return { ok: false, reason: 'erro' };
  }
  if (!lido) return { ok: false, reason: 'not_found' };
  const o = lido as unknown as Order & { erp_requested_at?: string | null };

  const acesso = podeTrocarClienteDoPedido(o, quem.role, quem.id);
  if (acesso !== 'ok') return { ok: false, reason: acesso };

  // O cliente novo: da empresa sempre; para o representante, da carteira dele
  // (a mesma regra do convite e da vitrine).
  const daCarteira = await clienteDaCarteira(company_id, quem.id, customer_id, {
    erp_rep_id: quem.erp_rep_id ?? null,
    irrestrito: quem.role !== 'rep',
  });
  if (!daCarteira) return { ok: false, reason: 'cliente_nao_encontrado' };

  const { data: cliente } = await supabase
    .from('customers')
    .select('id, price_table_id')
    .eq('id', customer_id)
    .eq('company_id', company_id)
    .maybeSingle();
  const novo = cliente as { id: string; price_table_id: string | null } | null;
  if (!novo) return { ok: false, reason: 'cliente_nao_encontrado' };

  const tabela_diferente =
    !!novo.price_table_id && !!o.price_table_id && novo.price_table_id !== o.price_table_id;
  const ja_no_control = o.status === 'sent_erp' || !!o.erp_order_id || !!o.erp_requested_at;

  // O mesmo cliente de novo (duplo toque): nada a gravar.
  if (o.customer_id === novo.id) {
    return { ok: true, order: o, mudou: false, antes: o.customer_id ?? null, tabela_diferente, ja_no_control };
  }

  // Grava só se o pedido continua trocável: a nota chegando no meio, ou o rep
  // enviando para a fábrica ao mesmo tempo, não passam por cima.
  let gravar = supabase
    .from('orders')
    .update({ customer_id: novo.id, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('company_id', company_id)
    .neq('status', 'rejected')
    .or('invoiced.is.null,invoiced.eq.false');
  if (quem.role === 'rep') gravar = gravar.in('status', ['draft', 'pending_rep']);
  const { data, error } = await gravar.select('*').maybeSingle();
  if (error) {
    console.error(`[troca-cliente] falha ao gravar o pedido ${id}: ${error.message}`);
    return { ok: false, reason: 'erro' };
  }
  if (!data) return { ok: false, reason: quem.role === 'rep' ? 'ja_enviado' : 'faturado' };

  console.info(
    `[troca-cliente] pedido ${o.order_number ?? id}: cliente ${o.customer_id ?? '-'} -> ${novo.id} por ${quem.id} (${quem.role})`,
  );
  return {
    ok: true,
    order: data as unknown as Order,
    mudou: true,
    antes: o.customer_id ?? null,
    tabela_diferente,
    ja_no_control,
  };
}

/** Nome do cliente para o aviso ao representante. */
export async function nomeDoCliente(customer_id: string): Promise<string | null> {
  const { data } = await supabase.from('customers').select('name, trade_name').eq('id', customer_id).maybeSingle();
  const c = data as { name: string; trade_name: string | null } | null;
  return c ? c.trade_name?.trim() || c.name : null;
}
