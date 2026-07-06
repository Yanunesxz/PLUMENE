import type { FastifyRequest, FastifyReply } from 'fastify';
import { getProducts, listCompanyPriceTables, priceTableBelongsToCompany } from './catalog.service.js';

export async function listProducts(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, price_table_id: repPriceTableId } = request.user;
  const { price_table_id } = request.query as { price_table_id?: string };

  // Por padrão precifica pela tabela do representante logado. O query param permite
  // CONSULTAR o catálogo em outra tabela — mas só se ela for da própria empresa.
  let tableId = repPriceTableId ?? undefined;
  if (price_table_id && (await priceTableBelongsToCompany(price_table_id, company_id))) {
    tableId = price_table_id;
  }

  const products = await getProducts(company_id, tableId);
  await reply.send({ data: products });
}

/** Lista as tabelas de preço da empresa para o seletor de consulta (qualquer papel). */
export async function listCatalogPriceTables(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { company_id } = request.user;
  const tables = await listCompanyPriceTables(company_id);
  await reply.send({ data: tables });
}
