import crypto from 'node:crypto';

/**
 * Tokens dos links de acesso (convite da loja e vitrine temporária).
 *
 * O valor original existe UMA vez: dentro do link entregue à pessoa. No banco
 * fica só o SHA-256. Quem tiver o dump não consegue abrir link nenhum.
 *
 * Não é senha de usuário — por isso SHA-256 e não bcrypt: o token tem 256 bits
 * de entropia aleatória, não há o que adivinhar, e a verificação acontece a
 * cada abertura de link (bcrypt seria lento sem ganho nenhum aqui).
 */

/** 32 bytes aleatórios em base64url — 43 caracteres seguros para URL. */
export function generateToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
