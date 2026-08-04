import type { FastifyRequest, FastifyReply } from 'fastify';
import {
  getOrders,
  getOrderById,
  createOrder,
  updateOrderStatus,
  setOrderInvoiced,
  deleteOrder,
} from './orders.service.js';
import type { OrigemPedido } from './orders.service.js';
import { tabelaDaLoja } from '../catalog/catalog.controller.js';
import { encerrarVitrinePorPedido } from '../access/showcase.service.js';
import { parseBody } from '../../lib/validation.js';
import { createOrderSchema, updateOrderStatusSchema, setInvoicedSchema } from './orders.schema.js';

export async function listOrders(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, sub: rep_id, role, customer_id } = request.user;
  const orders = await getOrders(company_id, role, rep_id, customer_id);
  await reply.send({ data: orders });
}

export async function getOrder(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, sub: rep_id, role, customer_id } = request.user;
  const { id } = request.params as { id: string };

  const order = await getOrderById(id, company_id, role, rep_id, customer_id);
  if (!order) {
    await reply.status(404).send({ error: 'Pedido não encontrado', code: 'NOT_FOUND', statusCode: 404 });
    return;
  }
  await reply.send({ data: order });
}

export async function createOrderHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, sub, role, price_table_id, customer_id, rep_id: dono } = request.user;
  const body = await parseBody(createOrderSchema, request.body, reply);
  if (!body) return;

  // Quem RECEBE o pedido. Loja e visitante têm o representante dono no token;
  // o representante recebe o próprio.
  const destinatario = role === 'store' || role === 'guest' ? (dono ?? sub) : sub;

  let origem: OrigemPedido = { source: 'rep', created_by: sub };
  let tabela = price_table_id ?? null;
  let corpo = body;

  // O preço de um cliente é o do CADASTRO dele, não o de quem digita o pedido.
  //
  // Até aqui o pedido do representante saía na tabela DELE enquanto o mesmo
  // cliente, comprando pelo login próprio, saía na tabela do cadastro — dois
  // preços para a mesma loja, dependendo de quem clicou. Agora os dois caminhos
  // usam `tabelaDaLoja()`, que cai para a tabela do rep quando o cliente não
  // tem uma (809 dos 1.353 estão nessa situação).
  if (role === 'rep' && body.customer_id) {
    tabela = (await tabelaDaLoja(body.customer_id, sub)) ?? tabela;
  }

  if (role === 'store') {
    if (!customer_id) {
      await reply.status(403).send({ error: 'Acesso sem loja vinculada', code: 'FORBIDDEN', statusCode: 403 });
      return;
    }
    // A loja não escolhe para quem compra: é sempre o cliente dela.
    corpo = { ...body, customer_id };
    origem = { source: 'store', created_by: sub };
    tabela = (await tabelaDaLoja(customer_id, dono ?? null)) ?? null;
  }

  if (role === 'guest') {
    const nome = body.guest_name?.trim();
    const zap = body.guest_whatsapp?.replace(/\D/g, '') ?? '';
    if (!nome || nome.length < 2) {
      await reply.status(400).send({ error: 'Informe o nome da loja', code: 'VALIDATION_ERROR', statusCode: 400 });
      return;
    }
    if (zap.length < 10 || zap.length > 11) {
      await reply.status(400).send({ error: 'Informe o WhatsApp com DDD', code: 'VALIDATION_ERROR', statusCode: 400 });
      return;
    }
    // Vitrine não tem cliente: mesmo que venha um customer_id no corpo, ele é
    // descartado — quem abriu o link não escolhe para quem está comprando.
    const semCliente = { ...body };
    delete semCliente.customer_id;
    corpo = semCliente;
    origem = {
      source: 'showcase',
      guest_name: nome,
      guest_whatsapp: body.guest_whatsapp ?? null,
      // Não há usuário do outro lado: fica o representante dono do link.
      created_by: dono ?? sub,
    };
  }

  try {
    const order = await createOrder(company_id, destinatario, tabela, corpo, origem);
    if (!order) {
      await reply.status(422).send({ error: 'Não foi possível criar o pedido', code: 'CREATE_FAILED', statusCode: 422 });
      return;
    }

    // O link da vitrine morre com o pedido que saiu dele. `sub` do token de
    // visitante É o id do link — foi o servidor que assinou. Só depois de o
    // pedido existir: falhar aqui não pode custar a compra, então o encerramento
    // não derruba a resposta.
    if (role === 'guest') {
      try {
        await encerrarVitrinePorPedido(sub);
      } catch (erro) {
        request.log.error({ err: erro, link: sub }, 'pedido criado, mas a vitrine seguiu aberta');
      }
    }

    await reply.status(201).send({ data: order });
  } catch (err) {
    if (err instanceof Error && err.message === 'ACESSO_INDISPONIVEL') {
      // Migração 014 pendente. O visitante não tem o que fazer com esse detalhe.
      request.log.error('Pedido de vitrine recusado: migração 014 não aplicada');
      await reply.status(503).send({
        error: 'Este recurso ainda não está disponível. Fale com o representante.',
        code: 'UNAVAILABLE',
        statusCode: 503,
      });
      return;
    }
    if (err instanceof Error && err.message === 'CUSTOMER_BLOCKED') {
      await reply.status(403).send({ error: 'Cliente bloqueado', code: 'CUSTOMER_BLOCKED', statusCode: 403 });
      return;
    }
    if (err instanceof Error && err.message === 'PRICE_NOT_FOUND') {
      await reply.status(422).send({
        error: 'Há itens sem preço na tabela do representante',
        code: 'PRICE_NOT_FOUND',
        statusCode: 422,
      });
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
  const body = await parseBody(setInvoicedSchema, request.body, reply);
  if (!body) return;

  const order = await setOrderInvoiced(id, company_id, body.invoiced);
  if (!order) {
    await reply.status(404).send({ error: 'Pedido não encontrado', code: 'NOT_FOUND', statusCode: 404 });
    return;
  }
  await reply.send({ data: order });
}

export async function updateStatusHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, sub: approverId, role } = request.user;
  const { id } = request.params as { id: string };
  const body = await parseBody(updateOrderStatusSchema, request.body, reply);
  if (!body) return;

  try {
    const order = await updateOrderStatus(id, company_id, approverId, { status: body.status, notes: body.notes ?? '' }, role);
    if (!order) {
      await reply.status(404).send({ error: 'Pedido não encontrado', code: 'NOT_FOUND', statusCode: 404 });
      return;
    }
    await reply.send({ data: order });
  } catch (err) {
    if (err instanceof Error && err.message === 'FORBIDDEN_NOT_OWNER') {
      await reply.status(403).send({ error: 'Você só pode alterar seus próprios pedidos', code: 'FORBIDDEN', statusCode: 403 });
      return;
    }
    if (err instanceof Error && err.message === 'FORBIDDEN_ROLE') {
      await reply.status(403).send({
        error: 'Apenas gerentes podem aprovar ou recusar pedidos',
        code: 'FORBIDDEN',
        statusCode: 403,
      });
      return;
    }
    if (err instanceof Error && err.message === 'INVALID_STATUS_TRANSITION') {
      await reply.status(422).send({ error: 'Transição de status inválida', code: 'INVALID_STATUS_TRANSITION', statusCode: 422 });
      return;
    }
    throw err;
  }
}
