import type { FastifyRequest, FastifyReply } from 'fastify';
import type { CreateRepRequest, UpdateRepRequest } from '@csb/shared';
import {
  listReps,
  createRep,
  updateRep,
  deleteRep,
  listPriceTables,
  listRepPriceTables,
} from './reps.service.js';
import { listarMetas, metaVigente, metasDisponiveis, salvarMeta } from './bonus.service.js';

/**
 * Mais de uma tabela só é possível com a migração 018 aplicada. Sem ela, o rep
 * fica com a tabela única — e o gerente precisa saber disso, senão sai da tela
 * achando que atribuiu duas.
 */
const AVISO_MIGRACAO =
  'Salvo, mas só com UMA tabela: o recurso de múltiplas tabelas ainda não foi liberado no banco (migração 018).';

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

/**
 * Tabelas que quem pediu pode atribuir. Gerente/admin recebem todas; o
 * representante recebe só o conjunto dele — é isso que impede o João de
 * descobrir que a tabela da Maria existe.
 */
export async function minhasPriceTablesHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { company_id, sub, role } = request.user;
  const tables =
    role === 'manager' || role === 'admin'
      ? await listPriceTables(company_id)
      : await listRepPriceTables(company_id, sub);
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

  await reply.status(201).send({
    data: result.rep,
    ...(result.conjunto_ignorado ? { aviso: AVISO_MIGRACAO } : {}),
  });
}

export async function deleteRepHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id } = request.user;
  const { id } = request.params as { id: string };

  const result = await deleteRep(company_id, id);
  if (!result.ok) {
    if (result.reason === 'not_found') {
      await reply.status(404).send({
        error: 'Representante não encontrado.',
        code: 'NOT_FOUND',
        statusCode: 404,
      });
      return;
    }
    if (result.reason === 'has_orders') {
      await reply.status(409).send({
        error: `Este representante tem ${result.orders} pedido(s) e não pode ser excluído — o histórico de vendas e comissões depende dele. Inative o acesso em vez de excluir.`,
        code: 'HAS_ORDERS',
        statusCode: 409,
      });
      return;
    }
    await reply.status(500).send({
      error: 'Não foi possível excluir o representante.',
      code: 'DELETE_FAILED',
      statusCode: 500,
    });
    return;
  }

  await reply.send({ data: { ok: true, unassigned_customers: result.unassigned_customers } });
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

  await reply.send({
    data: result.rep,
    ...(result.conjunto_ignorado ? { aviso: AVISO_MIGRACAO } : {}),
  });
}

// ─── Meta de bonificação ─────────────────────────────────────────────────────

/** Histórico de metas de um representante. Só gerente e admin chegam aqui. */
export async function listarMetasHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { company_id } = request.user;
  const { id } = request.params as { id: string };
  const metas = await listarMetas(company_id, id);
  await reply.send({ data: { metas, disponivel: await metasDisponiveis() } });
}

/** Grava as faixas de um mês para um representante. */
export async function salvarMetaHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { company_id } = request.user;
  const { id } = request.params as { id: string };
  const { competencia, faixas } =
    (request.body as { competencia?: string; faixas?: { meta: number; bonus: number }[] }) ?? {};
  if (!competencia || !/^\d{4}-\d{2}/.test(competencia)) {
    await reply.status(400).send({ error: 'Informe a competência no formato AAAA-MM.' });
    return;
  }
  const salvo = await salvarMeta(company_id, id, competencia, faixas ?? []);
  await reply.send({
    data: salvo.faixas,
    ...(salvo.disponivel
      ? {}
      : { warning: 'A meta não foi gravada: a migração 021 ainda não foi aplicada no banco.' }),
  });
}

/**
 * As faixas do próprio representante no mês corrente.
 *
 * O rep pede as DELE e só as dele — o `sub` do token manda, não um id na URL.
 */
export async function minhaMetaHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { company_id, sub } = request.user;
  await reply.send({ data: await metaVigente(company_id, sub) });
}
