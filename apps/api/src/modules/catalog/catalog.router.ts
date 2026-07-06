import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/auth.js';
import { listProducts, listCatalogPriceTables } from './catalog.controller.js';

export async function catalogRouter(fastify: FastifyInstance): Promise<void> {
  fastify.get('/products', { preHandler: authenticate }, listProducts);
  // Tabelas de preço para o seletor de consulta no catálogo (todos os papéis).
  fastify.get('/catalog/price-tables', { preHandler: authenticate }, listCatalogPriceTables);
}
