import { supabase } from '../../config/supabase.js';
import type {
  CustomerListItem,
  CreateCustomerRequest,
  CustomerDetail,
  PedidoDoCliente,
} from '@csb/shared';
import type { AuthRole } from '@csb/shared';

// O PostgREST devolve no máximo 1000 linhas por requisição. Gerente/admin podem
// ter milhares de clientes, então paginamos em blocos até pegar todos.
const PAGE_SIZE = 1000;

// Só o que as telas usam. `select('*')` + o embed da tabela de preço (que nada
// no app lia) tornava a lista de 1.353 clientes ~5× maior do que precisa.
const CUSTOMER_COLUMNS =
  'id, name, trade_name, cnpj, blocked, block_reason, credit_limit, whatsapp, price_table_id, erp_id';

export async function getCustomers(
  company_id: string,
  role: AuthRole,
  rep_id: string,
  search?: string,
  include_blocked = true,
  erp_rep_id?: string | null,
): Promise<CustomerListItem[]> {
  // Sanitiza o termo de busca: vírgula/parênteses/barra têm significado no
  // filtro `.or()` do PostgREST e quebrariam a query se digitados.
  const term = search ? search.replace(/[,()\\]/g, ' ').trim() : '';

  const all: CustomerListItem[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase
      .from('customers')
      .select(CUSTOMER_COLUMNS)
      .eq('company_id', company_id)
      .order('name')
      .range(from, from + PAGE_SIZE - 1);

    // Carteira do representante = clientes que ELE cadastrou no app (rep_id) +
    // os que o ERP atribuiu ao código dele (rep_erp_id). Sem a segunda metade o
    // rep enxergava só o punhado que digitou à mão — os 1.3 mil vindos do ERP
    // ficavam invisíveis porque chegam com rep_id nulo.
    if (role === 'rep') {
      query = erp_rep_id
        ? query.or(`rep_id.eq.${rep_id},rep_erp_id.eq.${erp_rep_id}`)
        : query.eq('rep_id', rep_id);
    }
    if (!include_blocked) query = query.eq('blocked', false);
    if (term) query = query.or(`name.ilike.%${term}%,cnpj.ilike.%${term}%`);

    const { data, error } = await query;
    if (error || !data) break;
    all.push(...(data as CustomerListItem[]));
    if (data.length < PAGE_SIZE) break; // última página
  }

  return all;
}

export async function createCustomer(
  company_id: string,
  rep_id: string,
  body: CreateCustomerRequest,
  price_table_id: string | null,
): Promise<CustomerListItem | null> {
  const { data, error } = await supabase
    .from('customers')
    .insert({
      company_id,
      rep_id,
      name: body.name.trim(),
      trade_name: body.trade_name?.trim() || null,
      cnpj: body.cnpj?.trim() || null,
      whatsapp: body.whatsapp?.trim() || null,
      email: body.email?.trim() || null,
      address: body.address?.trim() || null,
      price_table_id,
      blocked: false,
    })
    .select(CUSTOMER_COLUMNS)
    .single();

  if (error || !data) return null;
  return data as CustomerListItem;
}

/** De quem é a carteira, para as duas metades da regra abaixo. */
export interface EscopoDaCarteira {
  rep_id: string;
  erp_rep_id?: string | null;
  /** Gerente e admin passam por qualquer cliente da empresa. */
  irrestrito?: boolean;
}

/**
 * Busca um cliente DENTRO da carteira de quem pediu.
 *
 * A regra repete a de `getCustomers`: dono no app (`rep_id`) OU carteira do ERP
 * (`rep_erp_id`). Um representante que não enxerga o cliente na lista também
 * não pode abrir a ficha dele nem reprecificá-lo pela API — sem isto, trocar a
 * lista por uma chamada direta bastaria para contornar a carteira.
 */
async function clienteDaCarteira<T>(
  company_id: string,
  customer_id: string,
  escopo: EscopoDaCarteira,
  colunas: string,
): Promise<T | null> {
  let consulta = supabase
    .from('customers')
    .select(colunas)
    .eq('id', customer_id)
    .eq('company_id', company_id);

  if (!escopo.irrestrito) {
    consulta = escopo.erp_rep_id
      ? consulta.or(`rep_id.eq.${escopo.rep_id},rep_erp_id.eq.${escopo.erp_rep_id}`)
      : consulta.eq('rep_id', escopo.rep_id);
  }

  const { data } = await consulta.maybeSingle();
  return (data as T | null) ?? null;
}

/** Histórico suficiente para a ficha sem varrer anos de pedido. */
const MAX_PEDIDOS_DA_FICHA = 50;

const DETALHE_COLUNAS =
  'id, name, trade_name, cnpj, whatsapp, email, address, credit_limit, blocked, block_reason, price_table_id';

/**
 * A ficha do cliente: cadastro, tabela de preço e histórico de pedidos.
 *
 * Duas consultas, não mais: a ficha não mostra "o que mais compra", então não
 * há motivo para cruzar `order_items` e `products` de todos os pedidos como
 * faz a "Minha área" da loja.
 */
export async function obterCliente(
  company_id: string,
  customer_id: string,
  escopo: EscopoDaCarteira,
): Promise<CustomerDetail | null> {
  const cliente = await clienteDaCarteira<Omit<CustomerDetail, 'pedidos'>>(
    company_id,
    customer_id,
    escopo,
    DETALHE_COLUNAS,
  );
  if (!cliente) return null;

  const { data } = await supabase
    .from('orders')
    .select('id, order_number, status, total, created_at')
    .eq('company_id', company_id)
    .eq('customer_id', customer_id)
    .order('created_at', { ascending: false })
    .limit(MAX_PEDIDOS_DA_FICHA);

  const pedidos: PedidoDoCliente[] = (
    (data ?? []) as Array<Omit<PedidoDoCliente, 'total'> & { total: number | null }>
  ).map((p) => ({
    id: p.id,
    order_number: p.order_number ?? null,
    status: p.status,
    total: p.total ?? 0,
    created_at: p.created_at,
  }));

  return { ...cliente, pedidos };
}

export type TrocaDeTabela =
  | { ok: true; cliente: CustomerListItem }
  | { ok: false; motivo: 'cliente_nao_encontrado' | 'erro' };

/**
 * Troca a tabela de preço de um cliente. É a única edição de cadastro que o app
 * permite — e a mais cara de errar: muda o preço de tudo que a loja comprar
 * dali para frente, inclusive pelo login próprio dela.
 *
 * Quem chama JÁ precisa ter validado que `price_table_id` está no conjunto de
 * quem pediu. Aqui vale a outra metade: o cliente é da carteira dele?
 */
export async function atualizarTabelaDoCliente(
  company_id: string,
  customer_id: string,
  price_table_id: string,
  escopo: EscopoDaCarteira,
): Promise<TrocaDeTabela> {
  const cliente = await clienteDaCarteira<{ id: string }>(company_id, customer_id, escopo, 'id');
  if (!cliente) return { ok: false, motivo: 'cliente_nao_encontrado' };

  const { data, error } = await supabase
    .from('customers')
    .update({ price_table_id })
    .eq('id', customer_id)
    .eq('company_id', company_id)
    .select(CUSTOMER_COLUMNS)
    .maybeSingle();

  if (error || !data) return { ok: false, motivo: 'erro' };
  return { ok: true, cliente: data as CustomerListItem };
}
