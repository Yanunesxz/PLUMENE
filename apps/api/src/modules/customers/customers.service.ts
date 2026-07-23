import { supabase } from '../../config/supabase.js';
import type { CustomerWithPriceTable, CreateCustomerRequest } from '@csb/shared';
import type { UserRole } from '@csb/shared';

// O PostgREST devolve no máximo 1000 linhas por requisição. Gerente/admin podem
// ter milhares de clientes, então paginamos em blocos até pegar todos.
const PAGE_SIZE = 1000;

export async function getCustomers(
  company_id: string,
  role: UserRole,
  rep_id: string,
  search?: string,
  include_blocked = true,
): Promise<CustomerWithPriceTable[]> {
  // Sanitiza o termo de busca: vírgula/parênteses/barra têm significado no
  // filtro `.or()` do PostgREST e quebrariam a query se digitados.
  const term = search ? search.replace(/[,()\\]/g, ' ').trim() : '';

  const all: CustomerWithPriceTable[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase
      .from('customers')
      .select('*, price_table:price_tables(id, name, company_id)')
      .eq('company_id', company_id)
      .order('name')
      .range(from, from + PAGE_SIZE - 1);

    if (role === 'rep') query = query.eq('rep_id', rep_id);
    if (!include_blocked) query = query.eq('blocked', false);
    if (term) query = query.or(`name.ilike.%${term}%,cnpj.ilike.%${term}%`);

    const { data, error } = await query;
    if (error || !data) break;
    all.push(...(data as CustomerWithPriceTable[]));
    if (data.length < PAGE_SIZE) break; // última página
  }

  return all;
}

export async function createCustomer(
  company_id: string,
  rep_id: string,
  body: CreateCustomerRequest,
): Promise<CustomerWithPriceTable | null> {
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
    .select('*, price_table:price_tables(id, name, company_id)')
    .single();

  if (error || !data) return null;
  return data as CustomerWithPriceTable;
}
