import type { FastifyInstance } from 'fastify';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { listProducts, listCatalogPriceTables } from './catalog.controller.js';
import { importProductsHandler } from './import.controller.js';
import { uploadPhotoHandler } from './photos.controller.js';

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
  // Upload de foto (base64) por produto — só admin. bodyLimit acomoda 2 MB de
  // imagem + ~4/3 do base64 + overhead do JSON.
  fastify.post(
    '/products/fotos',
    { preHandler: [authenticate, requireRole(['admin'])], bodyLimit: 4 * 1024 * 1024 },
    uploadPhotoHandler,
  );
}
