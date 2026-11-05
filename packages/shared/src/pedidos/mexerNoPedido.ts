import type { AuthRole } from '../constants/userRole.js';
import { vendeEmNomeProprio } from '../constants/userRole.js';
import type { OrderStatus } from '../constants/orderStatus.js';

/**
 * MEXER NO PEDIDO EM ABERTO — peças, desconto, condição de pagamento,
 * observação e, desde 05/11/2026, fracionar em entregas. Um portão só.
 *
 * Morava dentro do `orders.service.ts`; veio para o shared quando o
 * fracionamento precisou da MESMA regra na tela (o botão não aparece onde a
 * rota vai negar). A API continua sendo quem protege de verdade.
 *
 *   - a VENDA INTERNA, no PRÓPRIO pedido, mexe até o carimbo de faturado — ela
 *     é quem carimba, então é ela quem fecha a porta;
 *   - faturado, lançado no Control, cancelado ou com erro no ERP: ninguém mais;
 *   - o representante — e o SAC (056), que vende em nome próprio — mexe no
 *     PRÓPRIO pedido enquanto ele está com ele: rascunho, triagem e a fila;
 *   - gerente, admin e financeiro mexem na triagem, na fila e no aprovado
 *     ("alterar os pedidos mandados mesmo pela fábrica", Yan 14/08/2026), e no
 *     rascunho que for deles — o alheio é a montagem privada do representante.
 */
export type PodeMexerNoPedido = 'ok' | 'forbidden' | 'tarde_demais';

export interface PedidoParaMexer {
  status: OrderStatus;
  invoiced?: boolean | null | undefined;
  rep_id: string;
}

export function podeMexerNoPedido(
  o: PedidoParaMexer,
  role: AuthRole | null | undefined,
  user_id: string | null | undefined,
  vendaInterna = false,
): PodeMexerNoPedido {
  if (role === 'rep' && vendaInterna && o.rep_id === user_id) {
    return o.invoiced ? 'tarde_demais' : 'ok';
  }
  if (o.invoiced || o.status === 'sent_erp' || o.status === 'rejected' || o.status === 'error_erp') {
    return 'tarde_demais';
  }
  if (vendeEmNomeProprio(role)) {
    if (o.rep_id !== user_id) return 'forbidden';
    return o.status === 'draft' || o.status === 'pending_rep' || o.status === 'pending_approval'
      ? 'ok'
      : 'tarde_demais';
  }
  if (role === 'manager' || role === 'admin' || role === 'financeiro') {
    if (o.status === 'draft') return o.rep_id === user_id ? 'ok' : 'tarde_demais';
    return o.status === 'pending_rep' || o.status === 'pending_approval' || o.status === 'approved'
      ? 'ok'
      : 'tarde_demais';
  }
  return 'forbidden';
}
