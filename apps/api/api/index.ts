/**
 * Entrada da API na Vercel (função serverless).
 *
 * A Vercel invoca este arquivo para toda requisição; o `vercel.json` ao lado
 * reescreve qualquer caminho para cá, então as rotas continuam sendo as
 * mesmas de sempre (/health, /auth/login, /partner/v1/pedidos...).
 *
 * A instância Fastify é criada uma vez por container e reaproveitada entre
 * requisições — por isso a promise fica no escopo do módulo.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildApp } from '../src/app.js';

const appPromise = buildApp().then(async (app) => {
  await app.ready();
  return app;
});

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const app = await appPromise;
  app.server.emit('request', req, res);
}
