import bcrypt from 'bcryptjs';
import { createHash } from 'crypto';

// Hash de senha. Novos hashes são bcrypt. Hashes SHA-256 antigos (MVP) ainda
// são aceitos no login e convertidos para bcrypt no primeiro acesso (migração
// suave, sem deslogar ninguém).

const BCRYPT_ROUNDS = 10;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** É um hash bcrypt? ($2a$/$2b$/$2y$) */
function isBcrypt(hash: string): boolean {
  return /^\$2[aby]\$/.test(hash);
}

export interface VerifyResult {
  ok: boolean;
  /** true quando a senha bateu mas o hash é SHA-256 legado (deve ser re-hasheado). */
  legacy: boolean;
}

export async function verifyPassword(plain: string, stored: string): Promise<VerifyResult> {
  if (isBcrypt(stored)) {
    return { ok: await bcrypt.compare(plain, stored), legacy: false };
  }
  return { ok: sha256(plain) === stored, legacy: true };
}
