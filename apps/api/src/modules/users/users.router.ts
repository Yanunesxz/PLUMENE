import type { FastifyInstance } from 'fastify';
import { authenticate, requireRole } from '../../middleware/auth.js';
import {
  listarUsuariosHandler,
  criarUsuarioHandler,
  atualizarUsuarioHandler,
  excluirUsuarioHandler,
} from './users.controller.js';

/**
 * Controle de logins — só admin, sem exceção e sem tecla.
 *
 * Não existe permissão de gerente que abra esta porta: quem pode criar logins
 * pode criar um admin, e aí a distinção entre os papéis deixa de significar
 * alguma coisa.
 *
 * A única exceção é a LISTA, e é de leitura: o visualizador (054) a abre para
 * saber quem tem acesso — "nao pode mudar logins e etc.." (Yan, 15/10/2026).
 * Criar, editar, bloquear e excluir seguem só com o admin. Nenhum hash de
 * senha viaja na lista (`UsuarioListItem`).
 */
export async function usersRouter(fastify: FastifyInstance): Promise<void> {
  const soAdmin = { preHandler: [authenticate, requireRole(['admin'])] };

  fastify.get(
    '/usuarios',
    { preHandler: [authenticate, requireRole(['admin', 'visualizador'])] },
    listarUsuariosHandler,
  );
  fastify.post('/usuarios', soAdmin, criarUsuarioHandler);
  fastify.patch('/usuarios/:id', soAdmin, atualizarUsuarioHandler);
  fastify.delete('/usuarios/:id', soAdmin, excluirUsuarioHandler);
}
