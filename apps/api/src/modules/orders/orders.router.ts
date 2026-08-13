import type { FastifyInstance } from 'fastify';
import { authenticate, requireRole, requirePermission } from '../../middleware/auth.js';
import {
  listOrders,
  getOrder,
  createOrderHandler,
  updateStatusHandler,
  setInvoicedHandler,
  deleteOrderHandler,
  pedidoPublicoHandler,
  listPaymentConditions,
} from './orders.controller.js';

export async function ordersRouter(fastify: FastifyInstance): Promise<void> {
  // A loja consulta os pedidos DELA; o visitante da vitrine não consulta nada —
  // ele só monta e envia, e não tem onde acompanhar (não há conta).
  const daFabricaOuLoja = { preHandler: [authenticate, requireRole(['rep', 'manager', 'admin', 'store'])] };
  // Mexer no ciclo do pedido é de quem vende. Quem compra não muda status nem
  // apaga: sem isto, uma loja poderia aprovar o próprio pedido.
  //
  // Decidir e excluir andam juntos na mesma tecla: são as duas formas de tirar
  // um pedido do caminho de alguém. A tecla não atinge o representante — a
  // triagem dele usa esta mesma rota, e `temPermissao` deixa passar quem não é
  // gerente justamente por isso.
  const decideOPedido = {
    preHandler: [
      authenticate,
      requireRole(['rep', 'manager', 'admin']),
      requirePermission('aprovar_pedidos'),
    ],
  };

  // Página pública do pedido (o link do e-mail). Sem login — a segurança é o
  // token assinado. Rate-limit apertado, como as outras rotas /public.
  fastify.get(
    '/public/pedido/:token',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    pedidoPublicoHandler,
  );

  // A lista que o seletor de condição de pagamento usa — rep e loja escolhem
  // no pedido, então a loja também lê (mesmo conjunto de papéis dos pedidos).
  fastify.get('/payment-conditions', daFabricaOuLoja, listPaymentConditions);

  fastify.get('/orders', daFabricaOuLoja, listOrders);
  fastify.get('/orders/:id', daFabricaOuLoja, getOrder);
  fastify.post('/orders', { preHandler: authenticate }, createOrderHandler);
  fastify.delete('/orders/:id', decideOPedido, deleteOrderHandler);
  fastify.patch('/orders/:id/status', decideOPedido, updateStatusHandler);
  fastify.patch(
    '/orders/:id/invoice',
    {
      preHandler: [
        authenticate,
        requireRole(['manager', 'admin']),
        requirePermission('faturar_pedidos'),
      ],
    },
    setInvoicedHandler,
  );
}
