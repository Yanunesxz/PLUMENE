import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { parseBody } from '../../lib/validation.js';
import { answer } from './assistant.service.js';

const chatSchema = z.object({
  message: z.string().min(1, 'Digite uma mensagem').max(1000, 'Mensagem muito longa'),
});

export async function chatHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = await parseBody(chatSchema, request.body, reply);
  if (!body) return;

  const { company_id, sub: rep_id, role, price_table_id, name } = request.user;

  const result = await answer(
    { company_id, rep_id, role, price_table_id: price_table_id ?? null, name },
    body.message,
  );

  await reply.send({ data: result });
}
