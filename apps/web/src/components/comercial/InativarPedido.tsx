import { useState } from 'react';
import { Ban } from 'lucide-react';
import { Button } from '../interface/Button.js';
import { Spinner } from '../interface/Spinner.js';

interface Props {
  numero: number | null | undefined;
  cliente?: string | undefined;
  ocupado?: boolean;
  onConfirmar: (note?: string) => void;
  onFechar: () => void;
}

/**
 * Marcar o pedido como INATIVO (migração 055).
 *
 * Pedido do Yan (15/10/2026): "se o pedido for aprovado e depois inativado a
 * pessoa não recebe a bonificação". É um carimbo, como o Faturado — o pedido
 * continua na lista, no status que tinha, e só sai da conta da bonificação.
 * Dá para desfazer ("Reativar pedido"). A observação é opcional: é onde o
 * financeiro escreve o que aconteceu no Control.
 */
export function InativarPedido({ numero, cliente, ocupado, onConfirmar, onFechar }: Props) {
  const [nota, setNota] = useState('');
  const titulo = numero ? `Inativar o pedido #${numero}?` : 'Inativar este pedido?';

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={titulo}
    >
      <div className="absolute inset-0 bg-foreground/40" onClick={onFechar} aria-hidden />
      <div className="animate-slide-up relative w-full max-w-md rounded-t-2xl border-t-4 border-warn bg-card p-5 shadow-xl sm:rounded-2xl sm:border-t-0">
        <div className="flex gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-warn-soft text-warn-soft-foreground">
            <Ban className="h-5 w-5" strokeWidth={2.5} />
          </div>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold leading-snug text-foreground">{titulo}</p>
            {cliente && <p className="mt-1 truncate text-sm font-medium text-foreground">{cliente}</p>}
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              O pedido continua na lista, mas sai da bonificação do mês do representante — ele
              recebe o aviso. Dá para reativar depois.
            </p>
          </div>
        </div>

        <form
          className="mt-4 grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            onConfirmar(nota.trim() || undefined);
          }}
        >
          <textarea
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="Observação (opcional) — o que aconteceu no Control"
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            aria-label="Observação da inativação"
          />
          <div className="mt-1 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={onFechar} disabled={ocupado}>
              Voltar
            </Button>
            <Button type="submit" disabled={ocupado}>
              {ocupado ? (
                <>
                  <Spinner /> Marcando…
                </>
              ) : (
                'Inativar pedido'
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
