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
  // O financeiro entra nas LEITURAS: ele visualiza o cadastro dos
  // representantes (e precisa dos nomes na tela de pedidos), mas não cria,
  // não edita e não apaga — as escritas ficam com o `podeGerenciar` abaixo.
  // O visualizador (054, 15/10/2026) entra pelo mesmo motivo, e com menos
  // ainda: "ve tudo tudo mas nao altera nada". Só rotas GET usam este `guard`.
  const guard = {
    preHandler: [authenticate, requireRole(['manager', 'admin', 'financeiro', 'visualizador'])],
  };

  // Escrever no cadastro de representante (e na meta dele) exige a tecla. LER
  // não exige, e isso é deliberado: outras telas consomem `GET /reps` e
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
  // O visualizador entra para não tomar 403 numa tela que ele pode abrir — a
  // resposta dele vem vazia, porque ele não tem meta (não vende).
  fastify.get(
    '/minha-meta',
    {
      preHandler: [
        authenticate,
        requireRole(['rep', 'manager', 'admin', 'financeiro', 'visualizador']),
      ],
    },
    minhaMetaHandler,
  );

  // As tabelas que QUEM PEDIU pode atribuir. O representante só recebe o
  // conjunto dele: com uma tabela só, ele não descobre que existem outras.
  // Gerente, admin e visualizador recebem todas — os dois primeiros porque
  // atribuem, o visualizador porque é o seletor de tabela do catálogo dele.
  fastify.get(
    '/price-tables/minhas',
    {
      preHandler: [
        authenticate,
        requireRole(['rep', 'manager', 'admin', 'financeiro', 'visualizador']),
      ],
    },
    minhasPriceTablesHandler,
  );
}
