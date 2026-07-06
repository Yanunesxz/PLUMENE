import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/auth.js';
import { chatHandler } from './assistant.controller.js';

export async function assistantRouter(fastify: FastifyInstance): Promise<void> {
  // Assistente de IA (mock por enquanto). Autenticado: herda company_id, rep_id,
  // role e tabela de preço do usuário logado — mesma segurança das outras rotas.
  fastify.post('/assistant', { preHandler: authenticate }, chatHandler);
}
