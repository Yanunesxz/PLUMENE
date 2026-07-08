import type { FastifyInstance } from 'fastify';
import { authenticate, requireRole } from '../../middleware/auth.js';
import {
  listRepsHandler,
  createRepHandler,
  updateRepHandler,
  deleteRepHandler,
  listPriceTablesHandler,
} from './reps.controller.js';

export async function repsRouter(fastify: FastifyInstance): Promise<void> {
  const guard = { preHandler: [authenticate, requireRole(['manager', 'admin'])] };

  fastify.get('/reps', guard, listRepsHandler);
  fastify.post('/reps', guard, createRepHandler);
  fastify.patch('/reps/:id', guard, updateRepHandler);
  fastify.delete('/reps/:id', guard, deleteRepHandler);
  fastify.get('/price-tables', guard, listPriceTablesHandler);
}
