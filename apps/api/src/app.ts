/**
 * Monta a aplicação Fastify (rotas, plugins, tratamento de erro).
 *
 * Separado do `index.ts` de propósito: aqui não há `listen()`. Assim a mesma
 * aplicação serve tanto o servidor local (index.ts) quanto a função
 * serverless da Vercel (api/index.ts), que só precisa da instância pronta.
 */
import 'dotenv/config';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import { env } from './config/env.js';
import { authRouter } from './modules/auth/auth.router.js';
import { catalogRouter } from './modules/catalog/catalog.router.js';
import { customersRouter } from './modules/customers/customers.router.js';
import { ordersRouter } from './modules/orders/orders.router.js';
import { repsRouter } from './modules/reps/reps.router.js';
import { syncRouter } from './modules/sync/sync.router.js';
import { assistantRouter } from './modules/assistant/assistant.router.js';
import { partnerRouter } from './modules/partner/partner.router.js';
import { companyRouter } from './modules/company/company.router.js';

export async function buildApp(): Promise<FastifyInstance> {
  const server = Fastify({
    logger:
      env.NODE_ENV !== 'production'
        ? { level: 'debug', transport: { target: 'pino-pretty', options: { colorize: true } } }
        : { level: 'info' },
  });

  await server.register(helmet, { global: true });
  await server.register(cors, {
    origin: env.CORS_ORIGIN,
    credentials: true,
  });
  await server.register(jwt, { secret: env.JWT_SECRET });

  server.setErrorHandler((error, request, reply) => {
    server.log.error({ err: error, url: request.url }, 'unhandled request error');

    if (error.validation) {
      void reply.status(400).send({
        error: 'Dados inválidos',
        code: 'VALIDATION_ERROR',
        statusCode: 400,
      });
      return;
    }

    const statusCode = error.statusCode ?? 500;
    void reply.status(statusCode).send({
      error: statusCode >= 500 ? 'Erro interno do servidor' : error.message,
      code: 'INTERNAL_ERROR',
      statusCode,
    });
  });

  server.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: env.NODE_ENV,
  }));

  await server.register(authRouter);
  await server.register(catalogRouter);
  await server.register(customersRouter);
  await server.register(ordersRouter);
  await server.register(repsRouter);
  await server.register(syncRouter);
  await server.register(assistantRouter);
  await server.register(partnerRouter);
  await server.register(companyRouter);

  return server;
}
