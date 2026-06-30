import type { OfflineSyncOrder, SyncResult } from '@csb/shared';
import { createOrder } from '../orders/orders.service.js';
import { createOrderSchema } from '../orders/orders.schema.js';

export async function processSyncQueue(
  company_id: string,
  rep_id: string,
  price_table_id: string | null,
  orders: OfflineSyncOrder[],
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
      await createOrder(company_id, rep_id, price_table_id, validation.data);
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
