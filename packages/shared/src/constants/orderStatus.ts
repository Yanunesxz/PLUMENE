export const ORDER_STATUS = {
  DRAFT: 'draft',
  /** Chegou de fora (loja ou vitrine) e espera o representante decidir. */
  PENDING_REP: 'pending_rep',
  PENDING_APPROVAL: 'pending_approval',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  SENT_ERP: 'sent_erp',
  ERROR_ERP: 'error_erp',
} as const;

export type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  draft: 'Rascunho',
  pending_rep: 'Com o representante',
  pending_approval: 'Aguardando Aprovação',
  approved: 'Aprovado',
  rejected: 'Recusado',
  sent_erp: 'Enviado ao ERP',
  error_erp: 'Erro no ERP',
};

/**
 * Fluxo do pedido — dois portões, um para cada papel.
 *
 * Pedido montado pela LOJA ou pela VITRINE nasce em `pending_rep`: quem comprou
 * não fala direto com a fábrica. O representante olha e decide se aquilo vira
 * pedido (`pending_approval`, a fila do gerente) ou morre ali (`rejected`).
 *
 * Pedido montado pelo próprio representante pula a triagem — ele já é o filtro.
 */
export const ORDER_STATUS_FLOW: Record<OrderStatus, OrderStatus[]> = {
  // `approved` direto do rascunho é a VENDA INTERNA (migração 031): o balcão
  // não pede licença à fábrica. Quem NÃO é venda interna continua barrado pelo
  // portão de papel no updateOrderStatus — o mapa diz o que é possível, o
  // portão diz quem pode.
  draft: ['pending_approval', 'approved'],
  pending_rep: ['pending_approval', 'rejected'],
  pending_approval: ['approved', 'rejected'],
  approved: ['sent_erp'],
  rejected: [],
  sent_erp: [],
  error_erp: ['sent_erp'],
};

/** Status em que o pedido espera decisão de alguém — usado nas filas e contadores. */
export const ORDER_STATUS_ESPERANDO: readonly OrderStatus[] = ['pending_rep', 'pending_approval'];
