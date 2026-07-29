import type { FastifyRequest, FastifyReply } from 'fastify';
import { getProducts, listCompanyPriceTables, priceTableBelongsToCompany } from './catalog.service.js';

export async function listProducts(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, role, price_table_id: repPriceTableId } = request.user;
  const { price_table_id } = request.query as { price_table_id?: string };

  // Consultar o catálogo em OUTRA tabela é atribuição de gerente/admin. O
  // representante fica preso à tabela que o gerente atribuiu a ele — a tela já
  // esconde o seletor, mas sem esta trava bastava chamar a API com o query param
  // para ver o catálogo inteiro em qualquer tabela da empresa (INDUSTRIALIZAÇÃO,
  // 50%, …).
  const canChooseTable = role === 'manager' || role === 'admin';
  if (price_table_id && !canChooseTable) {
    await reply.status(403).send({
      error: 'Somente gerente ou admin pode consultar outra tabela de preço',
      code: 'FORBIDDEN',
      statusCode: 403,
    });
    return;
  }

  let tableId = repPriceTableId ?? undefined;
  if (price_table_id && (await priceTableBelongsToCompany(price_table_id, company_id))) {
    tableId = price_table_id;
  }

  const products = await getProducts(company_id, {
    price_table_id: tableId,
    // Estoque da fábrica é informação de gerente.
    includeStock: canChooseTable,
    // Para o representante, produto sem preço na tabela dele não é catálogo —
    // é um beco sem saída (entra no carrinho a R$ 0 e derruba o pedido inteiro).
    onlyPriced: !canChooseTable,
  });

  await reply.send({ data: products });
}

/** Tabelas de preço da empresa para o seletor de consulta (gerente/admin). */
export async function listCatalogPriceTables(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { company_id } = request.user;
  const tables = await listCompanyPriceTables(company_id);
  await reply.send({ data: tables });
}
