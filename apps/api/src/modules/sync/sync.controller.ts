import type { FastifyRequest, FastifyReply } from 'fastify';
import type { SyncRequest } from '@csb/shared';
import { processSyncQueue } from './sync.service.js';

export async function syncHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, sub: rep_id } = request.user;
  const { orders } = request.body as SyncRequest;

  if (!Array.isArray(orders) || orders.length === 0) {
    await reply.status(400).send({
      error: 'orders deve ser um array não vazio',
      code: 'VALIDATION_ERROR',
      statusCode: 400,
    });
    return;
  }

  const result = await processSyncQueue(company_id, rep_id, orders);
  await reply.send({ data: result });
}
