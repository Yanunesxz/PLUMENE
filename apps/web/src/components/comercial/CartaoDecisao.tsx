import { Link } from 'react-router-dom';
import { Check, X, ChevronRight } from 'lucide-react';
import { Badge } from '../interface/Badge.js';
import { Button } from '../interface/Button.js';
import { formatBRL } from '../../lib/utils.js';
import { nomeDoComprador, origemParaExibir, type Decisao } from '../../lib/pedido.js';
import type { Order } from '@csb/shared';

/**
 * Um pedido esperando decisão, com as duas saídas na frente.
 *
 * Mesmo cartão na fila do representante e na do gerente: o que muda é o texto
 * dos botões, que vem da `Decisao`. Assim quem aprende num lugar já sabe o
 * outro, e o cartão nunca mostra um botão que aquele usuário não pode apertar.
 */
export function CartaoDecisao({
  order,
  decisao,
  nomePorCliente,
  ocupado,
  onDecidir,
}: {
  order: Order;
  decisao: Decisao;
  nomePorCliente: Map<string, string>;
  ocupado: boolean;
  onDecidir: (status: Decisao['aceitar'] | 'rejected') => void;
}) {
  const origem = origemParaExibir(order);

  return (
    <li className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="font-mono text-xs text-muted-foreground">
              #{order.order_number ?? order.id.slice(0, 8)}
            </span>
            {origem && (
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {origem}
              </span>
            )}
          </span>
          <p className="mt-1 truncate text-sm font-medium text-foreground">
            {nomeDoComprador(order, nomePorCliente)}
          </p>
          <p className="mt-0.5 text-lg font-bold text-foreground">{formatBRL(order.total ?? 0)}</p>
          <p className="text-xs text-muted-foreground">
            {new Date(order.created_at).toLocaleDateString('pt-BR')}
          </p>
        </div>
        <Badge variant={order.status === 'pending_rep' ? 'brand' : 'yellow'}>
          {order.status === 'pending_rep' ? 'Para você ver' : 'Aguardando'}
        </Badge>
      </div>

      {order.notes && (
        <p className="mb-3 rounded-lg bg-muted p-2 text-xs text-muted-foreground">{order.notes}</p>
      )}

      {/* Decidir sem abrir é o caminho rápido; abrir é para conferir os itens. */}
      <Link
        to={`/orders/${order.id}`}
        className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
      >
        Ver as peças deste pedido
        <ChevronRight className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />
      </Link>

      <div className="flex gap-2">
        <Button
          className="flex-1 bg-positive hover:bg-positive/90 active:bg-positive/80"
          disabled={ocupado}
          onClick={() => onDecidir(decisao.aceitar)}
        >
          <Check className="h-4 w-4" strokeWidth={2.5} />
          {decisao.rotuloAceitar}
        </Button>
        <Button variant="destructive" disabled={ocupado} onClick={() => onDecidir('rejected')}>
          <X className="h-4 w-4" strokeWidth={2.5} />
          {decisao.rotuloRecusar}
        </Button>
      </div>
    </li>
  );
}
