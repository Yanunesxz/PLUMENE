import { supabase } from '../../config/supabase.js';
import { hashPassword } from '../../lib/password.js';
import type { CreateRepRequest, UpdateRepRequest, RepListItem, PriceTable } from '@csb/shared';
import { DEFAULT_COMMISSION_RATE } from '@csb/shared';

// O embed price_tables(name) pode vir como objeto (1:1) ou array, dependendo da
// inferência do supabase — normalizamos para o nome (ou null).
type EmbeddedTable = { name: string } | { name: string }[] | null | undefined;
function tableName(pt: EmbeddedTable): string | null {
  if (!pt) return null;
  return Array.isArray(pt) ? (pt[0]?.name ?? null) : pt.name;
}

interface RepRow {
  id: string;
  name: string;
  email: string;
  cpf: string | null;
  legal_name: string | null;
  phone: string | null;
  active: boolean;
  price_table_id: string | null;
  commission_rate: number | null;
  created_at: string;
  price_tables: EmbeddedTable;
}

const REP_SELECT =
  'id, name, email, cpf, legal_name, phone, active, price_table_id, commission_rate, created_at, price_tables(name)';

function toRepListItem(row: RepRow): RepListItem {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    cpf: row.cpf ?? null,
    legal_name: row.legal_name ?? null,
    phone: row.phone ?? null,
    active: row.active,
    price_table_id: row.price_table_id ?? null,
    price_table_name: tableName(row.price_tables),
    commission_rate: row.commission_rate ?? DEFAULT_COMMISSION_RATE,
    created_at: row.created_at,
  };
}

export async function listReps(company_id: string): Promise<RepListItem[]> {
  const { data, error } = await supabase
    .from('users')
    .select(REP_SELECT)
    .eq('company_id', company_id)
    .eq('role', 'rep')
    .order('name');

  if (error || !data) return [];
  return (data as unknown as RepRow[]).map(toRepListItem);
}

export async function listPriceTables(company_id: string): Promise<PriceTable[]> {
  const { data, error } = await supabase
    .from('price_tables')
    .select('*')
    .eq('company_id', company_id)
    .order('name');

  if (error || !data) return [];
  return data as PriceTable[];
}

export type CreateRepResult =
  | { ok: true; rep: RepListItem }
  | { ok: false; reason: 'email_taken' | 'error' };

export async function createRep(
  company_id: string,
  body: CreateRepRequest,
): Promise<CreateRepResult> {
  const email = body.email.trim().toLowerCase();

  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('email', email)
    .maybeSingle();
  if (existing) return { ok: false, reason: 'email_taken' };

  const { data, error } = await supabase
    .from('users')
    .insert({
      company_id,
      name: body.name.trim(),
      email,
      password_hash: await hashPassword(body.password),
      role: 'rep',
      active: true,
      cpf: body.cpf.trim(),
      legal_name: body.legal_name?.trim() || null,
      phone: body.phone?.trim() || null,
      price_table_id: body.price_table_id,
      commission_rate: body.commission_rate ?? DEFAULT_COMMISSION_RATE,
    })
    .select(REP_SELECT)
    .single();

  if (error || !data) return { ok: false, reason: 'error' };
  return { ok: true, rep: toRepListItem(data as unknown as RepRow) };
}

export type DeleteRepResult =
  | { ok: true; unassigned_customers: number }
  | { ok: false; reason: 'not_found' | 'has_orders' | 'error'; orders?: number };

/**
 * Exclui um representante. Só é permitido quando ele NÃO tem pedidos —
 * pedidos referenciam o rep (histórico/comissões) e o banco bloqueia via FK.
 * Clientes da carteira dele ficam sem representante (FK ON DELETE SET NULL).
 */
export async function deleteRep(company_id: string, id: string): Promise<DeleteRepResult> {
  const { data: rep } = await supabase
    .from('users')
    .select('id')
    .eq('id', id)
    .eq('company_id', company_id)
    .eq('role', 'rep')
    .maybeSingle();
  if (!rep) return { ok: false, reason: 'not_found' };

  const { count: orders } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('rep_id', id);
  if ((orders ?? 0) > 0) return { ok: false, reason: 'has_orders', orders: orders ?? 0 };

  const { count: customers } = await supabase
    .from('customers')
    .select('id', { count: 'exact', head: true })
    .eq('rep_id', id);

  const { error } = await supabase
    .from('users')
    .delete()
    .eq('id', id)
    .eq('company_id', company_id)
    .eq('role', 'rep');
  if (error) return { ok: false, reason: 'error' };

  return { ok: true, unassigned_customers: customers ?? 0 };
}

export type UpdateRepResult =
  | { ok: true; rep: RepListItem }
  | { ok: false; reason: 'email_taken' | 'not_found' | 'error' };

export async function updateRep(
  company_id: string,
  id: string,
  body: UpdateRepRequest,
): Promise<UpdateRepResult> {
  const update: Record<string, unknown> = {};

  if (body.email !== undefined) {
    const email = body.email.trim().toLowerCase();
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .neq('id', id)
      .maybeSingle();
    if (existing) return { ok: false, reason: 'email_taken' };
    update.email = email;
  }
  if (body.name !== undefined) update.name = body.name.trim();
  if (body.cpf !== undefined) update.cpf = body.cpf.trim() || null;
  if (body.legal_name !== undefined) update.legal_name = body.legal_name?.trim() || null;
  if (body.phone !== undefined) update.phone = body.phone?.trim() || null;
  if (body.price_table_id !== undefined) update.price_table_id = body.price_table_id || null;
  if (body.commission_rate !== undefined) update.commission_rate = body.commission_rate;
  if (body.active !== undefined) update.active = body.active;
  if (body.password) update.password_hash = await hashPassword(body.password);

  if (Object.keys(update).length === 0) return { ok: false, reason: 'error' };

  const { data, error } = await supabase
    .from('users')
    .update(update)
    .eq('id', id)
    .eq('company_id', company_id)
    .eq('role', 'rep')
    .select(REP_SELECT)
    .maybeSingle();

  if (error) return { ok: false, reason: 'error' };
  if (!data) return { ok: false, reason: 'not_found' };
  return { ok: true, rep: toRepListItem(data as unknown as RepRow) };
}
