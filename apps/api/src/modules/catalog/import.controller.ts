import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { parseBody } from '../../lib/validation.js';
import { importProducts } from './import.service.js';

const importSchema = z.object({
  products: z
    .array(
      z.object({
        sku: z.string().trim().min(1, 'SKU vazio').max(40),
        name: z.string().trim().min(1, 'Nome vazio').max(200),
        price: z.number().nonnegative().optional(),
        sizes: z
          .array(
            z.object({
              size: z.string().trim().min(1).max(20),
              stock: z.number().int().nonnegative().default(0),
            }),
          )
          .max(30)
          .optional(),
        image_url: z.string().trim().url('URL de foto inválida').max(500).optional(),
        group: z.string().trim().max(100).optional(),
      }),
    )
    .min(1, 'Nenhum produto na importação')
    .max(2000, 'Máximo de 2000 produtos por importação'),
});

export async function importProductsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const body = await parseBody(importSchema, request.body, reply);
  if (!body) return;

  const { company_id } = request.user;
  try {
    const summary = await importProducts(company_id, body.products);
    await reply.send({ data: summary });
  } catch (err) {
    request.log.error({ err }, 'import failed');
    await reply.status(500).send({
      error: err instanceof Error ? err.message : 'Falha na importação',
      code: 'IMPORT_FAILED',
      statusCode: 500,
    });
  }
}
