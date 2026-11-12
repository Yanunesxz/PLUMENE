import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { CASHBACK_AVISO_DIAS, type ExtratoDeCashback } from '@csb/shared';
import { Badge } from '../../components/interface/Badge.js';
import { formatBRL } from '../../lib/utils.js';
import { dataCurta, prazoPorExtenso } from './cashback.js';

/**
 * O aviso dos 90 dias (Yan: "tem que avisar isso tbm"): quanto do saldo vence
 * primeiro e quando. Amarelo quando faltam CASHBACK_AVISO_DIAS ou menos.
 */
export function AvisoDeVencimento({ extrato }: { extrato: ExtratoDeCashback }) {
  const proximo = extrato.proximo_vencimento;
  if (!proximo) return null;
  return (
    <p
      className={`flex items-start gap-1.5 rounded-lg px-3 py-2 text-xs ${
        proximo.dias <= CASHBACK_AVISO_DIAS ? 'bg-warn-soft text-warn-soft-foreground' : 'bg-muted text-muted-foreground'
      }`}
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
      <span>
        {formatBRL(proximo.valor)} {prazoPorExtenso(proximo.dias)} ({dataCurta(proximo.vence_em)}). Cada crédito vale
        90 dias a partir do faturamento.
      </span>
    </p>
  );
}

/**
 * O extrato de um cliente: de onde veio cada crédito, até quando vale e onde
 * foi usado. É a mesma lista para a venda interna (área Cashback) e para a
 * loja (Minha área) — `linkDoPedido` desliga os links para quem não abre o
 * pedido pelo número.
 */
export function ExtratoDoCashback({
  extrato,
  linkDoPedido = true,
}: {
  extrato: ExtratoDeCashback;
  linkDoPedido?: boolean;
}) {
  const pedido = (id: string, numero: number | null) => {
    const rotulo = numero != null ? `Pedido #${numero}` : 'Pedido';
    return linkDoPedido ? (
      <Link to={`/orders/${id}`} className="font-medium text-primary hover:underline">
        {rotulo}
      </Link>
    ) : (
      <span className="font-medium text-foreground">{rotulo}</span>
    );
  };

  return (
    <div className="space-y-4">
      <AvisoDeVencimento extrato={extrato} />

      <section>
        <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Créditos</h3>
        {extrato.creditos.length === 0 ? (
          <p className="text-sm text-subtle">Nenhum pedido faturado gerou cashback ainda.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {extrato.creditos.map((c) => (
              <li key={c.order_id} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p>
                    {pedido(c.order_id, c.order_number)}{' '}
                    <span className="text-muted-foreground">· faturado em {dataCurta(c.faturado_em)}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    3% de {formatBRL(c.valor_faturado)} · válido até {dataCurta(c.vence_em)}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-semibold text-foreground">+{formatBRL(c.valor)}</p>
                  {c.vencido ? (
                    c.perdido > 0 ? (
                      <Badge variant="red">venceu {formatBRL(c.perdido)}</Badge>
                    ) : (
                      <Badge variant="gray">usado</Badge>
                    )
                  ) : c.restante <= 0 ? (
                    <Badge variant="gray">usado</Badge>
                  ) : c.dias_para_vencer != null && c.dias_para_vencer <= CASHBACK_AVISO_DIAS ? (
                    <Badge variant="yellow">
                      {formatBRL(c.restante)} · {prazoPorExtenso(c.dias_para_vencer)}
                    </Badge>
                  ) : (
                    <Badge variant="green">{formatBRL(c.restante)} disponível</Badge>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {extrato.usos.length > 0 && (
        <section>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Usados</h3>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {extrato.usos.map((u) => (
              <li key={u.id} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p>{pedido(u.order_id, u.order_number)}</p>
                  <p className="text-xs text-muted-foreground">
                    {dataCurta(u.usado_em)}
                    {u.usado_por_nome ? ` · por ${u.usado_por_nome}` : ''}
                  </p>
                </div>
                <p className="shrink-0 font-semibold text-foreground">−{formatBRL(u.valor)}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
