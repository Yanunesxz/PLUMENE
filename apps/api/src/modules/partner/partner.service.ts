/**
 * Serviço da API de Parceiro — pedidos prontos para importação no ERP.
 *
 * O parceiro (programa do ERP) busca os pedidos aprovados, grava no sistema
 * dele e confirma a importação informando o número gerado no ERP. A partir
 * daí o pedido fica como `sent_erp` e sai da fila.
 */
import { supabase } from '../../config/supabase.js';

/** Código de cor usado pelo ERP quando o pedido é por tamanho (cores sortidas). */
const COR_SORTIDA = '00001';

export interface PartnerOrderItem {
  produto: string | null;
  tamanho: string | null;
  cor: string;
  quantidade: number;
  preco_unitario: number;
  valor_total: number;
}

export interface PartnerOrder {
  id: string;
  numero: number | null;
  situacao: string;
  criado_em: string;
  atualizado_em: string;
  valor_total: number | null;
  observacoes: string | null;
  pedido_erp: string | null;
  cliente: {
    codigo_erp: string | null;
    cnpj: string | null;
    razao_social: string | null;
    nome_fantasia: string | null;
  };
  representante_erp: string | null;
  tabela_preco: { codigo_erp: string | null; coluna: number };
  itens: PartnerOrderItem[];
  /** true quando todos os vínculos com o ERP estão presentes */
  importavel: boolean;
  /** Cadastros faltando que impedem a importação (vazio quando importavel) */
  pendencias: string[];
}

interface OrderRow {
  id: string;
  order_number?: number | null;
  status: string;
  total: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  erp_order_id: string | null;
  /** Foto da tabela de preço no momento do pedido (preferida sobre a do cliente) */
  price_table_erp_code: string | null;
  price_column: number | null;
  customer: {
    erp_id: string | null;
    cnpj: string | null;
    name: string | null;
    trade_name: string | null;
    rep_erp_id: string | null;
    price_table_id: string | null;
  } | null;
  items: Array<{
    quantity: number;
    unit_price: number;
    total: number;
    variant: { erp_sku: string | null; size: string | null } | null;
    product: { erp_id: string | null; sku: string | null } | null;
  }>;
}

function buildOrderSelect(withOrderNumber: boolean): string {
  return `
    id, ${withOrderNumber ? 'order_number, ' : ''}status, total, notes,
    created_at, updated_at, erp_order_id, price_table_erp_code, price_column,
    customer:customers(erp_id, cnpj, name, trade_name, rep_erp_id, price_table_id),
    items:order_items(quantity, unit_price, total,
      variant:product_variants(erp_sku, size),
      product:products(erp_id, sku))
  `;
}

// orders.order_number vem da migração 009, que pode não estar aplicada.
// Detecta uma vez e guarda; sem a coluna, `numero` sai null.
let hasOrderNumber: boolean | null = null;

async function detectOrderNumber(): Promise<boolean> {
  if (hasOrderNumber !== null) return hasOrderNumber;
  const { error } = await supabase.from('orders').select('order_number').limit(1);
  hasOrderNumber = !error;
  return hasOrderNumber;
}

