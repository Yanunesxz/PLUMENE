import type { AuthRole, Order, OrderSource, OrderStatus } from '@csb/shared';

/**
 * Quem está comprando, em uma linha.
 *
 * Pedido de vitrine não tem cliente cadastrado — quem pediu se identificou só
 * com nome e WhatsApp no fechamento. Toda tela que mostra "o cliente do pedido"
 * passa por aqui para não precisar repetir essa decisão.
 */
export function nomeDoComprador(order: Order, nomePorCliente: Map<string, string>): string {
  if (order.customer_id) return nomePorCliente.get(order.customer_id) ?? 'Cliente';
  return order.guest_name?.trim() || 'Visitante';
}

export const ORIGEM_LABEL: Record<OrderSource, string> = {
  rep: 'Representante',
  store: 'Loja',
  showcase: 'Vitrine',
};

/** Só vale destacar a origem quando NÃO foi o representante que montou. */
export function origemParaExibir(order: Order): string | null {
  const origem = order.source;
  if (!origem || origem === 'rep') return null;
  return ORIGEM_LABEL[origem];
}

/** Cor do selo de status. Uma tabela só, para as telas não divergirem. */
export const STATUS_VARIANTE: Record<OrderStatus, 'gray' | 'yellow' | 'green' | 'red' | 'brand'> = {
  draft: 'gray',
  pending_rep: 'brand',
  pending_approval: 'yellow',
  approved: 'green',
  rejected: 'red',
  sent_erp: 'brand',
  error_erp: 'red',
};

/**
 * A decisão que ESTE usuário pode tomar sobre ESTE pedido — ou nenhuma.
 *
 * São dois portões diferentes com a mesma cara: o representante tria o que
 * chegou de fora, o gerente aprova o que vai faturar. Os rótulos dizem o que o
 * botão faz ("mandar para a fábrica"), não o nome do estado — quem usa não
 * precisa saber que existe um `pending_approval`.
 */
export interface Decisao {
  aceitar: OrderStatus;
  rotuloAceitar: string;
  rotuloRecusar: string;
  /** Uma linha dizendo o que acontece depois de aceitar. */
  explicacao: string;
}

export function decisaoDoPedido(papel: AuthRole | undefined, status: OrderStatus): Decisao | null {
  const daFabrica = papel === 'manager' || papel === 'admin';

  // Triagem: o pedido chegou da loja ou de um link. O gerente também passa por
  // aqui — se o representante sumir, o pedido não fica preso.
  if (status === 'pending_rep' && (papel === 'rep' || daFabrica)) {
    return {
      aceitar: 'pending_approval',
      rotuloAceitar: 'Mandar para a fábrica',
      rotuloRecusar: 'Recusar',
      explicacao: 'Este pedido chegou pronto. Ao mandar, ele entra na fila de aprovação da fábrica.',
    };
  }

  if (status === 'pending_approval' && daFabrica) {
    return {
      aceitar: 'approved',
      rotuloAceitar: 'Aprovar',
      rotuloRecusar: 'Recusar',
      explicacao: 'Aprovar libera o pedido para o faturamento.',
    };
  }

  return null;
}
