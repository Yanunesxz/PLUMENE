import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Logo } from '../../components/interface/Logo.js';
import { useAuthStore } from '../../store/authStore.js';
import { api } from '../../services/api.js';
import { saveOfflineCredential, verifyOfflineCredential } from '../../offline/authCache.js';
import { resetOfflineIfUserChanged } from '../../offline/db.js';
import { Input } from '../../components/interface/Input.js';
import { Button } from '../../components/interface/Button.js';
import { Spinner } from '../../components/interface/Spinner.js';
import type { LoginResponse, ApiResponse } from '@csb/shared';

export function PaginaLogin() {
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isAuthenticated) navigate('/', { replace: true });
  }, [isAuthenticated, navigate]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.post<ApiResponse<LoginResponse>>('/auth/login', { email, password });
      // Zera o cache offline se for outro usuário/empresa (evita misturar dados).
      await resetOfflineIfUserChanged(res.data.user.id);
      login(res.data.token, res.data.refresh_token, res.data.user);
      // Guarda esse login para permitir autenticação offline depois.
      saveOfflineCredential(email, password, res.data);
      navigate('/', { replace: true });
    } catch (err) {
      // Falha de rede (offline ou API inacessível): tenta o login salvo localmente.
      const isNetworkError = !navigator.onLine || err instanceof TypeError;
      if (isNetworkError) {
        const offline = verifyOfflineCredential(email, password);
        if (offline.ok) {
          await resetOfflineIfUserChanged(offline.cred.user.id);
          login(offline.cred.token, offline.cred.refresh_token, offline.cred.user);
          navigate('/', { replace: true });
          return;
        }
        setError(
          offline.reason === 'wrong-password'
            ? 'Senha incorreta (modo offline).'
            : 'Você está offline e não há login salvo neste dispositivo para esse e-mail.',
        );
      } else {
        setError(err instanceof Error ? err.message : 'Erro ao fazer login');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <Logo className="h-20 w-20" />
          <div>
            <h1 className="text-xl font-bold tracking-tight text-foreground">Corpo Sensual</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">Representantes</p>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="email" className="text-sm font-medium text-foreground">
                E-mail
              </label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="seu@email.com"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="password" className="text-sm font-medium text-foreground">
                Senha
              </label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder="••••••••"
              />
            </div>

            {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-soft-foreground">{error}</p>}

            <Button type="submit" size="lg" disabled={loading} className="w-full">
              {loading ? (
                <>
                  <Spinner />
                  Entrando…
                </>
              ) : (
                'Entrar'
              )}
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">© 2026 Corpo Sensual</p>
      </div>
    </div>
  );
}
