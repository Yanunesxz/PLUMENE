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
      // O pedido do representante que chega da fila offline vira RASCUNHO,
      // igual ao salvo online: ele cai na área "Enviar pra fábrica" e o rep
      // manda quando conferir (regra do Yan, 14/08/2026 — antes disto o sync
      // forçava submit e o pedido pulava direto para a fila do gerente). O da
      // loja não muda: a origem 'store' ignora o submit e cai na triagem.
      const pedido = await createOrder(company_id, rep_id, price_table_id, validation.data, origem);
      // Pedido que não nasceu (cliente que não existe na empresa, gravação que
      // o banco recusou) volta como falha: o aparelho só apaga da fila o que
      // não veio em `failed`, e contar como sincronizado fazia o pedido sumir
      // do celular sem existir no servidor.
      if (!pedido) {
        failed.push({ local_id: offlineOrder.local_id, error: 'CREATE_FAILED' });
        continue;
      }
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
