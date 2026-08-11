import type { OfflineSyncOrder, SyncResult } from '@csb/shared';
import { createOrder, type OrigemPedido } from '../orders/orders.service.js';
import { createOrderSchema } from '../orders/orders.schema.js';

export async function processSyncQueue(
  company_id: string,
  rep_id: string,
  price_table_id: string | null,
  orders: OfflineSyncOrder[],
  origem: OrigemPedido = { source: 'rep' },
): Promise<SyncResult> {
  let synced = 0;
  const failed: Array<{ local_id: string; error: string }> = [];

  for (const offlineOrder of orders) {
    const validation = createOrderSchema.safeParse(offlineOrder);
    if (!validation.success) {
      failed.push({
        local_id: offlineOrder.local_id,
        error: validation.error.issues[0]?.message ?? 'Dados do pedido inválidos',
      });
      continue;
    }

    try {
      // Tudo que está na fila offline é pedido FECHADO por quem montou — ele
      // apertou enviar sem sinal. Entra na fila (do gerente, se veio do
      // representante; da triagem, se veio da loja), nunca como rascunho.
      // Forçado aqui (e não só no cliente) para valer também para itens que já
      // estavam na fila antes desta versão.
      await createOrder(
        company_id,
        rep_id,
        price_table_id,
        { ...validation.data, submit: true },
        origem,
      );
      synced++;
    } catch (err) {
      failed.push({
        local_id: offlineOrder.local_id,
        error: err instanceof Error ? err.message : 'UNKNOWN_ERROR',
      });
    }
  }

  return { synced, failed };
}
