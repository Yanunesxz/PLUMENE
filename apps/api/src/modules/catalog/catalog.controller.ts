import type { FastifyRequest, FastifyReply } from 'fastify';
import { getProducts } from './catalog.service.js';

export async function listProducts(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, price_table_id: repPriceTableId } = request.user;
  const { price_table_id } = request.query as { price_table_id?: string };

  // Precifica pela tabela do representante logado; query param pode sobrepor.
  const tableId = price_table_id ?? repPriceTableId ?? undefined;

  const products = await getProducts(company_id, tableId);
  await reply.send({ data: products });
}
