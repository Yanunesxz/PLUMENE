import type { AuthRole } from '../constants/userRole.js';
import type { OrderStatus } from '../constants/orderStatus.js';

/**
 * TROCAR A TABELA DE PREÇO DO PEDIDO depois de feito.
 *
 * Yan (27/10/2026): o pedido saiu na tabela errada e não havia como mudar. "Pode
 * ser, e cria pra vendedora interna também, mas até lançar pro financeiro; não
 * pra todos os reps, só pra vendedora interna." Então:
 *   - financeiro e admin trocam até FATURAR;
 *   - a VENDA INTERNA troca no PRÓPRIO pedido, só até o financeiro lançar no
 *     Control — lançado, trava para ela;
 *   - o representante comum NÃO troca (nem no próprio pedido);
 *   - faturado e cancelado não trocam.
 * Trocar a tabela reprecifica os itens (mesma régua do editar peças) e mantém
 * quantidades e desconto. O cadastro do cliente não muda.
 *
 * Mora no shared porque a tela esconde o botão com a MESMA regra que a API usa
 * para recusar.
 */
export type PodeTrocarTabela = 'ok' | 'faturado' | 'cancelado' | 'ja_lancado' | 'forbidden';

export interface PedidoParaTrocarTabela {
  status: OrderStatus;
  invoiced?: boolean | null;
  rep_id: string;
  erp_order_id?: string | null;
  erp_requested_at?: string | null;
}

/** O pedido já está no Control: lançado, ou pedido ao Control e esperando. */
export function pedidoJaLancadoNoControl(
  p: Pick<PedidoParaTrocarTabela, 'status' | 'erp_order_id' | 'erp_requested_at'>,
): boolean {
  return p.status === 'sent_erp' || !!p.erp_order_id || !!p.erp_requested_at;
}

export function podeTrocarTabelaDoPedido(
  pedido: PedidoParaTrocarTabela,
  papel: AuthRole | undefined,
  user_id: string | undefined,
  vendaInterna: boolean | undefined,
): PodeTrocarTabela {
  if (pedido.invoiced) return 'faturado';
  if (pedido.status === 'rejected') return 'cancelado';
  if (papel === 'financeiro' || papel === 'admin') return 'ok';
  if (papel === 'rep' && vendaInterna === true && pedido.rep_id === user_id) {
    return pedidoJaLancadoNoControl(pedido) ? 'ja_lancado' : 'ok';
  }
  return 'forbidden';
}

export interface TrocarTabelaDoPedidoRequest {
  price_table_id: string;
  /** `true` só calcula e devolve os totais, sem gravar nada (a prévia da tela). */
  simular?: boolean;
}

/** O que a troca (ou a prévia) devolve além do pedido. */
export interface ResultadoDaTrocaDeTabela {
  tabela_antes: string | null;
  tabela_depois: string;
  total_antes: number;
  total_depois: number;
  /** Já gravou? `false` na prévia, ou quando a tabela era a mesma. */
  mudou: boolean;
  /** O pedido já está no Control: o financeiro precisa acertar o preço lá também. */
  ja_no_control: boolean;
}
