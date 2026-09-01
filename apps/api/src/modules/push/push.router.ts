import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/auth.js';
import {
  chavePublicaHandler,
  assinarHandler,
  desassinarHandler,
  testeHandler,
} from './push.controller.js';

/**
 * Avisos no celular — qualquer usuário logado ativa no próprio aparelho.
 * O teste também é aberto: ele só manda para os aparelhos de quem clicou,
 * então não tem como incomodar ninguém além de si mesmo.
 */
export async function pushRouter(fastify: FastifyInstance): Promise<void> {
  const logado = { preHandler: [authenticate] };

  fastify.get('/push/chave-publica', logado, chavePublicaHandler);
  fastify.post('/push/assinar', logado, assinarHandler);
  // POST, não DELETE: o cliente da web não manda corpo em DELETE.
  fastify.post('/push/desassinar', logado, desassinarHandler);
  fastify.post('/push/teste', logado, testeHandler);
}
