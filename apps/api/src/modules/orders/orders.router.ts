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
  // A loja consulta os pedidos DELA; o visitante da vitrine não consulta nada —
  // ele só monta e envia, e não tem onde acompanhar (não há conta).
  const daFabricaOuLoja = { preHandler: [authenticate, requireRole(['rep', 'manager', 'admin', 'store'])] };
  // Mexer no ciclo do pedido é de quem vende. Quem compra não muda status nem
  // apaga: sem isto, uma loja poderia aprovar o próprio pedido.
  const daFabrica = { preHandler: [authenticate, requireRole(['rep', 'manager', 'admin'])] };

  fastify.get('/orders', daFabricaOuLoja, listOrders);
  fastify.get('/orders/:id', daFabricaOuLoja, getOrder);
  fastify.post('/orders', { preHandler: authenticate }, createOrderHandler);
  fastify.delete('/orders/:id', daFabrica, deleteOrderHandler);
  fastify.patch('/orders/:id/status', daFabrica, updateStatusHandler);
  fastify.patch(
    '/orders/:id/invoice',
    { preHandler: [authenticate, requireRole(['manager', 'admin'])] },
    setInvoicedHandler,
  );
}
