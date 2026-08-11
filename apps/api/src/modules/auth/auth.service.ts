import { supabase } from '../../config/supabase.js';
import { env } from '../../config/env.js';
import type { User, AuthPayload } from '@csb/shared';

export async function findUserByEmail(email: string): Promise<(User & { password_hash: string }) | null> {
  // E-mails são gravados em minúsculas (ver createRep); normaliza para o login
  // não falhar quando o usuário digita com qualquer letra maiúscula no celular.
  const { data, error } = await supabase
    .from('users')
    .select('*, password_hash')
    .eq('email', email.trim().toLowerCase())
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
    erp_rep_id: user.erp_rep_id ?? null,
    // Sem estes dois o login da LOJA sai sem vínculo nenhum: o catálogo não
    // resolve tabela de preço, `/orders` filtra por customer_id vazio (lista
    // sempre vazia) e o pedido é recusado com "acesso sem loja vinculada".
    // Eram nulos para todo mundo até aqui — a loja simplesmente não entrava.
    customer_id: user.customer_id ?? null,
    rep_id: user.rep_id ?? null,
    // Teclas do gerente viajam no token para o guard não consultar o banco a
    // cada requisição. Nulo é significativo: quer dizer "padrão do papel".
    // O preço é o mesmo do bloqueio: mudança de tecla vale em até 1h.
    permissions: user.permissions ?? null,
  };
}

/**
 * Carimba o último acesso.
 *
 * Nunca segura o login e nunca o derruba: se a coluna ainda não existe (migração
 * 022 não aplicada) o supabase-js devolve erro em vez de lançar, e aqui isso é
 * exatamente o comportamento desejado — quem está entrando não tem nada a ver
 * com o estado do schema.
 */
export async function registrarAcesso(userId: string): Promise<void> {
  try {
    await supabase
      .from('users')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', userId);
  } catch {
    /* silêncio proposital: ver comentário acima */
  }
}

export async function upgradePasswordHash(userId: string, newHash: string): Promise<void> {
  await supabase.from('users').update({ password_hash: newHash }).eq('id', userId);
}

export function getTokenConfig() {
  return {
    expiresIn: env.JWT_EXPIRES_IN,
    refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
  };
}
