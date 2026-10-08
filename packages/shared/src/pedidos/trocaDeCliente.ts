import type { AuthRole } from '../constants/userRole.js';
import type { OrderStatus } from '../constants/orderStatus.js';

/**
 * TROCAR O CLIENTE DO PEDIDO — o representante mandou o pedido na loja errada.
 *
 * Yan (08/10/2026): "selecionou o cliente errado, não é mudar a razão social;
 * coloque para ela [Larissa] e admin mudarem, e quando ela mudar mude o pedido
 * para o rep e para todos". E: "representante também pode mudar depois de
 * salvar o pedido, mas se ele enviar para a fábrica trava". Então:
 *   - financeiro e admin trocam até faturar;
 *   - o representante dono troca enquanto o pedido NÃO foi para a fábrica
 *     (rascunho e triagem); enviou, trava para ele;
 *   - faturado e cancelado não trocam.
 * O cadastro do cliente não muda — muda para QUAL cliente o pedido aponta.
 *
 * Mora no shared porque a tela esconde o botão com a MESMA regra que a API usa
 * para recusar.
 */
export type PodeTrocarCliente = 'ok' | 'faturado' | 'cancelado' | 'ja_enviado' | 'forbidden';

export interface PedidoParaTrocarCliente {
  status: OrderStatus;
  invoiced?: boolean | null;
  rep_id: string;
}

export function podeTrocarClienteDoPedido(
  pedido: PedidoParaTrocarCliente,
  papel: AuthRole | undefined,
  user_id: string | undefined,
): PodeTrocarCliente {
  if (pedido.invoiced) return 'faturado';
  if (pedido.status === 'rejected') return 'cancelado';
  if (papel === 'financeiro' || papel === 'admin') return 'ok';
  if (papel === 'rep') {
    if (pedido.rep_id !== user_id) return 'forbidden';
    return pedido.status === 'draft' || pedido.status === 'pending_rep' ? 'ok' : 'ja_enviado';
  }
  return 'forbidden';
}

export interface TrocarClienteDoPedidoRequest {
  customer_id: string;
}

/** O que a troca devolve além do pedido — o que a tela precisa avisar. */
export interface ResultadoDaTrocaDeCliente {
  /**
   * O cliente novo é de OUTRA tabela de preço. O pedido continua com a tabela
   * e os preços com que foi feito; se for o caso, ajusta-se nas peças.
   */
  tabela_diferente: boolean;
  /** O pedido já está no Control (lançado ou pedido ao Control): trocar lá também. */
  ja_no_control: boolean;
}
