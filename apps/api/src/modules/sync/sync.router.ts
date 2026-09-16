import type { FastifyInstance } from 'fastify';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { syncHandler } from './sync.controller.js';
import {
  erpFullSyncHandler,
  erpStockSyncHandler,
  erpStatusHandler,
} from './erp-sync.controller.js';

export async function syncRouter(fastify: FastifyInstance): Promise<void> {
  // Sync offline → Supabase (pedidos criados offline pelo app).
  // O visitante da vitrine fica de fora: ele não tem app instalado nem fila, e
  // por aqui ele criaria pedido sem o nome e o WhatsApp que o fechamento exige.
  fastify.post(
    '/sync',
    { preHandler: [authenticate, requireRole(['rep', 'manager', 'admin', 'store'])] },
    syncHandler,
  );

  // ERP → Supabase (admin/manager apenas). Além de ERP_SYNC_ENABLED, cada rota
  // exige o canal da empresa em 'firebird' (migração 048): /full precisa de
  // canal_catalogo OU canal_cadastro, /stock de canal_catalogo; senão 409
  // CANAL_FECHADO sem abrir o Firebird. /erp/status só lê e fica livre.
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
