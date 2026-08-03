import type { FastifyInstance } from 'fastify';
import { authenticate, requireRole } from '../../middleware/auth.js';
import {
  listRepsHandler,
  createRepHandler,
  updateRepHandler,
  deleteRepHandler,
  listPriceTablesHandler,
  minhasPriceTablesHandler,
} from './reps.controller.js';

export async function repsRouter(fastify: FastifyInstance): Promise<void> {
  const guard = { preHandler: [authenticate, requireRole(['manager', 'admin'])] };

  fastify.get('/reps', guard, listRepsHandler);
  fastify.post('/reps', guard, createRepHandler);
  fastify.patch('/reps/:id', guard, updateRepHandler);
  fastify.delete('/reps/:id', guard, deleteRepHandler);
  fastify.get('/price-tables', guard, listPriceTablesHandler);

  // As tabelas que QUEM PEDIU pode atribuir. O representante só recebe o
  // conjunto dele: com uma tabela só, ele não descobre que existem outras.
  // Gerente e admin recebem todas — são eles que atribuem.
  fastify.get(
    '/price-tables/minhas',
    { preHandler: [authenticate, requireRole(['rep', 'manager', 'admin'])] },
    minhasPriceTablesHandler,
  );
}
