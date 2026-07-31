import type { FastifyInstance } from 'fastify';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { listCustomers, createCustomerHandler } from './customers.controller.js';

export async function customersRouter(fastify: FastifyInstance): Promise<void> {
  // A carteira de clientes é de quem vende. A loja não tem o que fazer aqui —
  // ela é UM cliente, não tem carteira — e o visitante da vitrine muito menos.
  // Sem esta guarda, um token de loja listava os clientes inteiros da empresa.
  const guard = { preHandler: [authenticate, requireRole(['rep', 'manager', 'admin'])] };

  fastify.get('/customers', guard, listCustomers);
  fastify.post('/customers', guard, createCustomerHandler);
}
