import type { OfflineSyncOrder, SyncResult } from '@csb/shared';
import { createOrder } from '../orders/orders.service.js';

export async function processSyncQueue(
  company_id: string,
  rep_id: string,
  orders: OfflineSyncOrder[],
): Promise<SyncResult> {
  let synced = 0;
  const failed: Array<{ local_id: string; error: string }> = [];

  for (const offlineOrder of orders) {
    try {
      await createOrder(company_id, rep_id, {
        customer_id: offlineOrder.customer_id,
        notes: offlineOrder.notes,
        local_id: offlineOrder.local_id,
        items: offlineOrder.items,
      });
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
