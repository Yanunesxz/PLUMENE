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

export const api = {
  get: <T>(path: string, token?: string) => request<T>(path, { method: 'GET', token }),
  post: <T>(path: string, body: unknown, token?: string) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body), token }),
  patch: <T>(path: string, body: unknown, token?: string) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body), token }),
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
