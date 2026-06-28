import type { FastifyRequest, FastifyReply } from 'fastify';
import type { CreateOrderRequest, UpdateOrderStatusRequest } from '@csb/shared';
import {
  getOrders,
  getOrderById,
  createOrder,
  updateOrderStatus,
  setOrderInvoiced,
  deleteOrder,
} from './orders.service.js';

export async function listOrders(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, sub: rep_id, role } = request.user;
  const orders = await getOrders(company_id, role, rep_id);
  await reply.send({ data: orders });
}

export async function getOrder(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id } = request.user;
  const { id } = request.params as { id: string };

  const order = await getOrderById(id, company_id);
  if (!order) {
    await reply.status(404).send({ error: 'Pedido não encontrado', code: 'NOT_FOUND', statusCode: 404 });
    return;
  }
  await reply.send({ data: order });
}

export async function createOrderHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, sub: rep_id } = request.user;
  const body = request.body as CreateOrderRequest;

  try {
    const order = await createOrder(company_id, rep_id, body);
    if (!order) {
      await reply.status(422).send({ error: 'Não foi possível criar o pedido', code: 'CREATE_FAILED', statusCode: 422 });
      return;
    }
    await reply.status(201).send({ data: order });
  } catch (err) {
    if (err instanceof Error && err.message === 'CUSTOMER_BLOCKED') {
      await reply.status(403).send({ error: 'Cliente bloqueado', code: 'CUSTOMER_BLOCKED', statusCode: 403 });
      return;
    }
    throw err;
  }
}

export async function deleteOrderHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, sub: rep_id, role } = request.user;
  const { id } = request.params as { id: string };

  const result = await deleteOrder(id, company_id, rep_id, role);
  if (!result.ok) {
    if (result.reason === 'forbidden') {
      await reply.status(403).send({ error: 'Você só pode excluir seus próprios pedidos', code: 'FORBIDDEN', statusCode: 403 });
      return;
    }
    if (result.reason === 'invoiced') {
      await reply.status(409).send({ error: 'Pedido faturado não pode ser excluído', code: 'ORDER_INVOICED', statusCode: 409 });
      return;
    }
    await reply.status(404).send({ error: 'Pedido não encontrado', code: 'NOT_FOUND', statusCode: 404 });
    return;
  }
  await reply.send({ data: { ok: true } });
}

export async function setInvoicedHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id } = request.user;
  const { id } = request.params as { id: string };
  const { invoiced } = request.body as { invoiced: boolean };

  const order = await setOrderInvoiced(id, company_id, !!invoiced);
  if (!order) {
    await reply.status(404).send({ error: 'Pedido não encontrado', code: 'NOT_FOUND', statusCode: 404 });
    return;
  }
  await reply.send({ data: order });
}

export async function updateStatusHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, sub: approverId, role } = request.user;
  const { id } = request.params as { id: string };
  const body = request.body as UpdateOrderStatusRequest;

  if ((body.status === 'approved' || body.status === 'rejected') && role === 'rep') {
    await reply.status(403).send({ error: 'Apenas gerentes podem aprovar ou recusar pedidos', code: 'FORBIDDEN', statusCode: 403 });
    return;
  }

  try {
    const order = await updateOrderStatus(id, company_id, approverId, body);
    if (!order) {
      await reply.status(404).send({ error: 'Pedido não encontrado', code: 'NOT_FOUND', statusCode: 404 });
      return;
    }
    await reply.send({ data: order });
  } catch (err) {
    if (err instanceof Error && err.message === 'INVALID_STATUS_TRANSITION') {
      await reply.status(422).send({ error: 'Transição de status inválida', code: 'INVALID_STATUS_TRANSITION', statusCode: 422 });
      return;
    }
    throw err;
  }
}
