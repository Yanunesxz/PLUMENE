import { supabase } from '../../config/supabase.js';
import type { CustomerWithPriceTable } from '@csb/shared';
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
