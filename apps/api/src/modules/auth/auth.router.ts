import type { FastifyInstance } from 'fastify';
import { login, refreshToken } from './auth.controller.js';

export async function authRouter(fastify: FastifyInstance): Promise<void> {
  // Login é o alvo clássico de força-bruta: aperta para 10 tentativas/min por IP
  // (o limite global de 300/min continua valendo como teto geral).
  fastify.post('/auth/login', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    handler: login,
  });
  fastify.post('/auth/refresh', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    handler: refreshToken,
  });
}
