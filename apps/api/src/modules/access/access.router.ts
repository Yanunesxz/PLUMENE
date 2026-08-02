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
  minhaContaHandler,
  minhaAreaHandler,
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

  // A loja consulta o próprio cadastro. Ninguém mais precisa destas rotas.
  const daLoja = { preHandler: [authenticate, requireRole(['store'])] };

  // Mantida porque o app instalado no celular fica em cache: uma loja com a
  // versão anterior continua abrindo a tela dela enquanto o PWA não atualiza.
  fastify.get('/minha-conta', daLoja, minhaContaHandler);
  fastify.get('/minha-area', daLoja, minhaAreaHandler);

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
