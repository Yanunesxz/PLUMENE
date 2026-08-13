/**
 * O status do pedido COMO O CLIENTE E O REPRESENTANTE o veem.
 *
 * Os status internos (`draft`, `pending_rep`, `pending_approval`, `approved`,
 * `sent_erp`, `error_erp`) são controle da fábrica: eles descrevem por qual
 * mesa o papel passou, não o que aconteceu com a mercadoria. Quem comprou não
 * tem o que fazer com "Aguardando Aprovação" nem com "Enviado ao ERP".
 *
 * Do lado de fora existem três degraus, e um desvio:
 *
 *     Enviado pra fábrica  →  Aprovado  →  Entregue
 *                          ↘  Recusado
 *
 * A regra que muda tudo: **"Aprovado" é o FATURADO**, não o status `approved`.
 *
 * Quando o gerente clica em "Aprovar", o pedido não está aprovado para o
 * lojista — está liberado para ir ao ERP. Quem diz que virou negócio é o
 * faturamento, porque é o financeiro que corrige preço, corta item em falta e
 * fecha o valor. Anunciar "Aprovado" antes disso é prometer um pedido que
 * ainda pode mudar de tamanho.
 *
 * Por isso este módulo NÃO olha só o status: ele olha o faturamento primeiro.
 */
import type { OrderStatus } from './orderStatus.js';

export type StatusDoCliente = 'enviado' | 'aprovado' | 'entregue' | 'recusado';

export const STATUS_DO_CLIENTE_LABELS: Record<StatusDoCliente, string> = {
  enviado: 'Enviado pra fábrica',
  aprovado: 'Aprovado',
  entregue: 'Entregue',
  recusado: 'Recusado',
};

/** A ordem dos degraus na barra de progresso. `recusado` não entra: é desvio. */
export const PASSOS_DO_CLIENTE: readonly StatusDoCliente[] = ['enviado', 'aprovado', 'entregue'];

export interface SituacaoDoPedido {
  status: OrderStatus;
  /** O faturamento é quem promove o pedido a "Aprovado" aos olhos de quem comprou. */
  invoiced?: boolean | null;
  /**
   * Entrega confirmada. Ainda não existe fonte para este dado — nem o gerente
   * marca, nem o ERP informa. Fica no contrato para o degrau acender no dia em
   * que existir, sem precisar mexer em todas as telas de novo.
   */
  delivered?: boolean | null;
}

/**
 * Em que degrau o pedido está, para o cliente e para o representante.
 *
 * `rejected` vence tudo: pedido recusado precisa dizer que morreu. Deixá-lo
 * parado em "Enviado pra fábrica" para sempre seria mentira por omissão — o
 * lojista ficaria esperando mercadoria que não vem.
 */
export function statusDoCliente(pedido: SituacaoDoPedido): StatusDoCliente {
  if (pedido.status === 'rejected') return 'recusado';
  if (pedido.delivered) return 'entregue';
  if (pedido.invoiced) return 'aprovado';
  return 'enviado';
}

/** O rótulo pronto para a tela. */
export function rotuloDoCliente(pedido: SituacaoDoPedido): string {
  return STATUS_DO_CLIENTE_LABELS[statusDoCliente(pedido)];
}

/**
 * Quanto este pedido vale COMO VENDA.
 *
 * O valor do pedido é o que o lojista aceitou; o valor faturado é o que a nota
 * fechou depois de o financeiro cortar o que faltou no estoque. Venda é o
 * segundo — e é sempre o segundo, quando ele existe.
 *
 * Enquanto o ERP não informar (`invoiced_total` nulo), vale o total do pedido:
 * é a melhor estimativa que temos, e é o comportamento anterior à migração 027.
 */
export function valorDaVenda(pedido: {
  total?: number | null;
  invoiced_total?: number | null;
}): number {
  return pedido.invoiced_total ?? pedido.total ?? 0;
}

/**
 * Quem vê o status interno e quem vê os três degraus.
 *
 * Gerente e administrador tocam o fluxo por dentro e precisam distinguir "na
 * fila" de "liberado para o ERP". Representante e loja, não: para eles o que
 * importa é se a mercadoria vem.
 */
export function usaStatusInterno(papel: string | undefined): boolean {
  return papel === 'manager' || papel === 'admin';
}
