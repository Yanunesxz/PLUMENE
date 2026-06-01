import type { FastifyRequest, FastifyReply } from 'fastify';
import { runFullSync, runStockSync } from '../../erp/firebird/erpSyncService.js';
import { testConnection } from '../../erp/firebird/connection.js';
import { env } from '../../config/env.js';

/** POST /erp/sync/full — sincronização completa (tabelas de preço + produtos + clientes) */
export async function erpFullSyncHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!env.ERP_SYNC_ENABLED) {
    await reply.status(503).send({
      error: 'Sync ERP desabilitado. Configure ERP_SYNC_ENABLED=true e as variáveis ERP_DB_*.',
      code: 'ERP_SYNC_DISABLED',
      statusCode: 503,
    });
    return;
  }

  const company_id = request.user.company_id;
  const startedAt = new Date().toISOString();

  try {
    const results = await runFullSync(company_id);
    const hasErrors = results.some((r) => r.error);

    await reply.status(hasErrors ? 207 : 200).send({
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      results,
      ok: !hasErrors,
    });
  } catch (err) {
    await reply.status(500).send({
      error: err instanceof Error ? err.message : 'Erro inesperado no sync ERP',
      code: 'ERP_SYNC_ERROR',
      statusCode: 500,
    });
  }
}

/** POST /erp/sync/stock — atualiza só estoque (rápido, pode rodar com mais frequência) */
export async function erpStockSyncHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!env.ERP_SYNC_ENABLED) {
    await reply.status(503).send({
      error: 'Sync ERP desabilitado.',
      code: 'ERP_SYNC_DISABLED',
      statusCode: 503,
    });
    return;
  }

  const company_id = request.user.company_id;

  try {
    const result = await runStockSync(company_id);
    await reply.send({ ok: !result.error, result });
  } catch (err) {
    await reply.status(500).send({
      error: err instanceof Error ? err.message : 'Erro no sync de estoque',
      code: 'ERP_STOCK_SYNC_ERROR',
      statusCode: 500,
    });
  }
}

/** GET /erp/status — verifica conectividade com o Firebird */
export async function erpStatusHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!env.ERP_SYNC_ENABLED) {
    await reply.send({
      enabled: false,
      message: 'ERP_SYNC_ENABLED=false — usando dados do Supabase',
    });
    return;
  }

  const status = await testConnection();
  await reply.status(status.ok ? 200 : 503).send({
    enabled: true,
    ...status,
    host: env.ERP_DB_HOST,
    port: env.ERP_DB_PORT,
  });
}
