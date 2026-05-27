import type { FastifyInstance } from 'fastify';
import { login, refreshToken } from './auth.controller.js';

export async function authRouter(fastify: FastifyInstance): Promise<void> {
  fastify.post('/auth/login', login);
  fastify.post('/auth/refresh', refreshToken);
}
