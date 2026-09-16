import type { FastifyRequest, FastifyReply } from 'fastify';
import {
  runFullSync,
  runStockSync,
  canaisDoFirebirdFechados,
} from '../../erp/firebird/erpSyncService.js';
import type { CanalDoFirebird } from '../../erp/firebird/erpSyncService.js';
import type { CanalRecusado } from '../../lib/canais.js';
import { testConnection } from '../../erp/firebird/connection.js';
import { env } from '../../config/env.js';

const NOME_DO_CANAL: Record<CanalDoFirebird, string> = {
  catalogo: 'catálogo',
  cadastro: 'cadastro',
};

/**
 * O 409 das rotas /erp/sync quando o canal da empresa não é 'firebird'
 * (migração 048). Mesmo `code` das rotas do parceiro (CANAL_FECHADO), com o
 * texto do Firebird — o de `corpoCanalFechado` fala da API. `canal` e
 * `valor_atual` são do primeiro canal recusado; `recusados` traz todos.
 */
export function corpoFirebirdFechado(recusados: CanalRecusado<CanalDoFirebird>[]) {
  const primeiro = recusados[0] ?? { canal: 'catalogo' as const, valor_atual: 'carga' as const };
  const nomes = recusados.map((r) => NOME_DO_CANAL[r.canal]).join(' e ');
  return {
    error: `Canal de ${nomes} não está ligado para o Firebird nesta empresa`,
    code: 'CANAL_FECHADO' as const,
    statusCode: 409 as const,
    canal: primeiro.canal,
    valor_atual: primeiro.valor_atual,
    recusados,
  };
}

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
    // Catálogo e cadastro fechados: nada a fazer, e o 409 diz por quê. Com um
    // dos dois ligado, roda — a parte do outro sai com `pulado` no resultado.
    const fechados = await canaisDoFirebirdFechados(company_id);
    if (fechados.length === 2) {
      await reply.status(409).send(corpoFirebirdFechado(fechados));
      return;
    }

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
    // Estoque é catálogo: sem canal_catalogo='firebird', 409.
    const catalogo = (await canaisDoFirebirdFechados(company_id)).filter((r) => r.canal === 'catalogo');
    if (catalogo.length > 0) {
      await reply.status(409).send(corpoFirebirdFechado(catalogo));
      return;
    }

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

/** GET /erp/status — verifica conectividade com o Firebird (só leitura, sem trava de canal) */
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
