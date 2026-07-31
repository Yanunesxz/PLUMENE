import type { FastifyInstance } from 'fastify';
import { authenticate, requireRole } from '../../middleware/auth.js';
import {
  criarConviteHandler,
  listarConvitesHandler,
  revogarConviteHandler,
  criarVitrineHandler,
  listarVitrinesHandler,
  revogarVitrineHandler,
  abrirConviteHandler,
  aceitarConviteHandler,
  abrirVitrineHandler,
} from './access.controller.js';

export async function accessRouter(fastify: FastifyInstance): Promise<void> {
  // Quem gera acesso é quem vende: representante, gerente e admin. A loja e o
  // visitante nunca chegam aqui.
  const guard = { preHandler: [authenticate, requireRole(['rep', 'manager', 'admin'])] };

  fastify.post('/invites', guard, criarConviteHandler);
  fastify.get('/invites', guard, listarConvitesHandler);
  fastify.delete('/invites/:id', guard, revogarConviteHandler);

  fastify.post('/showcase-links', guard, criarVitrineHandler);
  fastify.get('/showcase-links', guard, listarVitrinesHandler);
  fastify.delete('/showcase-links/:id', guard, revogarVitrineHandler);

  // ─── Públicas ──────────────────────────────────────────────────────────────
  // As únicas rotas do sistema sem autenticação além do login. Rate-limit
  // apertado: quem tem o token abre uma vez e pronto; volume aqui é varredura.
  const publico = {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  };

  fastify.get('/public/invite/:token', publico, abrirConviteHandler);
  fastify.post('/public/invite/:token', publico, aceitarConviteHandler);
  fastify.post('/public/showcase/:token', publico, abrirVitrineHandler);
}
