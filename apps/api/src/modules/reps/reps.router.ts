import type { FastifyInstance } from 'fastify';
import { authenticate, requireRole } from '../../middleware/auth.js';
import {
  listRepsHandler,
  createRepHandler,
  updateRepHandler,
  deleteRepHandler,
  listPriceTablesHandler,
  minhasPriceTablesHandler,
  listarMetasHandler,
  salvarMetaHandler,
  minhaMetaHandler,
} from './reps.controller.js';

export async function repsRouter(fastify: FastifyInstance): Promise<void> {
  const guard = { preHandler: [authenticate, requireRole(['manager', 'admin'])] };

  fastify.get('/reps', guard, listRepsHandler);
  fastify.post('/reps', guard, createRepHandler);
  fastify.patch('/reps/:id', guard, updateRepHandler);
  fastify.delete('/reps/:id', guard, deleteRepHandler);
  fastify.get('/price-tables', guard, listPriceTablesHandler);

  // Meta de bonificação: quem cadastra é o gerente, por representante e por mês.
  fastify.get('/reps/:id/meta', guard, listarMetasHandler);
  fastify.put('/reps/:id/meta', guard, salvarMetaHandler);

  // A do próprio representante. Sem id na URL de propósito: o token diz de quem
  // é a meta, então não existe pedir a do colega.
  fastify.get(
    '/minha-meta',
    { preHandler: [authenticate, requireRole(['rep', 'manager', 'admin'])] },
    minhaMetaHandler,
  );

  // As tabelas que QUEM PEDIU pode atribuir. O representante só recebe o
  // conjunto dele: com uma tabela só, ele não descobre que existem outras.
  // Gerente e admin recebem todas — são eles que atribuem.
  fastify.get(
    '/price-tables/minhas',
    { preHandler: [authenticate, requireRole(['rep', 'manager', 'admin'])] },
    minhasPriceTablesHandler,
  );
}
