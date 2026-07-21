import type { FastifyInstance } from 'fastify';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { listProducts, listCatalogPriceTables } from './catalog.controller.js';
import { importProductsHandler } from './import.controller.js';

export async function catalogRouter(fastify: FastifyInstance): Promise<void> {
  fastify.get('/products', { preHandler: authenticate }, listProducts);
  // Tabelas de preço para o seletor de consulta no catálogo (todos os papéis).
  fastify.get('/catalog/price-tables', { preHandler: authenticate }, listCatalogPriceTables);
  // Importação de catálogo da própria empresa (multi-fábrica) — só admin.
  fastify.post(
    '/products/import',
    { preHandler: [authenticate, requireRole(['admin'])] },
    importProductsHandler,
  );
}
