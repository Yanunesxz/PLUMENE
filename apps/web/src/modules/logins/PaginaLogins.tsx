import { useEffect, useMemo, useState } from 'react';
import { UserPlus, X, Search, ShieldCheck } from 'lucide-react';
import { useAuthStore } from '../../store/authStore.js';
import { api } from '../../services/api.js';
import { Input } from '../../components/interface/Input.js';
import { Button } from '../../components/interface/Button.js';
import { Skeleton } from '../../components/interface/Skeleton.js';
import { Toast } from '../../components/interface/Toast.js';
import { CartaoDeLogin } from './CartaoDeLogin.js';
import { FormularioDeLogin, type DadosDoFormulario } from './FormularioDeLogin.js';
import { ehPapelGerenciavel, ehSoLeitura } from '@csb/shared';
import type {
  UsuarioListItem,
  CriarUsuarioRequest,
  AtualizarUsuarioRequest,
  ApiResponse,
  UserRole,
} from '@csb/shared';

/**
 * Grupos na ordem em que a fábrica pensa: quem manda primeiro.
 *
 * Papel que não está aqui fica INVISÍVEL na tela — a lista é filtrada grupo
 * por grupo, e o que não casa com nenhum não aparece. Foi por isso que o
 * visualizador (054, 15/10/2026) teve de entrar junto com o papel.
 */
const GRUPOS: Array<{ papel: UserRole; titulo: string }> = [
  { papel: 'admin', titulo: 'Administradores' },
  { papel: 'manager', titulo: 'Gerentes' },
  { papel: 'financeiro', titulo: 'Financeiro' },
  { papel: 'relacionamento', titulo: 'Relacionamento' },
  { papel: 'visualizador', titulo: 'Visualizadores' },
  { papel: 'rep', titulo: 'Representantes' },
  { papel: 'store', titulo: 'Lojas' },
];

type Resposta = ApiResponse<UsuarioListItem> & { aviso?: string };

