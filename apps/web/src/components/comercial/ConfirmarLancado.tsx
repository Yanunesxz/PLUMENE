import { ClipboardCheck } from 'lucide-react';
import { Button } from '../interface/Button.js';
import { Spinner } from '../interface/Spinner.js';
import { formatBRL } from '../../lib/utils.js';

interface Props {
  /** Número do pedido, para a pessoa conferir que é aquele mesmo. */
  numero: number | null | undefined;
  cliente?: string | undefined;
  total?: number | null | undefined;
  ocupado?: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
}

/**
 * A pergunta antes de marcar um pedido como lançado SEM o número do Control.
 *
 * O financeiro recebe pedido por outros meios e a numeração do Control não
 * segue a do app (Yan, 12/11/2026) — o pedido que já está lá ficava preso em
 * "A lançar" por falta de um número. Passar para "A faturar" não tem volta,
 * por isso a pergunta nomeia o pedido, o cliente e o valor, como no carimbo do
 * faturado.
 */
export function ConfirmarLancado({ numero, cliente, total, ocupado, onConfirmar, onCancelar }: Props) {
  const titulo = `Marcar o pedido #${numero ?? ''} como lançado?`;
  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={titulo}
    >
      <div className="absolute inset-0 bg-foreground/40" onClick={ocupado ? undefined : onCancelar} aria-hidden />
      <div className="animate-slide-up relative w-full max-w-md rounded-t-2xl border-t-4 border-primary bg-card p-5 shadow-xl sm:rounded-2xl sm:border-t-0">
        <div className="flex gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary-soft-foreground">
            <ClipboardCheck className="h-5 w-5" strokeWidth={2.5} />
          </div>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold leading-snug text-foreground">{titulo}</p>
            {(cliente || total != null) && (
              <p className="mt-1 truncate text-sm font-medium text-foreground">
                {cliente}
                {cliente && total != null ? ' · ' : ''}
                {total != null ? formatBRL(total) : ''}
              </p>
            )}
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Ele sai de “A lançar” e vai para “A faturar” sem o número do Control. Use quando o
              pedido já está lançado lá. Não dá para voltar para “A lançar”.
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onCancelar} disabled={ocupado}>
            Cancelar
          </Button>
          <Button onClick={onConfirmar} disabled={ocupado}>
            {ocupado ? (
              <>
                <Spinner />
                Marcando…
              </>
            ) : (
              'Sim, já foi lançado'
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
