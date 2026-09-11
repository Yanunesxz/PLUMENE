import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { parseBody } from '../../lib/validation.js';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { onboardCompany } from './company.service.js';
import { lerRegua, salvarRegua } from './carteira.service.js';

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


const reguaSchema = z.object({
  atencao: z.number().int().min(1).max(3650),
  esfriado: z.number().int().min(1).max(3650),
});

/**
 * GET /company/carteira — a régua que pinta o cliente de amarelo e vermelho.
 *
 * Aberta a quem está logado: o selo do cliente aparece na tela do
 * representante, da loja e do escritório, e todos precisam medir pela MESMA
 * régua. Quem MUDA é só o admin, logo abaixo.
 */
async function lerReguaHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const regua = await lerRegua(request.user.company_id);
  await reply.send({ data: regua });
}

/** PATCH /company/carteira — o admin muda os dias de cada faixa na mão. */
async function salvarReguaHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = await parseBody(reguaSchema, request.body, reply);
  if (!body) return;

  const r = await salvarRegua(request.user.company_id, body);
  if (r.ok) {
    await reply.send({ data: r.regua });
    return;
  }
  if (r.motivo === 'ordem') {
    await reply.status(400).send({
      error: 'O prazo do vermelho tem de ser MAIOR que o do amarelo — senão a faixa de atenção some.',
      code: 'VALIDATION_ERROR',
      statusCode: 400,
    });
    return;
  }
  if (r.motivo === 'sem_migracao') {
    await reply.status(503).send({
      error: 'A migração 043 ainda não rodou neste banco — a régua continua em 90/180.',
      code: 'MIGRACAO_PENDENTE',
      statusCode: 503,
    });
    return;
  }
  await reply.status(500).send({ error: 'Falha ao salvar a régua', code: 'INTERNAL_ERROR', statusCode: 500 });
}

export async function companyRouter(fastify: FastifyInstance): Promise<void> {
  fastify.post('/companies/onboard', onboardHandler);
  fastify.get('/company/carteira', { preHandler: [authenticate] }, lerReguaHandler);
  fastify.patch(
    '/company/carteira',
    { preHandler: [authenticate, requireRole(['admin'])] },
    salvarReguaHandler,
  );
}
