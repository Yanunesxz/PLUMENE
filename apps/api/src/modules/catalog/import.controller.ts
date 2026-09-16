import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { parseBody } from '../../lib/validation.js';
import { exigirCanal, type CanalRecusado } from '../../lib/canais.js';
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
        color: z.string().trim().max(40).optional(),
        variant_group: z.string().trim().max(40).optional(),
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

  // O catálogo tem UM escritor por empresa (048, canal_catalogo). Com o
  // catálogo vindo do Control pela API (decisão 6), reimportar a planilha
  // regravaria preço e estoque por cima do que o Control mandou — e a próxima
  // carga desfaria a decisão. Banco que não respondeu não importa: um soluço
  // não pode abrir o canal (revisão de 16/09/2026).
  let recusa: CanalRecusado<'catalogo'> | null;
  try {
    recusa = await exigirCanal(company_id, 'catalogo', 'carga');
  } catch (err) {
    request.log.error({ err }, 'importação sem resposta do banco sobre o canal de catálogo');
    await reply.status(503).send({
      error: 'Não deu para conferir o canal desta empresa. Nada foi importado — tente de novo em instantes.',
      code: 'CANAL_INDISPONIVEL',
      statusCode: 503,
    });
    return;
  }
  if (recusa) {
    await reply.status(409).send({
      error:
        recusa.valor_atual === 'api'
          ? 'O catálogo desta empresa vem do Control pela integração — a importação por planilha está desligada, senão ela desfaria o preço e o estoque que o Control mandou.'
          : 'O catálogo desta empresa não é carregado por planilha — a importação está desligada.',
      code: 'CANAL_FECHADO',
      statusCode: 409,
      canal: recusa.canal,
      valor_atual: recusa.valor_atual,
    });
    return;
  }

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
