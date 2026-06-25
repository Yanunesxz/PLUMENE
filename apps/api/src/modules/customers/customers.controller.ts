import type { FastifyRequest, FastifyReply } from 'fastify';
import type { CreateCustomerRequest } from '@csb/shared';
import { getCustomers, createCustomer } from './customers.service.js';

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

export async function createCustomerHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, sub: rep_id } = request.user;
  const body = request.body as CreateCustomerRequest;

  if (!body?.name?.trim()) {
    await reply.status(400).send({ error: 'Nome é obrigatório', code: 'VALIDATION_ERROR', statusCode: 400 });
    return;
  }

  const customer = await createCustomer(company_id, rep_id, body);
  if (!customer) {
    await reply.status(500).send({ error: 'Não foi possível criar o cliente', code: 'CREATE_FAILED', statusCode: 500 });
    return;
  }
  await reply.status(201).send({ data: customer });
}
