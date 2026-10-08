import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { parseBody } from '../../lib/validation.js';
import { avisarClienteTrocadoAoRep } from '../push/push.avisos.js';
import { nomeDoCliente, trocarClienteDoPedido } from './trocaDeCliente.service.js';

const trocarSchema = z.object({ customer_id: z.string().uuid() });

const RESPOSTAS = {
  not_found: { status: 404, error: 'Pedido não encontrado', code: 'NOT_FOUND' },
  cliente_nao_encontrado: { status: 404, error: 'Cliente não encontrado', code: 'CLIENTE_NAO_ENCONTRADO' },
  faturado: { status: 409, error: 'Pedido faturado não troca de cliente — a nota já saiu', code: 'PEDIDO_FATURADO' },
  cancelado: { status: 409, error: 'Pedido cancelado não troca de cliente', code: 'PEDIDO_CANCELADO' },
  ja_enviado: {
    status: 409,
    error: 'O pedido já foi para a fábrica — agora quem troca o cliente é o financeiro',
    code: 'JA_ENVIADO',
  },
  forbidden: { status: 403, error: 'Você não pode trocar o cliente deste pedido', code: 'FORBIDDEN' },
  erro: { status: 500, error: 'Não foi possível trocar o cliente — tente de novo', code: 'UPDATE_FAILED' },
} as const;

/** PATCH /orders/:id/cliente { customer_id } */
export async function trocarClienteHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, sub, role, erp_rep_id } = request.user;
  const { id } = request.params as { id: string };
  const body = await parseBody(trocarSchema, request.body, reply);
  if (!body) return;

  const r = await trocarClienteDoPedido(id, company_id, { id: sub, role, erp_rep_id: erp_rep_id ?? null }, body.customer_id);
  if (!r.ok) {
    const resp = RESPOSTAS[r.reason];
    await reply.status(resp.status).send({ error: resp.error, code: resp.code, statusCode: resp.status });
    return;
  }
  // Quem não é o dono trocou: o representante fica sabendo (o push é carona).
  if (r.mudou && r.order.rep_id !== sub) {
    const nome = await nomeDoCliente(body.customer_id);
    avisarClienteTrocadoAoRep(company_id, r.order, nome ?? 'outro cliente', sub);
  }
  await reply.send({
    data: r.order,
    meta: { tabela_diferente: r.tabela_diferente, ja_no_control: r.ja_no_control },
  });
}
