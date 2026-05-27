import type { FastifyRequest, FastifyReply } from 'fastify';
import { getCustomers } from './customers.service.js';

export async function listCustomers(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, sub: rep_id, role } = request.user;
  const { search, include_blocked } = request.query as {
    search?: string;
    include_blocked?: string;
  };

  const customers = await getCustomers(
    company_id,
    role,
    rep_id,
    search,
    include_blocked !== 'false',
  );
  await reply.send({ data: customers });
}
