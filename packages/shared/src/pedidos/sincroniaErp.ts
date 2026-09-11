import type { Order } from '../types/order.js';
import type { ItemDaFoto } from './pedidoOriginal.js';

/**
 * O QUE O CONTROL CONHECE de um pedido já lançado (migração 046).
 *
 * "Depois que o pedido for enviado pelas vendedoras internas e elas alterarem
 * ele, temos que ter um botão depois que editou as peças como 'atualizar no
 * ERP', porque se ela mudar por lá tem que mudar no ERP principal também"
 * (Yan, 11/09/2026).
 *
 * A venda interna mexe no próprio pedido até o carimbo de faturado, inclusive
 * depois de a Larissa lançar. Esta é a fotografia do que a fábrica tem na mão:
 * enquanto as peças de hoje forem iguais a ela, o Control está em dia.
 */
export interface SincroniaComOErp {
  order_id: string;
  /** O número do Control no momento da foto. */
  erp_order_id: string | null;
  total: number | null;
  pecas: number;
  /** Quando o Control passou a conhecer esta versão. */
  confirmado_em: string;
  /** Quando alguém apertou "Atualizar no ERP". `null` = ninguém pediu. */
  pedido_em: string | null;
  /** O recado de quem pediu ("tirei 6 peças da 0124, faltou no estoque"). */
  observacao: string | null;
  snapshot: Order & { items: ItemDaFoto[] };
}
