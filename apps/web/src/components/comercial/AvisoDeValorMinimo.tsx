import { AlertTriangle } from 'lucide-react';
import { avisoDeValorMinimo, type PaymentCondition } from '@csb/shared';

interface Props {
  /** A condição escolhida no pedido. Sem condição, não há mínimo a conferir. */
  condicao: Pick<PaymentCondition, 'valor_minimo'> | null | undefined;
  /** O total que a tela mostra — já com o desconto. */
  total: number;
  className?: string;
}

/**
 * "Esta condição pede pedido mínimo de R$ X; o total está em R$ Y".
 *
 * Só AVISA (decisão do Yan, 16/09/2026): não trava o botão de enviar, e o
 * servidor também não recusa. Quem aceita ou não um pedido abaixo do mínimo é o
 * escritório; o que a tela garante é que o representante não envia sem saber.
 *
 * Não renderiza nada quando não há o que avisar — condição sem mínimo, total
 * que alcança o mínimo, ou lista de condições ainda sem a migração 049.
 */
export function AvisoDeValorMinimo({ condicao, total, className }: Props) {
  const aviso = avisoDeValorMinimo(condicao, total);
  if (!aviso) return null;

  return (
    <div
      role="status"
      className={
        'flex items-start gap-2 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-xs font-medium text-warn-soft-foreground' +
        (className ? ` ${className}` : '')
      }
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.5} />
      <span>{aviso.mensagem}</span>
    </div>
  );
}
