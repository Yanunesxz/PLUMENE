import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { parseBody } from '../../lib/validation.js';
import { avisarCancelamentoAoRep } from '../push/push.avisos.js';
import { cancelarPedido, criarMotivo, editarMotivo, listarMotivos } from './cancelamento.service.js';

/**
 * Rotas do cancelamento com motivo (migração 053). A regra de QUEM cancela mora
 * em `podeCancelarPedido` (shared) — a mesma que esconde o botão na tela.
 */

const cancelarSchema = z.object({
  reason_id: z.string().uuid(),
  note: z.string().trim().max(1000).optional(),
});

const novoMotivoSchema = z.object({ label: z.string().trim().min(2).max(120) });
const editarMotivoSchema = z
  .object({ label: z.string().trim().min(2).max(120).optional(), active: z.boolean().optional() })
  .refine((b) => b.label !== undefined || b.active !== undefined, { message: 'Nada para mudar' });

const SEM_MIGRACAO = {
  error: 'O cancelamento com motivo precisa da migração 053',
  code: 'CANCELAMENTO_INDISPONIVEL',
  statusCode: 503,
};

/** PATCH /orders/:id/cancelar { reason_id, note? } */
export async function cancelarPedidoHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, sub, role, venda_interna } = request.user;
  const { id } = request.params as { id: string };
  const body = await parseBody(cancelarSchema, request.body, reply);
  if (!body) return;

  const r = await cancelarPedido(id, company_id, sub, role, venda_interna === true, body);
  if (r.ok) {
    // Só o motivo de um pedido que já estava cancelado: o rep não é avisado de novo.
    if (!r.soOMotivo) avisarCancelamentoAoRep(company_id, r.order, r.order.cancel_reason_label ?? 'sem motivo', sub);
    await reply.send({ data: r.order });
    return;
  }
  switch (r.reason) {
    case 'not_found':
      await reply.status(404).send({ error: 'Pedido não encontrado', code: 'NOT_FOUND', statusCode: 404 });
      return;
    case 'sem_migracao':
      await reply.status(503).send(SEM_MIGRACAO);
      return;
    case 'motivo_invalido':
      await reply.status(422).send({ error: 'Escolha um dos motivos da lista', code: 'MOTIVO_INVALIDO', statusCode: 422 });
      return;
    case 'faturado':
      await reply.status(409).send({
        error: 'Pedido faturado não se cancela — desmarque o faturado antes',
        code: 'PEDIDO_FATURADO',
        statusCode: 409,
      });
      return;
    case 'ja_cancelado':
      await reply.status(409).send({ error: 'Este pedido já está cancelado', code: 'JA_CANCELADO', statusCode: 409 });
      return;
    case 'com_o_financeiro':
      await reply.status(409).send({
        error: 'Este pedido já chegou ao financeiro — quem cancela agora é o financeiro',
        code: 'COM_O_FINANCEIRO',
        statusCode: 409,
      });
      return;
    case 'forbidden':
      await reply.status(403).send({ error: 'Você não pode cancelar este pedido', code: 'FORBIDDEN', statusCode: 403 });
      return;
    default:
      await reply.status(500).send({ error: 'Não foi possível cancelar — tente de novo', code: 'UPDATE_FAILED', statusCode: 500 });
  }
}

/** GET /orders/motivos-de-cancelamento?todos=1 (todos = inclui os desativados, para o admin) */
export async function listarMotivosHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, role } = request.user;
  const { todos } = request.query as { todos?: string };
  const motivos = await listarMotivos(company_id, role === 'admin' && todos === '1');
  if (!motivos) {
    await reply.status(503).send(SEM_MIGRACAO);
    return;
  }
  await reply.send({ data: motivos });
}

async function responderMotivo(
  reply: FastifyReply,
  r: Awaited<ReturnType<typeof criarMotivo>>,
): Promise<void> {
  if (r.ok) {
    await reply.send({ data: r.motivo });
    return;
  }
  if (r.motivo === 'sem_migracao') await reply.status(503).send(SEM_MIGRACAO);
  else if (r.motivo === 'repetido')
    await reply.status(409).send({ error: 'Já existe um motivo com esse texto', code: 'MOTIVO_REPETIDO', statusCode: 409 });
  else if (r.motivo === 'nao_encontrado')
    await reply.status(404).send({ error: 'Motivo não encontrado', code: 'NOT_FOUND', statusCode: 404 });
  else await reply.status(500).send({ error: 'Não foi possível salvar o motivo', code: 'UPDATE_FAILED', statusCode: 500 });
}

/** POST /orders/motivos-de-cancelamento { label } — só admin. */
export async function criarMotivoHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = await parseBody(novoMotivoSchema, request.body, reply);
  if (!body) return;
  await responderMotivo(reply, await criarMotivo(request.user.company_id, body.label));
}

/** PATCH /orders/motivos-de-cancelamento/:id { label?, active? } — só admin. */
export async function editarMotivoHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id } = request.params as { id: string };
  const body = await parseBody(editarMotivoSchema, request.body, reply);
  if (!body) return;
  await responderMotivo(reply, await editarMotivo(request.user.company_id, id, body));
}
