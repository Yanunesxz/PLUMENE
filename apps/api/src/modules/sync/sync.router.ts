import type { FastifyInstance } from 'fastify';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { syncHandler } from './sync.controller.js';
import {
  erpFullSyncHandler,
  erpStockSyncHandler,
  erpStatusHandler,
} from './erp-sync.controller.js';

export async function syncRouter(fastify: FastifyInstance): Promise<void> {
  // Sync offline → Supabase (pedidos criados offline pelo app)
  fastify.post('/sync', { preHandler: authenticate }, syncHandler);

  // ERP → Supabase (admin/manager apenas)
  fastify.post(
    '/erp/sync/full',
    { preHandler: [authenticate, requireRole(['admin', 'manager'])] },
    erpFullSyncHandler,
  );

  fastify.post(
    '/erp/sync/stock',
    { preHandler: [authenticate, requireRole(['admin', 'manager'])] },
    erpStockSyncHandler,
  );

  fastify.get(
    '/erp/status',
    { preHandler: [authenticate, requireRole(['admin', 'manager'])] },
    erpStatusHandler,
  );
}
