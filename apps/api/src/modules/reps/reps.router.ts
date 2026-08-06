import type { FastifyInstance } from 'fastify';
import { authenticate, requireRole, requirePermission } from '../../middleware/auth.js';
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

  // Escrever no cadastro de representante (e na meta dele) exige a tecla. LER
  // não exige, e isso é deliberado: a tela de Comissões consome `GET /reps` e
  // `GET /price-tables`, e guardá-las quebraria uma tela que funciona.
  const podeGerenciar = {
    preHandler: [
      authenticate,
      requireRole(['manager', 'admin']),
      requirePermission('gerenciar_representantes'),
    ],
  };

  fastify.get('/reps', guard, listRepsHandler);
  fastify.post('/reps', podeGerenciar, createRepHandler);
  fastify.patch('/reps/:id', podeGerenciar, updateRepHandler);
  fastify.delete('/reps/:id', podeGerenciar, deleteRepHandler);
  fastify.get('/price-tables', guard, listPriceTablesHandler);

  // Meta de bonificação: quem cadastra é o gerente, por representante e por mês.
  fastify.get('/reps/:id/meta', guard, listarMetasHandler);
  fastify.put('/reps/:id/meta', podeGerenciar, salvarMetaHandler);

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
