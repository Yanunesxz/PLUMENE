import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/auth.js';
import { login, refreshToken, changePassword } from './auth.controller.js';

export async function authRouter(fastify: FastifyInstance): Promise<void> {
  fastify.post('/auth/login', login);
  fastify.post('/auth/refresh', refreshToken);
  // Troca de senha do próprio usuário logado (rep, gerente ou admin).
  fastify.post('/auth/change-password', { preHandler: authenticate }, changePassword);
}
