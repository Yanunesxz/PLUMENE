import { createHash } from 'crypto';
import { supabase } from '../../config/supabase.js';
import type { CreateRepRequest, UpdateRepRequest, RepListItem, PriceTable } from '@csb/shared';

function hashPassword(password: string): string {
  return createHash('sha256').update(password).digest('hex');
}

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
  created_at: string;
  price_tables: EmbeddedTable;
}

const REP_SELECT =
  'id, name, email, cpf, legal_name, phone, active, price_table_id, created_at, price_tables(name)';

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
      password_hash: hashPassword(body.password),
      role: 'rep',
      active: true,
      cpf: body.cpf.trim(),
      legal_name: body.legal_name?.trim() || null,
      phone: body.phone?.trim() || null,
      price_table_id: body.price_table_id,
    })
    .select(REP_SELECT)
    .single();

  if (error || !data) return { ok: false, reason: 'error' };
  return { ok: true, rep: toRepListItem(data as unknown as RepRow) };
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
  if (body.active !== undefined) update.active = body.active;
  if (body.password) update.password_hash = hashPassword(body.password);

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
