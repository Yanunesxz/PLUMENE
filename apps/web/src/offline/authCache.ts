import type { LoginResponse } from '@csb/shared';

// Cache de UM login no localStorage para permitir autenticação offline.
// Guardamos o hash SHA-256 da senha (nunca o texto puro) + os dados de sessão
// retornados pela API no último login online bem-sucedido.
//
// SHA-256 é implementado em JS puro de propósito: `crypto.subtle` só existe em
// contexto seguro (HTTPS/localhost) e ficaria indefinido se o app fosse acessado
// por HTTP puro na rede local — o que quebraria o login offline silenciosamente.

const KEY = 'csb-offline-cred';

export interface OfflineCredential {
  email: string;
  password_hash: string;
  token: string;
  refresh_token: string;
  user: LoginResponse['user'];
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function rightRotate(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount));
}

// SHA-256 hex de uma string (UTF-8). Sem dependências externas nem contexto seguro.
export function hashPassword(input: string): string {
  const maxWord = 2 ** 32;
  const hash: number[] = [];
  const k: number[] = [];
  let primeCounter = 0;
  const isComposite: Record<number, number> = {};
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (let i = 0; i < 313; i += candidate) isComposite[i] = candidate;
      hash[primeCounter] = (candidate ** 0.5 * maxWord) | 0;
      k[primeCounter++] = (candidate ** (1 / 3) * maxWord) | 0;
    }
  }

  // UTF-8 encode
  const bytes: number[] = [];
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    if (c < 128) bytes.push(c);
    else if (c < 2048) bytes.push(192 | (c >> 6), 128 | (c & 63));
    else bytes.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63));
  }

  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 7; i >= 0; i--) bytes.push((bitLength / 2 ** (i * 8)) & 0xff);

  const words: number[] = [];
  for (let i = 0; i < bytes.length; i += 4) {
    words.push(((bytes[i] ?? 0) << 24) | ((bytes[i + 1] ?? 0) << 16) | ((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0));
  }

  let h = hash.slice(0, 8);
  const w: number[] = [];
  for (let j = 0; j < words.length; j += 16) {
    const oldHash = h.slice(0);
    for (let i = 0; i < 64; i++) {
      if (i < 16) {
        w[i] = words[j + i]! | 0;
      } else {
        const s0 = rightRotate(w[i - 15]!, 7) ^ rightRotate(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
        const s1 = rightRotate(w[i - 2]!, 17) ^ rightRotate(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
        w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) | 0;
      }
      const S1 = rightRotate(h[4]!, 6) ^ rightRotate(h[4]!, 11) ^ rightRotate(h[4]!, 25);
      const ch = (h[4]! & h[5]!) ^ (~h[4]! & h[6]!);
      const temp1 = (h[7]! + S1 + ch + k[i]! + w[i]!) | 0;
      const S0 = rightRotate(h[0]!, 2) ^ rightRotate(h[0]!, 13) ^ rightRotate(h[0]!, 22);
      const maj = (h[0]! & h[1]!) ^ (h[0]! & h[2]!) ^ (h[1]! & h[2]!);
      const temp2 = (S0 + maj) | 0;
      h = [(temp1 + temp2) | 0, h[0]!, h[1]!, h[2]!, (h[3]! + temp1) | 0, h[4]!, h[5]!, h[6]!];
    }
    for (let i = 0; i < 8; i++) h[i] = (h[i]! + oldHash[i]!) | 0;
  }

  let result = '';
  for (let i = 0; i < 8; i++) {
    for (let j = 3; j >= 0; j--) {
      const b = (h[i]! >> (j * 8)) & 255;
      result += (b < 16 ? '0' : '') + b.toString(16);
    }
  }
  return result;
}

export function saveOfflineCredential(email: string, password: string, session: LoginResponse): void {
  const cred: OfflineCredential = {
    email: normalizeEmail(email),
    password_hash: hashPassword(password),
    token: session.token,
    refresh_token: session.refresh_token,
    user: session.user,
  };
  localStorage.setItem(KEY, JSON.stringify(cred));
}

export function getOfflineCredential(): OfflineCredential | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as OfflineCredential;
  } catch {
    return null;
  }
}

export type OfflineLoginResult =
  | { ok: true; cred: OfflineCredential }
  | { ok: false; reason: 'no-cred' | 'wrong-password' };

export function verifyOfflineCredential(email: string, password: string): OfflineLoginResult {
  const cred = getOfflineCredential();
  if (!cred || cred.email !== normalizeEmail(email)) {
    return { ok: false, reason: 'no-cred' };
  }
  if (hashPassword(password) !== cred.password_hash) {
    return { ok: false, reason: 'wrong-password' };
  }
  return { ok: true, cred };
}

export function clearOfflineCredential(): void {
  localStorage.removeItem(KEY);
}
