import { useEffect, useState } from 'react';
import { ListX, Pencil, Check, X } from 'lucide-react';
import { useAuthStore } from '../../store/authStore.js';
import { api } from '../../services/api.js';
import { Input } from '../../components/interface/Input.js';
import { Button } from '../../components/interface/Button.js';
import type { ApiResponse, MotivoDeCancelamento } from '@csb/shared';

/**
 * "Motivos de cancelamento" — a lista que aparece quando alguém cancela um
 * pedido (migração 053).
 *
 * Yan (30/09/2026): "os motivos, deixe que o admin crie e escolha". Só o
 * admin. Desativar em vez de apagar: pedido antigo guarda o motivo pelo texto,
 * e o motivo desativado some da janela de cancelar sem sumir do histórico.
 */
export function MotivosDeCancelamento() {
  const { token } = useAuthStore();
  const [motivos, setMotivos] = useState<MotivoDeCancelamento[] | null>(null);
  const [novo, setNovo] = useState('');
  const [editando, setEditando] = useState<string | null>(null);
  const [texto, setTexto] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = async () => {
    if (!token) return;
    try {
      const r = await api.get<ApiResponse<MotivoDeCancelamento[]>>('/orders/motivos-de-cancelamento?todos=1', token);
      setMotivos(r.data);
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não deu para carregar os motivos.');
    }
  };

  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const salvar = async (acao: () => Promise<unknown>) => {
    if (!token || ocupado) return;
    setOcupado(true);
    setErro(null);
    try {
      await acao();
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar.');
    } finally {
      setOcupado(false);
    }
  };

  const criar = () =>
    salvar(async () => {
      await api.post<ApiResponse<MotivoDeCancelamento>>('/orders/motivos-de-cancelamento', { label: novo.trim() }, token!);
      setNovo('');
    });

  const renomear = (id: string) =>
    salvar(async () => {
      await api.patch(`/orders/motivos-de-cancelamento/${id}`, { label: texto.trim() }, token!);
      setEditando(null);
    });

  const alternar = (m: MotivoDeCancelamento) =>
    salvar(() => api.patch(`/orders/motivos-de-cancelamento/${m.id}`, { active: !m.active }, token!));

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Motivos de cancelamento
      </h2>
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <p className="mb-3 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
          <ListX className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          A lista que aparece para quem cancela um pedido. Desativar tira o motivo da lista sem apagar
          do histórico dos pedidos que já usaram.
        </p>

        {erro && <p className="mb-3 text-sm text-danger">{erro}</p>}

        {motivos === null ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : (
          <ul className="divide-y divide-border">
            {motivos.map((m) => (
              <li key={m.id} className="flex items-center gap-2 py-2">
                {editando === m.id ? (
                  <>
                    <Input value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={120} className="flex-1" />
                    <Button size="icon" variant="outline" disabled={ocupado || texto.trim().length < 2} onClick={() => void renomear(m.id)} aria-label="Salvar">
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => setEditando(null)} aria-label="Cancelar edição">
                      <X className="h-4 w-4" />
                    </Button>
                  </>
                ) : (
                  <>
                    <span className={`min-w-0 flex-1 text-sm ${m.active ? 'text-foreground' : 'text-subtle line-through'}`}>
                      {m.label}
                    </span>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => {
                        setEditando(m.id);
                        setTexto(m.label);
                      }}
                      aria-label={`Renomear ${m.label}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="outline" disabled={ocupado} onClick={() => void alternar(m)}>
                      {m.active ? 'Desativar' : 'Reativar'}
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (novo.trim().length >= 2) void criar();
          }}
        >
          <Input
            value={novo}
            onChange={(e) => setNovo(e.target.value)}
            maxLength={120}
            placeholder="Novo motivo — ex.: CLIENTE SEM LIMITE DE CRÉDITO"
            className="flex-1"
            aria-label="Novo motivo de cancelamento"
          />
          <Button type="submit" disabled={ocupado || novo.trim().length < 2}>
            Adicionar
          </Button>
        </form>
      </div>
    </section>
  );
}
