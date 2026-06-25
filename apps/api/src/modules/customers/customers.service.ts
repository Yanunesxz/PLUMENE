import { supabase } from '../../config/supabase.js';
import type { CustomerWithPriceTable, CreateCustomerRequest } from '@csb/shared';
import type { UserRole } from '@csb/shared';

export async function getCustomers(
  company_id: string,
  role: UserRole,
  rep_id: string,
  search?: string,
  include_blocked = true,
): Promise<CustomerWithPriceTable[]> {
  let query = supabase
    .from('customers')
    .select('*, price_table:price_tables(id, name, company_id)')
    .eq('company_id', company_id)
    .order('name');

  if (role === 'rep') {
    query = query.eq('rep_id', rep_id);
  }

  if (!include_blocked) {
    query = query.eq('blocked', false);
  }

  if (search) {
    query = query.or(`name.ilike.%${search}%,cnpj.ilike.%${search}%`);
  }

  const { data, error } = await query;
  if (error || !data) return [];
  return data as CustomerWithPriceTable[];
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
      blocked: false,
    })
    .select('*, price_table:price_tables(id, name, company_id)')
    .single();

  if (error || !data) return null;
  return data as CustomerWithPriceTable;
}
