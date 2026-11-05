import { useState } from 'react';
import { Split } from 'lucide-react';
import { Badge } from '../interface/Badge.js';
import { Button } from '../interface/Button.js';
import { seloDoPedido } from '../../lib/pedido.js';
import { dataDeEnvioPorExtenso, rotuloDaEntrega } from '@csb/shared';
import type { AuthRole, FracionamentoDoPedido } from '@csb/shared';

interface Props {
  fracionamento: FracionamentoDoPedido;
  /** O pedido aberto na tela — a entrega dele fica marcada. */
  atualId: string;
  papel: AuthRole | undefined;
  /** Quem olha pode mudar a data de envio desta entrega (`podeMudarDataDeEnvio`). */
  podeMudarData: boolean;
  salvandoData?: boolean;
  onMudarData: (ship_date: string) => void;
  onAbrir: (id: string) => void;
}

/**
 * O AVISO DE PEDIDO FRACIONADO (migração 057; Yan, 05/11/2026): "pedidos
 * separados, mas com aviso em algum lugar que ele é fracionado e tem botões
 * para ir" de uma entrega à outra.
 *
 * Cada entrega é um pedido próprio — número, status, número do Control e
 * faturamento próprios. Aqui ficam: em que entrega se está, a data de envio
 * dela (que muda enquanto o pedido ainda pode ser alterado) e um botão por
 * entrega do grupo. O selo de cada uma é o mesmo `seloDoPedido` das listas.
 */
export function EntregasDoPedido({
  fracionamento,
  atualId,
  papel,
  podeMudarData,
  salvandoData,
  onMudarData,
  onAbrir,
}: Props) {
  const [editando, setEditando] = useState(false);
  const [data, setData] = useState(fracionamento.ship_date ?? '');
  const total = fracionamento.total_de_entregas;
  const envio = dataDeEnvioPorExtenso(fracionamento.ship_date);

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary-soft-foreground">
          <Split className="h-[18px] w-[18px]" strokeWidth={2.5} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">
            Pedido fracionado · {rotuloDaEntrega(fracionamento.indice, total, 'longo')}
          </p>
          {editando ? (
            <form
              className="mt-2 flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!data) return;
                onMudarData(data);
                setEditando(false);
              }}
            >
              <input
                type="date"
                value={data}
                onChange={(e) => setData(e.target.value)}
                aria-label="Data de envio desta entrega"
                className="h-9 rounded-lg border border-input bg-card px-2 text-sm text-foreground"
              />
              <Button type="submit" size="sm" disabled={!data || salvandoData}>
                Salvar
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setEditando(false)}>
                Cancelar
              </Button>
            </form>
          ) : (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {envio ? (
                <>
                  Envio em <span className="font-medium text-foreground">{envio}</span>
                </>
              ) : (
                'Sem data de envio'
              )}
              {podeMudarData && (
                <>
                  {' · '}
                  <button
                    type="button"
                    disabled={salvandoData}
                    onClick={() => {
                      setData(fracionamento.ship_date ?? '');
                      setEditando(true);
                    }}
                    className="font-semibold underline hover:text-foreground"
                  >
                    {salvandoData ? 'salvando…' : 'alterar data'}
                  </button>
                </>
              )}
            </p>
          )}
        </div>
      </div>

      {/* Um botão por entrega. O da entrega aberta fica marcado e não navega. */}
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {fracionamento.entregas.map((e) => {
          const atual = e.id === atualId;
          const selo = seloDoPedido(e, papel);
          const quando = dataDeEnvioPorExtenso(e.ship_date);
          return (
            <button
              key={e.id}
              type="button"
              aria-current={atual ? 'true' : undefined}
              disabled={atual}
              onClick={() => onAbrir(e.id)}
              className={`flex min-h-11 flex-col items-start gap-1 rounded-lg border px-3 py-2 text-left transition-colors ${
                atual ? 'border-primary bg-primary-soft' : 'border-input bg-card hover:bg-muted'
              }`}
            >
              <span className="flex w-full items-center justify-between gap-2">
                <span className="text-sm font-semibold text-foreground">{rotuloDaEntrega(e.indice, total)}</span>
                <span className="tnum font-mono text-xs text-muted-foreground">#{e.order_number ?? '—'}</span>
              </span>
              <span className="flex w-full flex-wrap items-center justify-between gap-1">
                <span className="tnum text-xs text-muted-foreground">{quando ? `Envio ${quando}` : 'Sem data'}</span>
                <Badge variant={selo.variante}>{selo.texto}</Badge>
              </span>
            </button>
          );
        })}
      </div>

      <p className="mt-2 text-[11px] text-subtle">
        {fracionamento.fracionado_em
          ? `Fracionado${fracionamento.fracionado_por_nome ? ` por ${fracionamento.fracionado_por_nome}` : ''} em ${new Date(
              fracionamento.fracionado_em,
            ).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}. `
          : ''}
        Cada entrega é um pedido próprio: é lançada e faturada à parte.
      </p>
    </div>
  );
}