function mapOrder(
  row: OrderRow,
  tableMap: Map<string, { erp_code: string | null; price_column: number }>,
): PartnerOrder {
  const pendencias: string[] = [];
  const customer = row.customer;

  if (!customer?.erp_id) pendencias.push('cliente sem código do ERP');
  if (!customer?.rep_erp_id) pendencias.push('cliente sem representante vinculado no ERP');

  // Tabela de preço: prefere a foto gravada no pedido; senão, a do cliente.
  const customerTable = customer?.price_table_id
    ? tableMap.get(customer.price_table_id)
    : undefined;
  const tabelaErp = row.price_table_erp_code ?? customerTable?.erp_code ?? null;
  const coluna = row.price_column ?? customerTable?.price_column ?? 1;
  if (!tabelaErp) pendencias.push('pedido sem tabela de preço vinculada no ERP');

  const itens: PartnerOrderItem[] = (row.items ?? []).map((it) => {
    let produto: string | null = null;
    let tamanho: string | null = null;
    if (it.variant?.erp_sku?.includes('|')) {
      const [p, t] = it.variant.erp_sku.split('|', 2);
      produto = p ?? null;
      tamanho = t ?? null;
    } else {
      produto = it.product?.erp_id ?? null;
      tamanho = it.variant?.size ?? null;
    }
    if (!produto || !tamanho) pendencias.push('item sem vínculo de produto/tamanho com o ERP');
    return {
      produto,
      tamanho,
      cor: COR_SORTIDA,
      quantidade: it.quantity,
      preco_unitario: it.unit_price,
      valor_total: it.total,
    };
  });

  if (itens.length === 0) pendencias.push('pedido sem itens');

  return {
    id: row.id,
    numero: row.order_number ?? null,
    situacao: row.status,
    criado_em: row.created_at,
    atualizado_em: row.updated_at,
    valor_total: row.total,
    observacoes: row.notes,
    pedido_erp: row.erp_order_id,
    cliente: {
      codigo_erp: customer?.erp_id ?? null,
      cnpj: customer?.cnpj ?? null,
      razao_social: customer?.name ?? null,
      nome_fantasia: customer?.trade_name ?? null,
    },
    representante_erp: customer?.rep_erp_id ?? null,
    tabela_preco: { codigo_erp: tabelaErp, coluna },
    itens,
    importavel: pendencias.length === 0,
    pendencias: [...new Set(pendencias)],
  };
}

async function getPriceTableMap(
  company_id: string,
): Promise<Map<string, { erp_code: string | null; price_column: number }>> {
  const { data } = await supabase
    .from('price_tables')
    .select('id, erp_code, price_column')
    .eq('company_id', company_id);

  return new Map(
    (data ?? []).map((t: { id: string; erp_code: string | null; price_column: number | null }) => [
      t.id,
      { erp_code: t.erp_code, price_column: t.price_column ?? 1 },
    ]),
  );
}

/**
 * Pedidos aprovados aguardando importação no ERP (padrão), ou todos os
 * aprovados/importados quando `incluir=todos`. `desde` filtra por
 * atualizado_em >= data (a "data que eu puxei" do parceiro).
 */
export async function getPartnerOrders(
  company_id: string,
  opts: { desde?: string | undefined; incluirImportados?: boolean },
): Promise<PartnerOrder[]> {
  const withOrderNumber = await detectOrderNumber();
  let query = supabase
    .from('orders')
    .select(buildOrderSelect(withOrderNumber))
    .eq('company_id', company_id)
    .order('created_at', { ascending: true });

  if (opts.incluirImportados) {
    query = query.in('status', ['approved', 'sent_erp']);
  } else {
    query = query.eq('status', 'approved').is('erp_order_id', null);
  }
  if (opts.desde) {
    query = query.gte('updated_at', opts.desde);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Falha ao buscar pedidos: ${error.message}`);

  const tableMap = await getPriceTableMap(company_id);
  return ((data ?? []) as unknown as OrderRow[]).map((row) => mapOrder(row, tableMap));
}

export type ConfirmResult =
  | { outcome: 'ok'; ja_confirmado: boolean }
  | { outcome: 'not_found' }
  | { outcome: 'conflict'; pedido_erp_atual: string };

/**
 * Confirma a importação: grava o número do pedido gerado no ERP e tira o
 * pedido da fila. Idempotente — repetir com o mesmo número responde ok.
 */
export async function confirmOrderImport(
  company_id: string,
  order_id: string,
  pedido_erp: string,
): Promise<ConfirmResult> {
  const { data: order } = await supabase
    .from('orders')
    .select('id, status, erp_order_id')
    .eq('id', order_id)
    .eq('company_id', company_id)
    .single();

  if (!order) return { outcome: 'not_found' };

  if (order.erp_order_id) {
    if (order.erp_order_id === pedido_erp) return { outcome: 'ok', ja_confirmado: true };
    return { outcome: 'conflict', pedido_erp_atual: order.erp_order_id as string };
  }

  const { error } = await supabase
    .from('orders')
    .update({
      status: 'sent_erp',
      erp_order_id: pedido_erp,
      synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', order_id)
    .eq('company_id', company_id);

  if (error) throw new Error(`Falha ao confirmar pedido: ${error.message}`);
  return { outcome: 'ok', ja_confirmado: false };
}
