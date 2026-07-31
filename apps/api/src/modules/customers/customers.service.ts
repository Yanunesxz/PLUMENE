import { supabase } from '../../config/supabase.js';
import type { CustomerListItem, CreateCustomerRequest } from '@csb/shared';
import type { AuthRole } from '@csb/shared';

// O PostgREST devolve no máximo 1000 linhas por requisição. Gerente/admin podem
// ter milhares de clientes, então paginamos em blocos até pegar todos.
const PAGE_SIZE = 1000;

// Só o que as telas usam. `select('*')` + o embed da tabela de preço (que nada
// no app lia) tornava a lista de 1.353 clientes ~5× maior do que precisa.
const CUSTOMER_COLUMNS = 'id, name, trade_name, cnpj, blocked, block_reason, credit_limit, whatsapp';

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
      blocked: false,
    })
    .select(CUSTOMER_COLUMNS)
    .single();

  if (error || !data) return null;
  return data as CustomerListItem;
}
