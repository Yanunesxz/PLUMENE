import type { AuthRole } from '../constants/userRole.js';
import type { OrderStatus } from '../constants/orderStatus.js';

/**
 * CANCELAR PEDIDO com motivo (migração 053).
 *
 * Yan (30/09/2026): "qualquer pessoa pode cancelar, mas quando chegar na
 * Larissa ela é quem coloca". Então:
 *   - representante e gerente cancelam enquanto o pedido ainda NÃO chegou ao
 *     financeiro — rascunho e triagem;
 *   - a venda interna cancela o próprio pedido até faturar (ela é o financeiro
 *     das vendas dela);
 *   - financeiro e admin cancelam qualquer pedido até faturar — inclusive o
 *     já lançado no Control.
 * Faturado não cancela: a nota saiu. Desmarca-se o faturado antes.
 *
 * Mora no shared porque a tela esconde o botão com a MESMA regra que a API usa
 * para recusar.
 */
export type PodeCancelar = 'ok' | 'faturado' | 'ja_cancelado' | 'com_o_financeiro' | 'forbidden';

export interface PedidoParaCancelar {
  status: OrderStatus;
  invoiced?: boolean | null;
  rep_id: string;
}

export function podeCancelarPedido(
  pedido: PedidoParaCancelar,
  papel: AuthRole | undefined,
  user_id: string | undefined,
  vendaInterna = false,
): PodeCancelar {
  if (pedido.invoiced) return 'faturado';
  if (pedido.status === 'rejected') return 'ja_cancelado';
  if (papel === 'financeiro' || papel === 'admin') return 'ok';

  const antesDoFinanceiro = pedido.status === 'draft' || pedido.status === 'pending_rep';

  if (papel === 'rep') {
    if (pedido.rep_id !== user_id) return 'forbidden';
    if (vendaInterna) return 'ok';
    return antesDoFinanceiro ? 'ok' : 'com_o_financeiro';
  }
  if (papel === 'manager') {
    if (pedido.status === 'draft' && pedido.rep_id !== user_id) return 'forbidden';
    return antesDoFinanceiro ? 'ok' : 'com_o_financeiro';
  }
  return 'forbidden';
}

/** Um motivo da lista do admin. */
export interface MotivoDeCancelamento {
  id: string;
  label: string;
  active: boolean;
  sort_order: number;
}

export interface CancelarPedidoRequest {
  reason_id: string;
  /** Observação de quem cancelou — opcional. */
  note?: string;
}

/** Os motivos com que a lista nasce — os do Yan. */
export const MOTIVOS_DE_CANCELAMENTO_INICIAIS = [
  'CLIENTE CANCELOU',
  'CLIENTE COM PROTESTO - REPRESENTANTE NÃO AUTORIZOU',
  'CLIENTE COM PARCELA VENCIDA',
  'PEDIDO EM DUPLICIDADE',
] as const;
