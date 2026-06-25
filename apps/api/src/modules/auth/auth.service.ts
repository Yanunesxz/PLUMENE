import { supabase } from '../../config/supabase.js';
import { env } from '../../config/env.js';
import type { User, AuthPayload } from '@csb/shared';

export async function findUserByEmail(email: string): Promise<(User & { password_hash: string }) | null> {
  const { data, error } = await supabase
    .from('users')
    .select('*, password_hash')
    .eq('email', email)
    .eq('active', true)
    .single();

  if (error || !data) return null;
  return data as User & { password_hash: string };
}

export function buildAuthPayload(user: User): AuthPayload {
  return {
    sub: user.id,
    email: user.email,
    role: user.role,
    company_id: user.company_id,
    name: user.name,
    price_table_id: user.price_table_id ?? null,
    commission_rate: user.commission_rate ?? null,
  };
}

export function getTokenConfig() {
  return {
    expiresIn: env.JWT_EXPIRES_IN,
    refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
  };
}
