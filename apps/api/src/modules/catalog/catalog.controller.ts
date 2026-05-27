import type { FastifyRequest, FastifyReply } from 'fastify';
import { getProducts } from './catalog.service.js';

export async function listProducts(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id } = request.user;
  const { price_table_id } = request.query as { price_table_id?: string };

  const products = await getProducts(company_id, price_table_id);
  await reply.send({ data: products });
}
