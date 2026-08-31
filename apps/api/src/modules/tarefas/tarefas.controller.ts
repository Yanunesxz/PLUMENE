import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { parseBody } from '../../lib/validation.js';
import {
  listarTarefas,
  criarTarefa,
  mudarStatusDaTarefa,
  excluirTarefa,
} from './tarefas.service.js';

const criarSchema = z.object({
  /** Ausente com customer_id presente = o dono da carteira do cliente. */
  rep_id: z.string().uuid().optional(),
  customer_id: z.string().uuid().optional(),
  titulo: z.string().trim().min(3).max(200),
  prazo: z.string().datetime({ offset: true }).optional(),
});

const statusSchema = z.object({
  status: z.enum(['confirmada', 'feita']),
});

export async function listarTarefasHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, sub, role } = request.user;
  const tarefas = await listarTarefas(company_id, {
    rep_id: role === 'rep' ? sub : null,
  });
  await reply.send({ data: tarefas });
}

export async function criarTarefaHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, sub } = request.user;
  const body = await parseBody(criarSchema, request.body, reply);
  if (!body) return;

  const r = await criarTarefa(company_id, sub, body);
  if (r.ok) {
    await reply.status(201).send({ data: r.tarefa });
    return;
  }
  if (r.reason === 'sem_migracao') {
    await reply.status(503).send({
      error: 'Tarefas ainda não estão disponíveis — falta aplicar a migração 037',
      code: 'TAREFAS_INDISPONIVEL',
      statusCode: 503,
    });
    return;
  }
  if (r.reason === 'rep_invalido') {
    await reply.status(422).send({
      error: 'Informe o representante — ou um cliente que tenha representante na carteira',
      code: 'REP_INVALIDO',
      statusCode: 422,
    });
    return;
  }
  await reply.status(500).send({ error: 'Não foi possível criar a tarefa', code: 'FALHA', statusCode: 500 });
}

export async function mudarStatusHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, sub } = request.user;
  const { id } = request.params as { id: string };
  const body = await parseBody(statusSchema, request.body, reply);
  if (!body) return;

  const r = await mudarStatusDaTarefa(id, company_id, sub, body.status);
  if (r.ok) {
    await reply.send({ data: { ok: true } });
    return;
  }
  if (r.reason === 'forbidden') {
    await reply.status(403).send({ error: 'Esta tarefa não é sua', code: 'FORBIDDEN', statusCode: 403 });
    return;
  }
  await reply.status(404).send({ error: 'Tarefa não encontrada', code: 'NOT_FOUND', statusCode: 404 });
}

export async function excluirTarefaHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, sub, role } = request.user;
  const { id } = request.params as { id: string };
  const r = await excluirTarefa(id, company_id, sub, role === 'admin' || role === 'manager');
  if (r.ok) {
    await reply.send({ data: { ok: true } });
    return;
  }
  if (r.reason === 'forbidden') {
    await reply.status(403).send({
      error: 'Só quem criou a tarefa (ou a gerência) pode excluí-la',
      code: 'FORBIDDEN',
      statusCode: 403,
    });
    return;
  }
  await reply.status(404).send({ error: 'Tarefa não encontrada', code: 'NOT_FOUND', statusCode: 404 });
}
