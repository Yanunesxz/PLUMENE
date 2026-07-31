import type { Order, OrderSource } from '@csb/shared';

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
