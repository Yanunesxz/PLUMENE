import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/auth.js';
import { listProducts } from './catalog.controller.js';

export async function catalogRouter(fastify: FastifyInstance): Promise<void> {
  fastify.get('/products', { preHandler: authenticate }, listProducts);
}
