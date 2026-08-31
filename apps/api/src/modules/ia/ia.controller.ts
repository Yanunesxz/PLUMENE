import type { FastifyRequest, FastifyReply } from 'fastify';
import { relatorioDaCarteira } from './ia.service.js';

export async function relatorioDaCarteiraHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { company_id, sub, role, erp_rep_id } = request.user;

  const r = await relatorioDaCarteira(company_id, {
    rep_id: sub,
    erp_rep_id: erp_rep_id ?? null,
    // Gerente, admin e financeiro leem a empresa inteira; o rep, a carteira dele.
    irrestrito: role === 'manager' || role === 'admin' || role === 'financeiro',
  });

  if (r.ok) {
    await reply.send({ data: { relatorio: r.relatorio, clientes: r.clientes, gerado_em: new Date().toISOString() } });
    return;
  }
  if (r.reason === 'sem_chave') {
    await reply.status(503).send({
      error: 'A IA ainda não está ligada — falta a chave ANTHROPIC_API_KEY no Railway',
      code: 'IA_DESLIGADA',
      statusCode: 503,
    });
    return;
  }
  if (r.reason === 'sem_migracao') {
    await reply.status(503).send({
      error: 'O relatório precisa do histórico de compra — falta aplicar a migração 036',
      code: 'IA_SEM_HISTORICO',
      statusCode: 503,
    });
    return;
  }
  if (r.reason === 'sem_clientes') {
    await reply.status(422).send({
      error: 'Sua carteira ainda não tem clientes para analisar',
      code: 'SEM_CLIENTES',
      statusCode: 422,
    });
    return;
  }
  await reply.status(502).send({
    error: 'A IA não respondeu — tente de novo em instantes',
    code: 'IA_FALHOU',
    statusCode: 502,
  });
}
