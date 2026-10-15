import type { FastifyInstance } from 'fastify';
import { authenticate, requireRole } from '../../middleware/auth.js';
import {
  chavePublicaHandler,
  assinarHandler,
  desassinarHandler,
  testeHandler,
  enviarAvisoHandler,
} from './push.controller.js';

/**
 * Avisos no celular — qualquer usuário logado ativa no próprio aparelho.
 * O teste também é aberto: ele só manda para os aparelhos de quem clicou,
 * então não tem como incomodar ninguém além de si mesmo.
 * O ENVIO em massa (promoção, recado) é outra história: só gerente e admin.
 */
export async function pushRouter(fastify: FastifyInstance): Promise<void> {
  const logado = { preHandler: [authenticate] };
  const soFabrica = { preHandler: [authenticate, requireRole(['manager', 'admin'])] };
  // Quem recebe aviso no celular. Até 15/10/2026 estas três rotas tinham só
  // `authenticate` — e assinar GRAVA em push_subscriptions (o teste ainda
  // dispara envio), então o visualizador escreveria por aqui. A lista é a de
  // sempre MENOS o visualizador: ele não trabalha fila nenhuma, logo não tem
  // aviso de fluxo para receber ("so nao pode alterar nada").
  const recebeAviso = {
    preHandler: [
      authenticate,
      requireRole(['rep', 'manager', 'admin', 'financeiro', 'relacionamento', 'store', 'guest']),
    ],
  };

  fastify.get('/push/chave-publica', logado, chavePublicaHandler);
  fastify.post('/push/assinar', recebeAviso, assinarHandler);
  // POST, não DELETE: o cliente da web não manda corpo em DELETE.
  fastify.post('/push/desassinar', recebeAviso, desassinarHandler);
  fastify.post('/push/teste', recebeAviso, testeHandler);
  fastify.post('/push/enviar', soFabrica, enviarAvisoHandler);
}
