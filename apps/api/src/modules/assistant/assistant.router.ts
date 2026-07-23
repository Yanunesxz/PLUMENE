import type { FastifyInstance } from 'fastify';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { chatHandler } from './assistant.controller.js';

export async function assistantRouter(fastify: FastifyInstance): Promise<void> {
  // Assistente de IA (EM DESENVOLVIMENTO). Além de autenticado, exige manager/admin:
  // fora do alcance do representante também no servidor (defesa em profundidade),
  // não só escondido no menu. Herda company_id/role do usuário logado.
  fastify.post(
    '/assistant',
    { preHandler: [authenticate, requireRole(['manager', 'admin'])] },
    chatHandler,
  );
}
