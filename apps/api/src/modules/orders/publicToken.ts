import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env.js';

/**
 * Token público do pedido, para o link que vai no e-mail do cliente.
 *
 * É o id do pedido + uma assinatura HMAC. Não precisa de coluna nem migração: o
 * link é derivado do id, e só quem tem o segredo consegue forjar um. Assim o
 * cliente abre `/pedido/<token>` sem login, mas ninguém adivinha o pedido do
 * vizinho trocando um número.
 */
const b64url = (b: Buffer) => b.toString('base64url');

function assinar(id: string): string {
  return b64url(createHmac('sha256', env.JWT_SECRET).update(`pedido:${id}`).digest());
}

export function tokenDoPedido(id: string): string {
  return `${b64url(Buffer.from(id))}.${assinar(id)}`;
}

/** Devolve o id do pedido se o token é válido; senão null. */
export function pedidoDoToken(token: string): string | null {
  const partes = token.split('.');
  if (partes.length !== 2) return null;
  let id: string;
  try {
    id = Buffer.from(partes[0]!, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const esperado = Buffer.from(assinar(id));
  const recebido = Buffer.from(partes[1]!);
  if (esperado.length !== recebido.length || !timingSafeEqual(esperado, recebido)) return null;
  return id;
}
