import type { FastifyInstance } from 'fastify';
import { authenticate, requireRole } from '../../middleware/auth.js';
import {
  listCustomers,
  getCustomerHandler,
  createCustomerHandler,
  trocarTabelaDoClienteHandler,
} from './customers.controller.js';

export async function customersRouter(fastify: FastifyInstance): Promise<void> {
  // A carteira de clientes é de quem vende. A loja não tem o que fazer aqui —
  // ela é UM cliente, não tem carteira — e o visitante da vitrine muito menos.
  // Sem esta guarda, um token de loja listava os clientes inteiros da empresa.
  //
  // O financeiro LÊ tudo (confere cliente e código antes de lançar no ERP) e
  // não escreve nada — cadastro é assunto de quem vende. Decisão do Yan
  // (14/08/2026): "não pode alterar cadastro dos clientes, só visualizar".
  const leitura = { preHandler: [authenticate, requireRole(['rep', 'manager', 'admin', 'financeiro'])] };
  const escrita = { preHandler: [authenticate, requireRole(['rep', 'manager', 'admin'])] };

  fastify.get('/customers', leitura, listCustomers);
  fastify.get('/customers/:id', leitura, getCustomerHandler);
  fastify.post('/customers', escrita, createCustomerHandler);
  // Só a tabela de preço. Edição de cadastro é outro assunto, com outros riscos.
  fastify.patch('/customers/:id', escrita, trocarTabelaDoClienteHandler);
}
