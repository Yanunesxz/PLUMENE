import type { FastifyRequest, FastifyReply } from 'fastify';
import type { CreateRepRequest, UpdateRepRequest } from '@csb/shared';
import { listReps, createRep, updateRep, listPriceTables } from './reps.service.js';

export async function listRepsHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id } = request.user;
  const reps = await listReps(company_id);
  await reply.send({ data: reps });
}

export async function listPriceTablesHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { company_id } = request.user;
  const tables = await listPriceTables(company_id);
  await reply.send({ data: tables });
}

export async function createRepHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id } = request.user;
  const body = request.body as CreateRepRequest;

  if (!body?.name || !body?.email || !body?.password || !body?.cpf || !body?.price_table_id) {
    await reply.status(400).send({
      error: 'Campos obrigatórios: nome, e-mail, senha, CPF e tabela de preço.',
      code: 'VALIDATION_ERROR',
      statusCode: 400,
    });
    return;
  }

  const result = await createRep(company_id, body);
  if (!result.ok) {
    if (result.reason === 'email_taken') {
      await reply.status(409).send({
        error: 'Já existe um usuário com esse e-mail.',
        code: 'EMAIL_TAKEN',
        statusCode: 409,
      });
      return;
    }
    await reply.status(500).send({
      error: 'Não foi possível criar o representante.',
      code: 'CREATE_FAILED',
      statusCode: 500,
    });
    return;
  }

  await reply.status(201).send({ data: result.rep });
}

export async function updateRepHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id } = request.user;
  const { id } = request.params as { id: string };
  const body = request.body as UpdateRepRequest;

  const result = await updateRep(company_id, id, body);
  if (!result.ok) {
    if (result.reason === 'email_taken') {
      await reply.status(409).send({
        error: 'Já existe um usuário com esse e-mail.',
        code: 'EMAIL_TAKEN',
        statusCode: 409,
      });
      return;
    }
    if (result.reason === 'not_found') {
      await reply.status(404).send({
        error: 'Representante não encontrado.',
        code: 'NOT_FOUND',
        statusCode: 404,
      });
      return;
    }
    await reply.status(500).send({
      error: 'Não foi possível atualizar o representante.',
      code: 'UPDATE_FAILED',
      statusCode: 500,
    });
    return;
  }

  await reply.send({ data: result.rep });
}
