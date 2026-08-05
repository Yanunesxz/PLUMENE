import { useAuthStore } from '../store/authStore.js';

const API_BASE = (import.meta.env['VITE_API_URL'] as string | undefined) ?? 'http://localhost:3001';

// Garante que apenas uma renovação de token aconteça por vez: se várias
// requisições receberem 401 ao mesmo tempo, todas aguardam o mesmo refresh.
let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const { refresh_token, setToken, logout } = useAuthStore.getState();
  if (!refresh_token) return null;

  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token }),
    });
    if (!res.ok) {
      // Refresh token expirado/inválido: derruba a sessão para forçar novo login.
      logout();
      return null;
    }
    const body = (await res.json()) as { data: { token: string } };
    setToken(body.data.token);
    return body.data.token;
  } catch {
    return null;
  }
}

async function request<T>(
  path: string,
  options: RequestInit & { token?: string | undefined } = {},
): Promise<T> {
  const { token, ...init } = options;

  const doFetch = (authToken: string | undefined): Promise<Response> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(init.headers as Record<string, string>),
    };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    return fetch(`${API_BASE}${path}`, { ...init, headers });
  };

  let res = await doFetch(token);

  // Token de acesso expirou (1h): tenta renovar com o refresh_token e repete uma vez.
  // Não tenta renovar nas próprias rotas de auth para evitar laço.
  if (res.status === 401 && token && !path.startsWith('/auth/')) {
    refreshPromise ??= refreshAccessToken().finally(() => {
      refreshPromise = null;
    });
    const newToken = await refreshPromise;
    if (newToken) {
      res = await doFetch(newToken);
    }
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    const err = new Error(body.error ?? `HTTP ${res.status}`);
    (err as Error & { code?: string | undefined }).code = body.code;
    throw err;
  }

  return res.json() as Promise<T>;
}

/**
 * Listas grandes que várias telas pedem: catálogo e carteira.
 *
 * Painel, Pedidos e Clientes buscavam `/customers` cada uma na montagem — ir de
 * uma para a outra baixava os 1.353 clientes três vezes. Aqui a mesma chamada é
 * compartilhada: quem chega enquanto a primeira está no ar espera a mesma
 * resposta, e quem chega logo depois recebe a que já veio.
 *
 * Sem invalidação por enquanto porque cliente e produto mudam pelo ERP, não pelo
 * app — a janela cobre a navegação, não o dia.
 */
const JANELA_MS = 5 * 60_000;
const emVoo = new Map<string, Promise<unknown>>();
const recentes = new Map<string, { quando: number; valor: unknown }>();

function chave(path: string, token: string | undefined): string {
  // O token entra na chave para nunca servir dado de uma conta a outra: ao
  // trocar de usuário, a chave muda junto.
  return `${path}|${token ?? ''}`;
}

function getCompartilhado<T>(path: string, token?: string): Promise<T> {
  const k = chave(path, token);

  const recente = recentes.get(k);
  if (recente && Date.now() - recente.quando < JANELA_MS) {
    return Promise.resolve(recente.valor as T);
  }

  const jaPedido = emVoo.get(k);
  if (jaPedido) return jaPedido as Promise<T>;

  const promessa = request<T>(path, { method: 'GET', token })
    .then((valor) => {
      recentes.set(k, { quando: Date.now(), valor });
      return valor;
    })
    .finally(() => {
      emVoo.delete(k);
    });

  emVoo.set(k, promessa);
  return promessa;
}

/** Descarta o que está guardado — usar depois de uma escrita que muda a lista. */
export function esquecerCache(path?: string): void {
  if (!path) {
    recentes.clear();
    return;
  }
  for (const k of recentes.keys()) {
    if (k.startsWith(`${path}|`)) recentes.delete(k);
  }
}

export const api = {
  get: <T>(path: string, token?: string) => request<T>(path, { method: 'GET', token }),
  /** GET de lista grande, compartilhado entre telas. Ver `getCompartilhado`. */
  getLista: getCompartilhado,
  post: <T>(path: string, body: unknown, token?: string) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body), token }),
  patch: <T>(path: string, body: unknown, token?: string) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body), token }),
  /** PUT quando o corpo SUBSTITUI o recurso inteiro (a meta de um mês). */
  put: <T>(path: string, body: unknown, token?: string) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body), token }),
  del: <T>(path: string, token?: string) => request<T>(path, { method: 'DELETE', token }),
  /** POST de binário cru (ex.: foto já redimensionada) — não passa por JSON. */
  postBlob: <T>(path: string, blob: Blob, token?: string) =>
    request<T>(path, {
      method: 'POST',
      body: blob,
      headers: { 'Content-Type': blob.type || 'application/octet-stream' },
      token,
    }),
};
