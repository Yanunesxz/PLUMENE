import type { FastifyInstance } from 'fastify';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { listProducts, listCatalogPriceTables } from './catalog.controller.js';
import { importProductsHandler } from './import.controller.js';
import { uploadPhotoHandler } from './photos.controller.js';

export async function catalogRouter(fastify: FastifyInstance): Promise<void> {
  fastify.get('/products', { preHandler: authenticate }, listProducts);
  // Tabelas de preço para o seletor de consulta no catálogo. Só gerente/admin:
  // o representante não escolhe tabela, então nem precisa saber quais existem.
  fastify.get(
    '/catalog/price-tables',
    { preHandler: [authenticate, requireRole(['manager', 'admin'])] },
    listCatalogPriceTables,
  );
  // Importação de catálogo da própria empresa (multi-fábrica) — só admin.
  fastify.post(
    '/products/import',
    { preHandler: [authenticate, requireRole(['admin'])] },
    importProductsHandler,
  );
  // Upload de foto por produto (binário cru no corpo, ?sku= na query) — só admin.
  // O limite real é do content-type parser (3 MB); a validação de 2 MB devolve 413.
  fastify.post(
    '/products/fotos',
    { preHandler: [authenticate, requireRole(['admin'])] },
    uploadPhotoHandler,
  );
}
