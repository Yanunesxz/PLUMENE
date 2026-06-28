import type { FastifyInstance } from 'fastify';
import { authenticate, requireRole } from '../../middleware/auth.js';
import {
  listOrders,
  getOrder,
  createOrderHandler,
  updateStatusHandler,
  setInvoicedHandler,
  deleteOrderHandler,
} from './orders.controller.js';

export async function ordersRouter(fastify: FastifyInstance): Promise<void> {
  fastify.get('/orders', { preHandler: authenticate }, listOrders);
  fastify.get('/orders/:id', { preHandler: authenticate }, getOrder);
  fastify.post('/orders', { preHandler: authenticate }, createOrderHandler);
  fastify.delete('/orders/:id', { preHandler: authenticate }, deleteOrderHandler);
  fastify.patch('/orders/:id/status', { preHandler: authenticate }, updateStatusHandler);
  fastify.patch(
    '/orders/:id/invoice',
    { preHandler: [authenticate, requireRole(['manager', 'admin'])] },
    setInvoicedHandler,
  );
}
