import { db } from './db.js';
import type { SyncRequest } from '@csb/shared';

const API_BASE = import.meta.env['VITE_API_URL'] as string ?? 'http://localhost:3001';

/**
 * Uma descarga por vez.
 *
 * A sincronização automática ao reconectar e o botão "Sincronizar" podem
 * disparar juntos — e as duas leriam a MESMA fila e enviariam os mesmos pedidos.
 * O servidor tem a trava definitiva (`local_id` único), mas segurar aqui evita
 * o trabalho dobrado e a contagem enganosa no aviso da tela.
 */
let descarregando: Promise<{ synced: number; failed: number }> | null = null;

export function flushSyncQueue(token: string): Promise<{ synced: number; failed: number }> {
  descarregando ??= descarregar(token).finally(() => {
    descarregando = null;
  });
  return descarregando;
}

async function descarregar(token: string): Promise<{ synced: number; failed: number }> {
  const pending = await db.sync_queue.toArray();
  if (pending.length === 0) return { synced: 0, failed: 0 };

  const payload: SyncRequest = {
    orders: pending.map((item) => ({
      local_id: item.local_id,
      customer_id: item.customer_id,
      notes: item.notes,
      payment_condition_id: item.payment_condition_id,
      discount_percent: item.discount_percent,
      items: item.items,
      created_at: item.created_at,
      updated_at: item.updated_at,
    })),
  };

  const response = await fetch(`${API_BASE}/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    await db.sync_queue.toCollection().modify((item) => {
      item.attempts += 1;
    });
    return { synced: 0, failed: pending.length };
  }

  const result = (await response.json()) as {
    data: { synced: number; failed: Array<{ local_id: string; error: string }> };
  };

  const failedIds = new Set(result.data.failed.map((f) => f.local_id));
  const syncedIds = pending.filter((p) => !failedIds.has(p.local_id)).map((p) => p.id!);

  await db.sync_queue.bulkDelete(syncedIds);

  await db.sync_queue
    .where('local_id')
    .anyOf([...failedIds])
    .modify((item) => {
      item.attempts += 1;
      const found = result.data.failed.find((f) => f.local_id === item.local_id);
      if (found) item.last_error = found.error;
    });

  return { synced: result.data.synced, failed: result.data.failed.length };
}

export async function addToSyncQueue(
  order: Omit<Parameters<typeof db.sync_queue.add>[0], 'attempts' | 'id'>,
): Promise<void> {
  await db.sync_queue.add({ ...order, attempts: 0 });
}
