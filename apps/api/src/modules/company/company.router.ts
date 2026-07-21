import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { parseBody } from '../../lib/validation.js';
import { onboardCompany } from './company.service.js';

const onboardSchema = z.object({
  company_name: z.string().trim().min(2, 'Nome da empresa muito curto').max(120),
  admin_name: z.string().trim().min(2, 'Nome do admin muito curto').max(120),
  admin_email: z.string().trim().email('E-mail inválido'),
  admin_password: z.string().min(6, 'Senha deve ter ao menos 6 caracteres').max(72),
});

async function onboardHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  // Rota da PLATAFORMA (dono do sistema), não de tenant: exige a chave secreta.
  if (!env.PLATFORM_ONBOARD_KEY) {
    await reply.status(503).send({
      error: 'Onboarding desabilitado (PLATFORM_ONBOARD_KEY não configurada)',
      code: 'ONBOARD_DISABLED',
      statusCode: 503,
    });
    return;
  }
  const key = request.headers['x-platform-key'];
  if (key !== env.PLATFORM_ONBOARD_KEY) {
    await reply.status(401).send({ error: 'Chave de plataforma inválida', code: 'UNAUTHORIZED', statusCode: 401 });
    return;
  }

  const body = await parseBody(onboardSchema, request.body, reply);
  if (!body) return;

  const result = await onboardCompany(body);
  if (!result.ok) {
    if (result.reason === 'email_taken') {
      await reply.status(409).send({
        error: 'Já existe um usuário com esse e-mail (o e-mail é único entre todas as empresas).',
        code: 'EMAIL_TAKEN',
        statusCode: 409,
      });
      return;
    }
    await reply.status(500).send({
      error: `Falha ao criar a empresa${result.detail ? `: ${result.detail}` : ''}`,
      code: 'ONBOARD_FAILED',
      statusCode: 500,
    });
    return;
  }

  await reply.status(201).send({ data: result });
}

export async function companyRouter(fastify: FastifyInstance): Promise<void> {
  fastify.post('/companies/onboard', onboardHandler);
}
