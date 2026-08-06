import type { FastifyInstance } from 'fastify';
import { authenticate, requireRole, requirePermission } from '../../middleware/auth.js';
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
  // Importação de catálogo da própria empresa (multi-fábrica) e upload de foto
  // por produto (binário cru no corpo, ?sku= na query). Eram exclusivas do
  // admin, e continuam assim por padrão: `importar_produtos` nasce desligada no
  // gerente. Ele só chega aqui se o admin ligar a dele — que é o ponto.
  // O limite real da foto é do content-type parser (3 MB); a validação de 2 MB
  // devolve 413.
  const podeImportar = {
    preHandler: [
      authenticate,
      requireRole(['manager', 'admin']),
      requirePermission('importar_produtos'),
    ],
  };

  fastify.post('/products/import', podeImportar, importProductsHandler);
  fastify.post('/products/fotos', podeImportar, uploadPhotoHandler);
}
