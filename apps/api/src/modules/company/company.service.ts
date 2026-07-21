import bcrypt from 'bcryptjs';
import { supabase } from '../../config/supabase.js';

// ─────────────────────────────────────────────────────────────────────────────
// Onboarding de uma nova fábrica (tenant).
// Cria: empresa → tabela de preço padrão → usuário admin da fábrica.
// Chamado apenas pelo dono da plataforma (chave em PLATFORM_ONBOARD_KEY).
// ─────────────────────────────────────────────────────────────────────────────

export interface OnboardInput {
  company_name: string;
  admin_name: string;
  admin_email: string;
  admin_password: string;
}

export type OnboardResult =
  | {
      ok: true;
      company_id: string;
      price_table_id: string;
      admin_email: string;
    }
  | { ok: false; reason: 'email_taken' | 'error'; detail?: string };

export async function onboardCompany(input: OnboardInput): Promise<OnboardResult> {
  const email = input.admin_email.trim().toLowerCase();

  // E-mail é único GLOBAL (entre todas as fábricas) — valida antes de criar nada.
  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('email', email)
    .maybeSingle();
  if (existing) return { ok: false, reason: 'email_taken' };

  const { data: company, error: cErr } = await supabase
    .from('companies')
    .insert({ name: input.company_name.trim() })
    .select('id')
    .single();
  if (cErr || !company) return { ok: false, reason: 'error', detail: cErr?.message };

  const company_id = (company as { id: string }).id;

  const { data: table, error: tErr } = await supabase
    .from('price_tables')
    .insert({ company_id, name: 'TABELA PADRÃO' })
    .select('id')
    .single();
  if (tErr || !table) {
    await supabase.from('companies').delete().eq('id', company_id);
    return { ok: false, reason: 'error', detail: tErr?.message };
  }

  const { error: uErr } = await supabase.from('users').insert({
    company_id,
    name: input.admin_name.trim(),
    email,
    password_hash: bcrypt.hashSync(input.admin_password, 10),
    role: 'admin',
    active: true,
  });
  if (uErr) {
    // Rollback compensatório: empresa sem admin não deve existir (cascade limpa a tabela de preço).
    await supabase.from('companies').delete().eq('id', company_id);
    return { ok: false, reason: 'error', detail: uErr.message };
  }

  return {
    ok: true,
    company_id,
    price_table_id: (table as { id: string }).id,
    admin_email: email,
  };
}
