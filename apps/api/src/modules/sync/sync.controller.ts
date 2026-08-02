import type { FastifyRequest, FastifyReply } from 'fastify';
import type { SyncRequest } from '@csb/shared';
import { processSyncQueue } from './sync.service.js';
import { tabelaDaLoja } from '../catalog/catalog.controller.js';

export async function syncHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, sub, role, price_table_id, customer_id, rep_id: dono } = request.user;
  const { orders } = request.body as SyncRequest;

  if (!Array.isArray(orders) || orders.length === 0) {
    await reply.status(400).send({
      error: 'orders deve ser um array não vazio',
      code: 'VALIDATION_ERROR',
      statusCode: 400,
    });
    return;
  }

  // A loja também compra offline, e o pedido dela não pode entrar como se fosse
  // do representante: quem RECEBE é o representante dono, o preço sai da tabela
  // do cliente (caindo para a do rep) e o cliente é sempre o dela — o que o
  // aparelho mandou não decide para quem a compra é.
  if (role === 'store') {
    if (!customer_id) {
      await reply.status(403).send({ error: 'Acesso sem loja vinculada', code: 'FORBIDDEN', statusCode: 403 });
      return;
    }
    const tabela = (await tabelaDaLoja(customer_id, dono ?? null)) ?? null;
    const resultado = await processSyncQueue(
      company_id,
      dono ?? sub,
      tabela,
      orders.map((o) => ({ ...o, customer_id })),
      { source: 'store', created_by: sub },
    );
    await reply.send({ data: resultado });
    return;
  }

  const result = await processSyncQueue(company_id, sub, price_table_id ?? null, orders);
  await reply.send({ data: result });
}
