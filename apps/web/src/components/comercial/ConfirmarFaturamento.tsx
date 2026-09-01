import { AlertTriangle } from 'lucide-react';
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
 * O aviso antes do carimbo do faturamento.
 *
 * Marcar faturado é o fim da linha do pedido: ele trava para sempre — nem
 * peças, nem desconto, nem condição de pagamento mudam depois. Quem carimba é
 * a venda interna, no celular, com a lista aberta; um toque errado no cartão
 * ao lado fecharia o pedido errado sem volta. Por isso a pergunta nomeia o
 * pedido, o cliente e o valor — decisão do Yan (01/09/2026): "pede uma
 * confirmação pra ela, porque a ação é irreversível".
 *
 * Cancelar é a saída fácil (clique fora fecha); confirmar diz o que faz.
 */
export function ConfirmarFaturamento({
  numero,
  cliente,
  total,
  ocupado,
  onConfirmar,
  onCancelar,
}: Props) {
  const titulo = `Marcar o pedido #${numero ?? ''} como faturado?`;
  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={titulo}
    >
      <div className="absolute inset-0 bg-foreground/40" onClick={onCancelar} aria-hidden />
      <div className="animate-slide-up relative w-full max-w-md rounded-t-2xl border-t-4 border-warn bg-card p-5 shadow-xl sm:rounded-2xl sm:border-t-0">
        <div className="flex gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-warn-soft text-warn-soft-foreground">
            <AlertTriangle className="h-5 w-5" strokeWidth={2.5} />
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
            {/* Sem número, o pedido ainda não foi para a fábrica — dizer isso
                evita carimbar o rascunho errado achando que é o enviado. */}
            {numero == null && (
              <p className="mt-1 text-xs text-warn-soft-foreground">
                Este pedido ainda não tem número da fábrica.
              </p>
            )}
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Depois disso o pedido trava: não dá mais para alterar peças, desconto nem a condição
              de pagamento. Para desfazer, só falando com o financeiro.
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onCancelar} disabled={ocupado}>
            Cancelar
          </Button>
          <Button
            className="bg-positive hover:bg-positive/90 active:bg-positive/80"
            onClick={onConfirmar}
            disabled={ocupado}
          >
            {ocupado ? (
              <>
                <Spinner />
                Marcando…
              </>
            ) : (
              'Sim, está faturado'
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
