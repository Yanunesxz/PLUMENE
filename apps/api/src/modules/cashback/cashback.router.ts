/**
 * CASHBACK DA VENDA INTERNA (migração 058; Yan, 12/11/2026).
 *
 * Leitura:
 *   • GET  /cashback/clientes          — a área: clientes com cashback e saldo
 *   • GET  /cashback/clientes/:id      — o extrato de um cliente
 *   • GET  /cashback/pedidos/:id       — o cartão de cashback na tela do pedido
 *   • GET  /cashback/meu               — a loja vê o próprio (Minha área)
 *
 * Escrita (venda interna, financeiro e admin — o handler ainda confere que o
 * representante é de venda interna e a janela de mexer no pedido):
 *   • POST   /cashback/pedidos/:id/uso { valor } — "Utilizado R$ X do cashback"
 *   • DELETE /cashback/pedidos/:id/uso           — desfaz
 *
 * O `rep` entra no requireRole das leituras porque a venda interna É um rep
 * (031, um interruptor no login); o representante comum toma 403 no handler.
 */
import type { FastifyInstance } from 'fastify';
import { authenticate, requireRole } from '../../middleware/auth.js';
import {
  desfazerHandler,
  extratoHandler,
  listarHandler,
  meuHandler,
  pedidoHandler,
  usarHandler,
} from './cashback.controller.js';

export async function cashbackRouter(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    '/cashback/clientes',
    { preHandler: [authenticate, requireRole(['rep', 'admin', 'manager', 'financeiro', 'visualizador'])] },
    listarHandler,
  );
  fastify.get(
    '/cashback/clientes/:id',
    { preHandler: [authenticate, requireRole(['rep', 'admin', 'manager', 'financeiro', 'visualizador'])] },
    extratoHandler,
  );
  fastify.get(
    '/cashback/pedidos/:id',
    { preHandler: [authenticate, requireRole(['rep', 'admin', 'manager', 'financeiro', 'visualizador'])] },
    pedidoHandler,
  );
  fastify.get('/cashback/meu', { preHandler: [authenticate, requireRole(['store'])] }, meuHandler);

  fastify.post(
    '/cashback/pedidos/:id/uso',
    { preHandler: [authenticate, requireRole(['rep', 'admin', 'financeiro'])] },
    usarHandler,
  );
  fastify.delete(
    '/cashback/pedidos/:id/uso',
    { preHandler: [authenticate, requireRole(['rep', 'admin', 'financeiro'])] },
    desfazerHandler,
  );
}
