import { useEffect, useState } from 'react';
import { XCircle } from 'lucide-react';
import { Button } from '../interface/Button.js';
import { Spinner } from '../interface/Spinner.js';
import { useAuthStore } from '../../store/authStore.js';
import { api } from '../../services/api.js';
import type { ApiResponse, MotivoDeCancelamento } from '@csb/shared';

interface Props {
  numero: number | null | undefined;
  cliente?: string | undefined;
  ocupado?: boolean;
  onConfirmar: (motivo: { reason_id: string; note?: string }) => void;
  onFechar: () => void;
}

/**
 * Cancelar o pedido com MOTIVO (migração 053).
 *
 * Pedido da Larissa pelo Yan (30/09/2026). O motivo sai da lista que o admin
 * mantém; a observação é opcional — é onde ela escreve o detalhe do caso.
 */
export function CancelarPedido({ numero, cliente, ocupado, onConfirmar, onFechar }: Props) {
  const { token } = useAuthStore();
  const [motivos, setMotivos] = useState<MotivoDeCancelamento[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [escolhido, setEscolhido] = useState('');
  const [nota, setNota] = useState('');

  useEffect(() => {
    if (!token) return;
    let vivo = true;
    api
      .get<ApiResponse<MotivoDeCancelamento[]>>('/orders/motivos-de-cancelamento', token)
      .then((r) => vivo && setMotivos(r.data))
      .catch((e: unknown) => vivo && setErro(e instanceof Error ? e.message : 'Não deu para carregar os motivos.'));
    return () => {
      vivo = false;
    };
  }, [token]);

  const titulo = numero ? `Cancelar o pedido #${numero}?` : 'Cancelar este pedido?';

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={titulo}>
      <div className="absolute inset-0 bg-foreground/40" onClick={onFechar} aria-hidden />
      <div className="animate-slide-up relative w-full max-w-md rounded-t-2xl border-t-4 border-danger bg-card p-5 shadow-xl sm:rounded-2xl sm:border-t-0">
        <div className="flex gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-danger-soft text-danger-soft-foreground">
            <XCircle className="h-5 w-5" strokeWidth={2.5} />
          </div>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold leading-snug text-foreground">{titulo}</p>
            {cliente && <p className="mt-1 truncate text-sm font-medium text-foreground">{cliente}</p>}
            <p className="mt-1.5 text-sm text-muted-foreground">
              O pedido vai para a aba Cancelados e o representante recebe o aviso com o motivo.
            </p>
          </div>
        </div>

        <form
          className="mt-4 grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!escolhido) return;
            onConfirmar({ reason_id: escolhido, ...(nota.trim() ? { note: nota.trim() } : {}) });
          }}
        >
          <p className="text-sm font-medium text-foreground">Motivo</p>
          {erro ? (
            <p className="text-sm text-danger">{erro}</p>
          ) : motivos === null ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner /> Carregando os motivos…
            </p>
          ) : motivos.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum motivo cadastrado. Peça ao admin para criar no Painel.</p>
          ) : (
            <div className="grid gap-2">
              {motivos.map((m) => (
                <label key={m.id} className="flex cursor-pointer items-start gap-2 text-sm text-foreground">
                  <input
                    type="radio"
                    name="motivo-cancelamento"
                    value={m.id}
                    checked={escolhido === m.id}
                    onChange={() => setEscolhido(m.id)}
                    className="mt-0.5 h-4 w-4"
                  />
                  {m.label}
                </label>
              ))}
            </div>
          )}
          <textarea
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            maxLength={1000}
            rows={3}
            placeholder="Observação (opcional) — o que aconteceu, com quem falou"
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            aria-label="Observação do cancelamento"
          />
          <div className="mt-1 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={onFechar} disabled={ocupado}>
              Voltar
            </Button>
            <Button type="submit" variant="destructive" disabled={ocupado || !escolhido}>
              {ocupado ? (
                <>
                  <Spinner /> Cancelando…
                </>
              ) : (
                'Cancelar pedido'
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
