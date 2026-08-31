/**
 * IA sob demanda — a rota só trabalha (e só custa) quando alguém aperta o botão.
 *
 * Rate limit próprio e apertado: cada chamada vira uma cobrança em dólar na
 * conta da Anthropic, então um loop acidental no front não pode virar fatura.
 */
import type { FastifyInstance } from 'fastify';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { relatorioDaCarteiraHandler } from './ia.controller.js';

export async function iaRouter(fastify: FastifyInstance): Promise<void> {
  fastify.post(
    '/ia/relatorio-carteira',
    {
      preHandler: [authenticate, requireRole(['rep', 'manager', 'admin', 'financeiro'])],
      config: { rateLimit: { max: 6, timeWindow: '1 minute' } },
    },
    relatorioDaCarteiraHandler,
  );
}
