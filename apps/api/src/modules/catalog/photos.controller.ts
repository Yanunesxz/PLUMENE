import type { FastifyRequest, FastifyReply } from 'fastify';
import { uploadProductPhoto, MAX_IMAGE_BYTES } from './photos.service.js';

// A foto chega como binário cru no corpo (Content-Type image/* ou octet-stream);
// a referência do produto vem na query (?sku=0001).
export async function uploadPhotoHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { sku } = request.query as { sku?: string };
  if (!sku || !sku.trim()) {
    await reply.status(400).send({ error: 'Informe a referência (?sku=)', code: 'VALIDATION_ERROR', statusCode: 400 });
    return;
  }

  const body = request.body;
  if (!Buffer.isBuffer(body) || body.length === 0) {
    await reply.status(400).send({ error: 'Corpo da requisição vazio ou não é uma imagem.', code: 'EMPTY_BODY', statusCode: 400 });
    return;
  }

  const { company_id } = request.user;
  const result = await uploadProductPhoto(company_id, sku, body);

  if (!result.ok) {
    if (result.reason === 'not_found') {
      await reply.status(404).send({
        error: `Nenhum produto com a referência "${sku}" nesta empresa.`,
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
