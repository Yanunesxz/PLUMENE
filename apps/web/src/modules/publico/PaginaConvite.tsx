import { useState, useEffect, type FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Logo } from '../../components/interface/Logo.js';
import { Input } from '../../components/interface/Input.js';
import { Button } from '../../components/interface/Button.js';
import { Spinner } from '../../components/interface/Spinner.js';
import { useAuthStore } from '../../store/authStore.js';
import { resetOfflineIfUserChanged } from '../../offline/db.js';
import { api } from '../../services/api.js';
import type { ApiResponse, ConvitePublico, LoginResponse } from '@csb/shared';

/**
 * Tela pública do convite: a loja define a própria senha e já entra.
 *
 * O convite é de uso único — por isso cada estado de recusa tem um texto
 * próprio dizendo o que fazer. "Link inválido" sem instrução só gera ligação
 * para o representante.
 */
export function PaginaConvite() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);

  const [convite, setConvite] = useState<ConvitePublico | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erroLink, setErroLink] = useState('');

  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    let cancelado = false;
    api
      .get<ApiResponse<ConvitePublico>>(`/public/invite/${token}`)
      .then((res) => {
        if (!cancelado) setConvite(res.data);
      })
      .catch((e: unknown) => {
        if (!cancelado) setErroLink(e instanceof Error ? e.message : 'Não foi possível abrir o convite.');
      })
      .finally(() => {
        if (!cancelado) setCarregando(false);
      });
    return () => {
      cancelado = true;
    };
  }, [token]);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setErro('');

    if (senha.length < 6) {
      setErro('A senha precisa de ao menos 6 caracteres.');
      return;
    }
    if (senha !== confirmacao) {
      setErro('As duas senhas não são iguais.');
      return;
    }

    setEnviando(true);
    try {
      const res = await api.post<ApiResponse<LoginResponse>>(`/public/invite/${token}`, {
        email,
        password: senha,
      });
      await resetOfflineIfUserChanged(res.data.user.id);
      login(res.data.token, res.data.refresh_token, res.data.user);
      navigate('/', { replace: true });
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível criar o acesso.');
      setEnviando(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <Logo className="h-24 w-24" />
          <h1 className="titulo text-[28px] leading-none text-foreground">Corpo Sensual</h1>
        </div>

        {carregando ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : erroLink ? (
          <div className="rounded-xl border border-border bg-card p-6 text-center">
            <p className="text-sm text-foreground">{erroLink}</p>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card p-6 sm:p-8">
            <p className="text-sm text-muted-foreground">Criando o acesso de</p>
            <p className="mb-5 mt-0.5 text-lg font-semibold leading-snug text-foreground">
              {convite?.customer_name}
            </p>

            <form onSubmit={(e) => void enviar(e)} className="space-y-4">
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
                <p className="text-xs text-muted-foreground">É com ele que você vai entrar.</p>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="senha" className="text-sm font-medium text-foreground">
                  Criar senha
                </label>
                <Input
                  id="senha"
                  type="password"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  required
                  autoComplete="new-password"
                  placeholder="Ao menos 6 caracteres"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="confirmacao" className="text-sm font-medium text-foreground">
                  Repetir a senha
                </label>
                <Input
                  id="confirmacao"
                  type="password"
                  value={confirmacao}
                  onChange={(e) => setConfirmacao(e.target.value)}
                  required
                  autoComplete="new-password"
                />
              </div>

              {erro && (
                <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-soft-foreground">{erro}</p>
              )}

              <Button type="submit" size="lg" disabled={enviando} className="w-full">
                {enviando ? (
                  <>
                    <Spinner />
                    Criando…
                  </>
                ) : (
                  'Criar acesso e entrar'
                )}
              </Button>
            </form>

            <p className="mt-4 text-center text-xs text-muted-foreground">
              Este convite vale uma vez só. Guarde a senha — quem redefine é o seu representante.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
