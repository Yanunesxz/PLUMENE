import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/auth.js';
import { listOrders, getOrder, createOrderHandler, updateStatusHandler } from './orders.controller.js';

export async function ordersRouter(fastify: FastifyInstance): Promise<void> {
  fastify.get('/orders', { preHandler: authenticate }, listOrders);
  fastify.get('/orders/:id', { preHandler: authenticate }, getOrder);
  fastify.post('/orders', { preHandler: authenticate }, createOrderHandler);
  fastify.patch('/orders/:id/status', { preHandler: authenticate }, updateStatusHandler);
}