export function PaginaLogins() {
  const { token, user } = useAuthStore();
  // O visualizador (054) entra para LER quem tem acesso: nenhum botão de ação
  // nesta tela aparece para ele — nem "Novo login", nem editar, bloquear ou
  // excluir no cartão. "nao pode mudar logins e etc.." (Yan, 15/10/2026).
  const soLeitura = ehSoLeitura(user?.role);
  const [usuarios, setUsuarios] = useState<UsuarioListItem[] | null>(null);
  const [busca, setBusca] = useState('');
  const [form, setForm] = useState<{ aberto: boolean; editando: UsuarioListItem | null }>({
    aberto: false,
    editando: null,
  });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const avisar = (message: string, ehErro = false) =>
    setToast({ message, type: ehErro ? 'error' : 'success' });

  useEffect(() => {
    if (!token) return;
    void api
      .get<ApiResponse<UsuarioListItem[]>>('/usuarios', token)
      .then((r) => setUsuarios(r.data))
      .catch(() => setUsuarios([]));
  }, [token]);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const lista = usuarios ?? [];
    if (!q) return lista;
    return lista.filter(
      (u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
    );
  }, [usuarios, busca]);

  const trocar = (novo: UsuarioListItem) =>
    setUsuarios((prev) => (prev ?? []).map((u) => (u.id === novo.id ? novo : u)));

  const fechar = () => {
    setForm({ aberto: false, editando: null });
    setErro('');
  };

  const salvar = async (dados: DadosDoFormulario) => {
    if (!token) return;
    setErro('');

    if (!dados.name.trim() || !dados.email.trim()) {
      setErro('Preencha nome e e-mail.');
      return;
    }
    if (!form.editando && !dados.password) {
      setErro('Defina uma senha inicial.');
      return;
    }

    setSalvando(true);
    try {
      if (form.editando) {
        // Papel e teclas só viajam quando o login é dos que nascem AQUI
        // (PAPEIS_GERENCIAVEIS, no shared). Era a mesma lista escrita à mão, a
        // quarta de cinco iguais — e sem o visualizador nela, editar um
        // visualizador mandaria o papel em branco.
        const daFabrica = ehPapelGerenciavel(form.editando.role);
        const corpo: AtualizarUsuarioRequest = {
          name: dados.name,
          email: dados.email,
          ...(dados.password ? { password: dados.password } : {}),
          // Para um rep ou uma loja, este formulário mexe em nome, e-mail e
          // senha e mais nada: o papel deles não se troca por aqui.
          ...(daFabrica
            ? {
                role: dados.role,
                permissions: dados.role === 'manager' ? dados.permissions : null,
              }
            : {}),
        };
        const res = await api.patch<Resposta>(`/usuarios/${form.editando.id}`, corpo, token);
        trocar(res.data);
        avisar(res.aviso ?? 'Login atualizado.', Boolean(res.aviso));
      } else {
        const corpo: CriarUsuarioRequest = {
          name: dados.name,
          email: dados.email,
          password: dados.password,
          role: dados.role,
          ...(dados.role === 'manager' ? { permissions: dados.permissions } : {}),
        };
        const res = await api.post<Resposta>('/usuarios', corpo, token);
        setUsuarios((prev) => [...(prev ?? []), res.data]);
        avisar(res.aviso ?? 'Login criado.', Boolean(res.aviso));
      }
      fechar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  };

  const alternarAtivo = async (u: UsuarioListItem) => {
    if (!token || ocupado) return;
    if (
      u.active &&
      !window.confirm(
        `Bloquear o acesso de "${u.name}"?\n\n` +
          'Ele não consegue mais entrar. Quem estiver com o app aberto agora cai em até 1 hora. ' +
          'O histórico é preservado e você pode desbloquear quando quiser.',
      )
    ) {
      return;
    }

    setOcupado(u.id);
    try {
      const res = await api.patch<Resposta>(`/usuarios/${u.id}`, { active: !u.active }, token);
      trocar(res.data);
      avisar(u.active ? 'Acesso bloqueado.' : 'Acesso liberado.');
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'Não foi possível alterar o acesso.', true);
    } finally {
      setOcupado(null);
    }
  };

  const excluir = async (u: UsuarioListItem) => {
    if (!token || ocupado) return;
    if (
      !window.confirm(
        `Excluir o login de "${u.name}"?\n\nEsta ação não pode ser desfeita. Se a ideia é só tirar o acesso, use o cadeado — o histórico fica preservado.`,
      )
    ) {
      return;
    }

    setOcupado(u.id);
    try {
      await api.del<ApiResponse<{ ok: boolean }>>(`/usuarios/${u.id}`, token);
      setUsuarios((prev) => (prev ?? []).filter((x) => x.id !== u.id));
      avisar('Login excluído.');
    } catch (e) {
      // Login com pedido no histórico não pode sumir — oferece o caminho que existe.
      if ((e as Error & { code?: string }).code === 'HAS_ORDERS' && u.active) {
        if (window.confirm(`${(e as Error).message}\n\nDeseja BLOQUEAR o acesso dele agora?`)) {
          setOcupado(null);
          await alternarAtivo(u);
          return;
        }
      }
      avisar(e instanceof Error ? e.message : 'Não foi possível excluir.', true);
    } finally {
      setOcupado(null);
    }
  };

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="titulo text-[26px] leading-none text-foreground md:text-[32px]">Logins</h1>
          {usuarios && <p className="text-sm text-muted-foreground">{usuarios.length} no total</p>}
        </div>
        {!soLeitura && (
          <Button
            size="md"
            onClick={() => (form.aberto ? fechar() : setForm({ aberto: true, editando: null }))}
          >
            {form.aberto ? (
              <X className="h-4 w-4" strokeWidth={2.5} />
            ) : (
              <UserPlus className="h-4 w-4" strokeWidth={2.5} />
            )}
            {form.aberto ? 'Cancelar' : 'Novo login'}
          </Button>
        )}
      </div>

      <div className="mb-4 flex items-start gap-2 rounded-lg bg-muted px-3 py-2.5 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        {soLeitura ? (
          <p>
            Seu acesso é de <strong className="font-semibold">Visualizador</strong>: você vê tudo e
            não altera nada. Esta lista está aqui para você saber quem tem acesso — criar, editar,
            bloquear e excluir login são do administrador.
          </p>
        ) : (
          <p>
            Bloquear tira o acesso: a pessoa não entra mais e quem já estiver com o app aberto cai
            em até 1 hora. Representante e loja são criados nas telas próprias — aqui você controla
            o login deles. <strong className="font-semibold">Visualizador</strong> vê tudo e não
            altera nada: serve para quem precisa acompanhar sem o risco de mexer.
          </p>
        )}
      </div>

      {form.aberto && (
        <FormularioDeLogin
          // Trocar de login com o formulário aberto precisa reiniciar os campos.
          key={form.editando?.id ?? 'novo'}
          editando={form.editando}
          salvando={salvando}
          erro={erro}
          onSalvar={(d) => void salvar(d)}
          onCancelar={fechar}
        />
      )}

      {usuarios === null ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          {usuarios.length > 6 && (
            <div className="relative mb-4">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                inputMode="search"
                placeholder="Buscar por nome ou e-mail…"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                className="pl-9"
              />
            </div>
          )}

          {GRUPOS.map(({ papel, titulo }) => {
            const doGrupo = filtrados.filter((u) => u.role === papel);
            if (doGrupo.length === 0) return null;
            return (
              <section key={papel} className="mb-6">
                <h2 className="mb-2 text-sm font-semibold text-foreground">
                  {titulo}
                  <span className="ml-1.5 font-normal text-muted-foreground">
                    ({doGrupo.length})
                  </span>
                </h2>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {doGrupo.map((u) => (
                    <CartaoDeLogin
                      key={u.id}
                      usuario={u}
                      ehVoce={u.id === user?.id}
                      ocupado={ocupado === u.id}
                      soLeitura={soLeitura}
                      onEditar={() => {
                        setErro('');
                        setForm({ aberto: true, editando: u });
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                      onAlternarAtivo={() => void alternarAtivo(u)}
                      onExcluir={() => void excluir(u)}
                    />
                  ))}
                </div>
              </section>
            );
          })}

          {filtrados.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {busca ? 'Nenhum login encontrado.' : 'Nenhum login cadastrado.'}
            </p>
          )}
        </>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onDone={() => setToast(null)} />}
    </div>
  );
}
