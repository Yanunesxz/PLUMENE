/**
 * Tarefas do representante.
 *
 * Quem CRIA e EXCLUI é o escritório (gerente, admin, financeiro — a Bruna e o
 * Fabian). Quem dá OK e marca feita é o REPRESENTANTE dono da tarefa. A loja
 * não participa: tarefa é assunto interno da força de vendas.
 */
import type { FastifyInstance } from 'fastify';
import { authenticate, requireRole } from '../../middleware/auth.js';
import {
  listarTarefasHandler,
  criarTarefaHandler,
  mudarStatusHandler,
  excluirTarefaHandler,
} from './tarefas.controller.js';

export async function tarefasRouter(fastify: FastifyInstance): Promise<void> {
  const forcaDeVendas = { preHandler: [authenticate, requireRole(['rep', 'manager', 'admin', 'financeiro'])] };
  const escritorio = { preHandler: [authenticate, requireRole(['manager', 'admin', 'financeiro'])] };

  fastify.get('/tarefas', forcaDeVendas, listarTarefasHandler);
  fastify.post('/tarefas', escritorio, criarTarefaHandler);
  fastify.patch('/tarefas/:id', { preHandler: [authenticate, requireRole(['rep'])] }, mudarStatusHandler);
  fastify.delete('/tarefas/:id', escritorio, excluirTarefaHandler);
}
