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
import compress from '@fastify/compress';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { env } from './config/env.js';
import { authRouter } from './modules/auth/auth.router.js';
import { catalogRouter } from './modules/catalog/catalog.router.js';
import { customersRouter } from './modules/customers/customers.router.js';
import { ordersRouter } from './modules/orders/orders.router.js';
import { repsRouter } from './modules/reps/reps.router.js';
import { syncRouter } from './modules/sync/sync.router.js';
import { partnerRouter } from './modules/partner/partner.router.js';
import { companyRouter } from './modules/company/company.router.js';
import { accessRouter } from './modules/access/access.router.js';
import { usersRouter } from './modules/users/users.router.js';

export async function buildApp(): Promise<FastifyInstance> {
  const server = Fastify({
    // Railway/Vercel ficam atrás de proxy: sem isso, request.ip é o IP do proxy
    // e o rate-limit trataria todos os clientes como um só (um atacante travaria
    // todo mundo). Com trustProxy, o limite é por IP real do cliente.
    trustProxy: true,
    logger:
      env.NODE_ENV !== 'production'
        ? { level: 'debug', transport: { target: 'pino-pretty', options: { colorize: true } } }
        : { level: 'info' },
  });

  await server.register(helmet, { global: true });

  // As respostas iam CRUAS pela rede. O catálogo (313 produtos com a grade
  // inteira) e a carteira (1.353 clientes) são JSON repetitivo — o tipo de
  // conteúdo que o gzip reduz a uma fração. Sem isto, o primeiro acesso do
  // representante baixava centenas de KB antes de a tela existir, e no 3G da
  // rua isso é a diferença entre segundos e minutos.
  //
  // `global: true` vale para todas as rotas; abaixo do limiar não compensa
  // gastar CPU comprimindo, então respostas curtas seguem cruas.
  await server.register(compress, {
    global: true,
    // brotli comprime mais, mas custa CPU; o navegador escolhe o que aceita.
    encodings: ['br', 'gzip', 'deflate'],
    threshold: 1024,
  });

  // Proteção contra abuso/força-bruta. Limite global folgado (uso normal nem
  // encosta); rotas sensíveis como /auth/login apertam via `config.rateLimit`.
  await server.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    // Sem allowList: o limite vale para todos os IPs.
  });
  await server.register(cors, {
    origin: env.CORS_ORIGIN,
    credentials: true,
  });
  await server.register(jwt, { secret: env.JWT_SECRET });

  // Upload de foto vai como binário cru (sem base64): parser dedicado que entrega
  // o Buffer direto. bodyLimit próprio acomoda a foto (2 MB) + folga; não afeta as
  // rotas JSON, que seguem no parser padrão.
  server.addContentTypeParser(
    ['application/octet-stream', 'image/jpeg', 'image/png', 'image/webp'],
    { parseAs: 'buffer', bodyLimit: 3 * 1024 * 1024 },
    (_req, body, done) => done(null, body),
  );

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
  await server.register(partnerRouter);
  await server.register(companyRouter);
  await server.register(accessRouter);
  await server.register(usersRouter);

  return server;
}
