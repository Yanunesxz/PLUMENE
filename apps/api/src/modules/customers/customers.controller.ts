import type { FastifyRequest, FastifyReply } from 'fastify';
import { getCustomers, createCustomer } from './customers.service.js';
import { parseBody } from '../../lib/validation.js';
import { createCustomerSchema } from './customers.schema.js';

export async function listCustomers(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, sub: rep_id, role, erp_rep_id } = request.user;
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
    erp_rep_id,
  );
  await reply.send({ data: customers });
}

export async function createCustomerHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, sub: rep_id } = request.user;
  const body = await parseBody(createCustomerSchema, request.body, reply);
  if (!body) return;

  const customer = await createCustomer(company_id, rep_id, {
    name: body.name,
    trade_name: body.trade_name ?? null,
    cnpj: body.cnpj ?? null,
    whatsapp: body.whatsapp ?? null,
    email: body.email ?? null,
    address: body.address ?? null,
  });
  if (!customer) {
    await reply.status(500).send({ error: 'Não foi possível criar o cliente', code: 'CREATE_FAILED', statusCode: 500 });
    return;
  }
  await reply.status(201).send({ data: customer });
}
