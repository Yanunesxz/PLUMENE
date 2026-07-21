import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { parseBody } from '../../lib/validation.js';
import { uploadProductPhoto, MAX_IMAGE_BYTES } from './photos.service.js';

const schema = z.object({
  sku: z.string().trim().min(1, 'SKU vazio').max(40),
  image_base64: z.string().min(1, 'Imagem vazia'),
});

export async function uploadPhotoHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = await parseBody(schema, request.body, reply);
  if (!body) return;

  const { company_id } = request.user;
  const result = await uploadProductPhoto(company_id, body.sku, body.image_base64);

  if (!result.ok) {
    if (result.reason === 'not_found') {
      await reply.status(404).send({
        error: `Nenhum produto com a referência "${body.sku}" nesta empresa.`,
        code: 'PRODUCT_NOT_FOUND',
        statusCode: 404,
      });
      return;
    }
    if (result.reason === 'too_large') {
      await reply.status(413).send({
        error: `Imagem maior que ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB.`,
        code: 'IMAGE_TOO_LARGE',
        statusCode: 413,
      });
      return;
    }
    await reply.status(500).send({
      error: `Falha ao enviar a foto${result.detail ? `: ${result.detail}` : ''}`,
      code: 'PHOTO_UPLOAD_FAILED',
      statusCode: 500,
    });
    return;
  }

  await reply.send({ data: result });
}
