/**
 * O pedido como a PÁGINA PÚBLICA o recebe (o link do e-mail).
 *
 * Sem login: quem tem o token vê. Por isso o retorno é um subconjunto seguro —
 * referência, foto, tamanho, quantidade e preço. Nada de custo da fábrica,
 * estoque ou id interno.
 */
import { supabase } from '../../config/supabase.js';
import { pedidoDoToken } from './publicToken.js';
import type { PedidoPublico, ItemPedidoPublico, Order } from '@csb/shared';

/** Sete dias depois do faturamento o link para de funcionar (privacidade). */
const VALIDADE_MS = 7 * 24 * 60 * 60 * 1000;

function passoDoStatus(status: Order['status']): PedidoPublico['passo'] {
  if (status === 'rejected') return 'recusado';
  if (status === 'approved' || status === 'sent_erp') return 'aprovado';
  return 'enviado';
}

interface ItemRow {
  quantity: number;
  unit_price: number;
  total: number;
  product_id: string;
  produto: { sku: string; name: string; image_url: string | null } | null;
  variante: { size: string } | null;
}

export async function getPedidoPublico(token: string): Promise<PedidoPublico | null> {
  const id = pedidoDoToken(token);
  if (!id) return null;

  const { data, error } = await supabase
    .from('orders')
    .select(
      '*, items:order_items(quantity, unit_price, total, product_id, produto:products(sku, name, image_url), variante:product_variants(size))',
    )
    .eq('id', id)
    .maybeSingle();
  if (error || !data) return null;

  const order = data as Order & { items: ItemRow[]; guest_name?: string | null };

  const expirado =
    !!order.invoiced &&
    !!order.invoiced_at &&
    Date.now() - new Date(order.invoiced_at).getTime() > VALIDADE_MS;

  const [cli, rep] = await Promise.all([
    order.customer_id
      ? supabase.from('customers').select('name').eq('id', order.customer_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from('users').select('name').eq('id', order.rep_id).maybeSingle(),
  ]);

  // Agrupa por produto: um card por referência, com a grade de tamanhos.
  const porProduto = new Map<string, ItemPedidoPublico>();
  let totalPecas = 0;
  for (const it of order.items ?? []) {
    const ref = it.produto?.sku ?? it.product_id.slice(0, 8);
    const grupo =
      porProduto.get(it.product_id) ??
      ({
        ref,
        nome: it.produto?.name ?? ref,
        foto: it.produto?.image_url ?? null,
        tamanhos: [],
        pecas: 0,
        unit_price: it.unit_price,
        total: 0,
      } satisfies ItemPedidoPublico);
    const tam = it.variante?.size ?? '—';
    const jaTem = grupo.tamanhos.find((t) => t.tamanho === tam);
    if (jaTem) jaTem.quantidade += it.quantity;
    else grupo.tamanhos.push({ tamanho: tam, quantidade: it.quantity });
    grupo.pecas += it.quantity;
    grupo.total += it.total;
    porProduto.set(it.product_id, grupo);
    totalPecas += it.quantity;
  }

  return {
    numero: String(order.order_number ?? order.id.slice(0, 8)),
    data: order.created_at,
    status: order.status,
    passo: passoDoStatus(order.status),
    cliente: (cli.data as { name: string } | null)?.name ?? order.guest_name ?? 'Cliente',
    representante: (rep.data as { name: string } | null)?.name ?? 'Representante',
    total: order.total ?? [...porProduto.values()].reduce((s, p) => s + p.total, 0),
    totalPecas,
    produtos: [...porProduto.values()],
    expirado,
  };
}
