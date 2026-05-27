import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/auth.js';
import { syncHandler } from './sync.controller.js';

export async function syncRouter(fastify: FastifyInstance): Promise<void> {
  fastify.post('/sync', { preHandler: authenticate }, syncHandler);
}
