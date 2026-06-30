import type { FastifyReply } from 'fastify';
import type { ZodSchema } from 'zod';

/**
 * Valida o body com o schema; em caso de erro já envia a resposta 400
 * padronizada e retorna null (o controller deve apenas `return` nesse caso).
 */
export async function parseBody<T>(
  schema: ZodSchema<T>,
  body: unknown,
  reply: FastifyReply,
): Promise<T | null> {
  const result = schema.safeParse(body);
  if (!result.success) {
    const message = result.error.issues[0]?.message ?? 'Dados inválidos';
    await reply.status(400).send({
      error: message,
      code: 'VALIDATION_ERROR',
      statusCode: 400,
    });
    return null;
  }
  return result.data;
}
