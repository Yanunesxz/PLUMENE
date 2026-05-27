export const ORDER_STATUS = {
  DRAFT: 'draft',
  PENDING_APPROVAL: 'pending_approval',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  SENT_ERP: 'sent_erp',
  ERROR_ERP: 'error_erp',
} as const;

export type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  draft: 'Rascunho',
  pending_approval: 'Aguardando Aprovação',
  approved: 'Aprovado',
  rejected: 'Recusado',
  sent_erp: 'Enviado ao ERP',
  error_erp: 'Erro no ERP',
};

export const ORDER_STATUS_FLOW: Record<OrderStatus, OrderStatus[]> = {
  draft: ['pending_approval'],
  pending_approval: ['approved', 'rejected'],
  approved: ['sent_erp'],
  rejected: [],
  sent_erp: [],
  error_erp: ['sent_erp'],
};
