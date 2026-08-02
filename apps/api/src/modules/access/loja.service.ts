import { supabase } from '../../config/supabase.js';
import type { MinhaAreaLoja, PecaComprada, PedidoResumido } from '@csb/shared';

/**
 * "Minha área" da loja.
 *
 * A loja não quer relatório: quer saber há quanto tempo não compra, o que
 * costuma comprar e como repetir isso rápido. Tudo é agrupado aqui, no
 * servidor, porque montar o histórico de peças exige juntar `order_items` de
 * todos os pedidos — no celular seria uma requisição por pedido.
 */

/** Histórico suficiente para o que a tela mostra sem varrer anos de pedido. */
const MAX_PEDIDOS = 200;
const MAX_PECAS_LISTADAS = 12;
const MAX_PEDIDOS_LISTADOS = 10;

interface LinhaPedido {
  id: string;
  order_number: number | null;
  status: string;
  total: number | null;
  created_at: string;
}

interface LinhaItem {
  order_id: string;
  product_id: string;
  variant_id: string | null;
  quantity: number;
}

interface LinhaProduto {
  id: string;
  name: string;
  sku: string;
  image_url: string | null;
}

const DIA = 86400_000;

/** Dias cheios entre a data e hoje. Nunca negativo (pedido com data futura). */
function diasDesde(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / DIA));
}

export async function montarMinhaArea(
  company_id: string,
  customer_id: string,
  rep_id: string | null | undefined,
): Promise<MinhaAreaLoja | null> {
  const { data: cliente } = await supabase
    .from('customers')
    .select('name, trade_name, cnpj, whatsapp, price_table_id')
    .eq('id', customer_id)
    .maybeSingle();

  if (!cliente) return null;

  const c = cliente as {
    name: string;
    trade_name: string | null;
    cnpj: string | null;
    whatsapp: string | null;
    price_table_id: string | null;
  };

  const [tabela, rep, pedidosResposta] = await Promise.all([
    c.price_table_id
      ? supabase.from('price_tables').select('name').eq('id', c.price_table_id).maybeSingle()
      : Promise.resolve({ data: null }),
    rep_id
      ? supabase.from('users').select('name, phone').eq('id', rep_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from('orders')
      .select('id, order_number, status, total, created_at')
      .eq('company_id', company_id)
      .eq('customer_id', customer_id)
      .order('created_at', { ascending: false })
      .limit(MAX_PEDIDOS),
  ]);

  const repDados = rep.data as { name: string; phone: string | null } | null;
  const conta: MinhaAreaLoja['conta'] = {
    name: c.name,
    trade_name: c.trade_name,
    cnpj: c.cnpj,
    whatsapp: c.whatsapp,
    price_table_name: (tabela.data as { name: string } | null)?.name ?? null,
    rep_name: repDados?.name ?? null,
    rep_whatsapp: repDados?.phone ?? null,
  };

  const todos = (pedidosResposta.data ?? []) as LinhaPedido[];
  // Pedido recusado não é compra: não conta como gasto, não conta como peça e
  // não pode fazer o "última compra" mentir.
  const valem = todos.filter((p) => p.status !== 'rejected' && p.status !== 'draft');

  const itensPorPedido = new Map<string, LinhaItem[]>();
  const produtos = new Map<string, LinhaProduto>();

  if (valem.length > 0) {
    const { data: itens } = await supabase
      .from('order_items')
      .select('order_id, product_id, variant_id, quantity')
      .in(
        'order_id',
        valem.map((p) => p.id),
      );

    for (const item of (itens ?? []) as LinhaItem[]) {
      const lista = itensPorPedido.get(item.order_id);
      if (lista) lista.push(item);
      else itensPorPedido.set(item.order_id, [item]);
    }

    const idsProduto = [...new Set(((itens ?? []) as LinhaItem[]).map((i) => i.product_id))];
    if (idsProduto.length > 0) {
      const { data: linhas } = await supabase
        .from('products')
        .select('id, name, sku, image_url')
        .in('id', idsProduto);
      for (const p of (linhas ?? []) as LinhaProduto[]) produtos.set(p.id, p);
    }
  }

  const pecasQuantidade = (id: string) =>
    (itensPorPedido.get(id) ?? []).reduce((soma, i) => soma + i.quantity, 0);

  // ─── Peças, da mais comprada para a menos ──────────────────────────────────
  const acumulado = new Map<string, { quantidade: number; vezes: number; ultima: string }>();
  for (const pedido of valem) {
    for (const item of itensPorPedido.get(pedido.id) ?? []) {
      const atual = acumulado.get(item.product_id);
      if (atual) {
        atual.quantidade += item.quantity;
        atual.vezes += 1;
        if (pedido.created_at > atual.ultima) atual.ultima = pedido.created_at;
      } else {
        acumulado.set(item.product_id, {
          quantidade: item.quantity,
          vezes: 1,
          ultima: pedido.created_at,
        });
      }
    }
  }

  const pecas: PecaComprada[] = [...acumulado.entries()]
    .map(([product_id, dados]) => {
      const p = produtos.get(product_id);
      return {
        product_id,
        name: p?.name ?? 'Produto',
        sku: p?.sku ?? '',
        image_url: p?.image_url ?? null,
        quantidade: dados.quantidade,
        vezes: dados.vezes,
        ultima_compra: dados.ultima,
      };
    })
    .sort((a, b) => b.quantidade - a.quantidade)
    .slice(0, MAX_PECAS_LISTADAS);

  // ─── Resumo ────────────────────────────────────────────────────────────────
  const totalGasto = valem.reduce((soma, p) => soma + (p.total ?? 0), 0);
  const totalPecas = valem.reduce((soma, p) => soma + pecasQuantidade(p.id), 0);
  // A consulta já veio ordenada da mais recente para a mais antiga.
  const maisRecente = valem[0];
  const ultimo = maisRecente?.created_at ?? null;

  const resumo: MinhaAreaLoja['resumo'] = {
    total_pedidos: valem.length,
    total_pecas: totalPecas,
    total_gasto: totalGasto,
    ticket_medio: valem.length > 0 ? totalGasto / valem.length : 0,
    ultimo_pedido_em: ultimo,
    dias_desde_ultimo: ultimo ? diasDesde(ultimo) : null,
    aguardando: todos.filter((p) => p.status === 'pending_rep' || p.status === 'pending_approval').length,
  };

  const pedidos: PedidoResumido[] = todos.slice(0, MAX_PEDIDOS_LISTADOS).map((p) => ({
    id: p.id,
    order_number: p.order_number ?? null,
    status: p.status,
    total: p.total ?? 0,
    pecas: pecasQuantidade(p.id),
    created_at: p.created_at,
  }));

  // Repetir a última compra é o atalho que a loja mais usa: mesma grade, mesmo
  // sortimento, mês seguinte. Vai o pedido mais recente que virou compra.
  const repetir = (maisRecente ? (itensPorPedido.get(maisRecente.id) ?? []) : []).map((i) => ({
    product_id: i.product_id,
    variant_id: i.variant_id,
    quantity: i.quantity,
  }));

  return { conta, resumo, pecas, pedidos, repetir };
}
