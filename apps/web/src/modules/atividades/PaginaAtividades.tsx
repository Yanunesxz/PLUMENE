import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, MapPin, Trash2, CheckCircle2, Clock3 } from 'lucide-react';
import { useAuthStore } from '../../store/authStore.js';
import { api } from '../../services/api.js';
import { Badge } from '../../components/interface/Badge.js';
import { Button } from '../../components/interface/Button.js';
import { Skeleton } from '../../components/interface/Skeleton.js';
import { Toast } from '../../components/interface/Toast.js';
import type { ApiResponse, TarefaDoRep } from '@csb/shared';

/**
 * As atividades do dia a dia — a resposta a "como eu vou ver?".
 *
 * É a mesa de quem marca: o Fabian vê o que pediu, a Bruna acompanha as
 * visitas que combinou (o OK do representante aparece aqui), e a gerência
 * enxerga tudo. O representante NÃO usa esta tela — as tarefas dele chegam
 * na Minha Área, com os botões de OK e Feito.
 */
export function PaginaAtividades() {
  const { token, user } = useAuthStore();
  const [tarefas, setTarefas] = useState<TarefaDoRep[] | null>(null);
  const [ocupada, setOcupada] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    if (!token) return;
    api
      .get<ApiResponse<TarefaDoRep[]>>('/tarefas', token)
      .then((r) => setTarefas(r.data))
      .catch(() => setTarefas([]));
  }, [token]);

  const excluir = async (id: string) => {
    if (!token || ocupada) return;
    setOcupada(id);
    try {
      await api.del<ApiResponse<{ ok: boolean }>>(`/tarefas/${id}`, token);
      setTarefas((ts) => (ts ?? []).filter((t) => t.id !== id));
      setToast({ message: 'Tarefa excluída.', type: 'success' });
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : 'Não foi possível excluir.',
        type: 'error',
      });
    } finally {
      setOcupada(null);
    }
  };

  const abertas = (tarefas ?? []).filter((t) => t.status !== 'feita');
  const feitas = (tarefas ?? []).filter((t) => t.status === 'feita').slice(0, 12);
  // Excluir: quem criou, ou a gerência (a API confere de novo).
  const podeExcluir = (t: TarefaDoRep) =>
    user?.role === 'admin' || user?.role === 'manager' || t.criado_por_nome === user?.name;

  return (
    <div className="p-4 md:p-6">
      <h1 className="titulo text-[26px] leading-none text-foreground md:text-[32px]">Atividades</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        O que foi marcado para os representantes e o andamento de cada coisa. Para marcar uma
        visita, abra a ficha do cliente em <Link to="/customers" className="underline">Clientes</Link>.
      </p>

      {tarefas === null ? (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))}
        </div>
      ) : tarefas.length === 0 ? (
        <div className="mt-8 flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-12 text-center">
          <CalendarClock className="h-6 w-6 text-subtle" strokeWidth={1.5} />
          <p className="text-sm text-muted-foreground">
            Nenhuma tarefa marcada ainda. Comece pela lista de Clientes: os desativados (vermelhos)
            são as primeiras ligações.
          </p>
        </div>
      ) : (
        <>
          {abertas.length > 0 && (
            <section className="mt-5">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Em andamento ({abertas.length})
              </h2>
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {abertas.map((t) => (
                  <li key={t.id} className="rounded-xl border border-border bg-card p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-foreground">{t.titulo}</p>
                      {t.status === 'confirmada' ? (
                        <Badge variant="green">OK dado</Badge>
                      ) : (
                        <Badge variant="yellow">Aguardando OK</Badge>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t.rep_nome ? `para ${t.rep_nome}` : 'representante da carteira'}
                      {t.criado_por_nome ? ` · marcado por ${t.criado_por_nome}` : ''}
                    </p>
                    {t.cliente_nome && (
                      <p className="truncate text-xs text-muted-foreground">Cliente: {t.cliente_nome}</p>
                    )}
                    {t.prazo && (
                      <p className="mt-1 flex items-center gap-1 text-xs text-foreground">
                        <Clock3 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        {new Date(t.prazo).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                        {' às '}
                        {new Date(t.prazo).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    )}
                    {t.local && (
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-foreground">
                        <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">{t.local}</span>
                      </p>
                    )}
                    {t.observacoes && (
                      <p className="mt-1.5 whitespace-pre-wrap rounded-lg bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">
                        {t.observacoes}
                      </p>
                    )}
                    {podeExcluir(t) && (
                      <div className="mt-2 flex justify-end">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={ocupada === t.id}
                          onClick={() => void excluir(t.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                          Excluir
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {feitas.length > 0 && (
            <section className="mt-6">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Feitas
              </h2>
              <ul className="overflow-hidden rounded-xl border border-border bg-card">
                {feitas.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-center gap-2.5 border-b border-border px-4 py-2.5 last:border-b-0"
                  >
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-positive-soft-foreground" strokeWidth={2} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-muted-foreground">{t.titulo}</p>
                      <p className="truncate text-[11px] text-subtle">
                        {t.rep_nome ?? ''}
                        {t.cliente_nome ? ` · ${t.cliente_nome}` : ''}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onDone={() => setToast(null)} />}
    </div>
  );
}
