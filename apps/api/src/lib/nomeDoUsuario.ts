import { supabase } from '../config/supabase.js';

/**
 * O nome de um usuário pelo id — para o detalhe do pedido dizer "por Fulana"
 * em quem cancelou (053) e em quem inativou (055). O pedido guarda só o id
 * (coluna com ON DELETE SET NULL); o nome se resolve na leitura. Nulo quando
 * o login já não existe.
 */
export async function nomeDoUsuario(user_id: string | null | undefined): Promise<string | null> {
  if (!user_id) return null;
  const { data } = await supabase.from('users').select('name').eq('id', user_id).maybeSingle();
  return (data as { name: string } | null)?.name ?? null;
}
