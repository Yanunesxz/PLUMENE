import type { FastifyRequest, FastifyReply } from 'fastify';
import {
  getOrders,
  getOrderById,
  createOrder,
  updateOrderStatus,
  setOrderInvoiced,
  setOrderDiscount,
  setOrderItems,
  setOrderPayment,
  setOrderNotes,
  ultimoNumeroErp,
  corrigirNumeroErp,
  deleteOrder,
  listDeletedOrders,
} from './orders.service.js';
import type { OrigemPedido } from './orders.service.js';
import { tabelaDaLoja } from '../catalog/catalog.controller.js';
import { getPedidoPublico } from './publicOrder.service.js';
import { tokenDoPedido } from './publicToken.js';
import { supabase } from '../../config/supabase.js';
import { env } from '../../config/env.js';
import { getCondicoesDePagamento } from './paymentConditions.service.js';
import { encerrarVitrinePorPedido } from '../access/showcase.service.js';
import {
  avisarTriagemDoRep,
  avisarMesaParaAceite,
  avisarDecisaoAoRep,
  avisarMesaDaRecusa,
  avisarFaturadoAoRep,
} from '../push/push.avisos.js';
import { parseBody } from '../../lib/validation.js';
import {
  createOrderSchema,
  updateOrderStatusSchema,
  setInvoicedSchema,
  setDiscountSchema,
  setOrderItemsSchema,
  setPaymentSchema,
  setNotesSchema,
  corrigirNumeroErpSchema,
} from './orders.schema.js';

/**
 * GET /payment-conditions — as condições de pagamento que rep e loja escolhem
 * no pedido. Lista vazia enquanto a migração 028 não rodar: o seletor some da
 * tela em vez de quebrar o pedido.
 */
export async function listPaymentConditions(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { company_id } = request.user;
  const condicoes = await getCondicoesDePagamento(company_id);
  await reply.send({ data: condicoes });
}

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
  // O link público (o mesmo do e-mail) vai junto: é ele que o representante
  // manda no WhatsApp quando o cliente pede. O token é assinado no servidor —
  // o app não tem como montá-lo sozinho.
  //
  // E quem vendeu vai resolvido (nome + código no Control): é o que o
  // financeiro confere antes de lançar no ERP. Consulta à parte, nunca um
  // embed — o rep_id tem três chaves para users e o PostgREST se perde.
  const { data: rep } = await supabase
    .from('users')
    .select('name, erp_rep_id')
    .eq('id', order.rep_id)
    .maybeSingle();

  await reply.send({
    data: {
      ...order,
      public_link: `${env.APP_PUBLIC_URL}/pedido/${tokenDoPedido(order.id)}`,
      rep_info: (rep as { name: string; erp_rep_id: string | null } | null) ?? null,
    },
  });
}

/** GET /public/pedido/:token — a página pública do pedido (link do e-mail). Sem login. */
export async function pedidoPublicoHandler(
  request: FastifyRequest<{ Params: { token: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const pedido = await getPedidoPublico(request.params.token);
  if (!pedido) {
    await reply.status(404).send({ error: 'Pedido não encontrado', code: 'NOT_FOUND', statusCode: 404 });
    return;
  }
  await reply.send({ data: pedido });
}

export async function createOrderHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, sub, role, price_table_id, customer_id, rep_id: dono } = request.user;
  const body = await parseBody(createOrderSchema, request.body, reply);
  if (!body) return;

  // O desconto é a palavra do REPRESENTANTE — só ele manda a %. Loja, vitrine
  // e até gerente têm o campo descartado aqui, antes de qualquer conta.
  if (role !== 'rep') {
    delete body.discount_percent;
    delete body.discount_value;
  }

  // Quem RECEBE o pedido. Loja e visitante têm o representante dono no token;
  // o representante recebe o próprio.
  const destinatario = role === 'store' || role === 'guest' ? (dono ?? sub) : sub;

  let origem: OrigemPedido = {
    source: 'rep',
    created_by: sub,
    venda_interna: request.user.venda_interna === true,
  };
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

  // O financeiro também monta pedido ("pode acrescentar os pedidos", Yan
  // 14/08/2026). Ele não tem tabela própria: o preço vem do cadastro do
  // cliente, sem cair para tabela de ninguém.
  if (role === 'financeiro' && body.customer_id) {
    tabela = (await tabelaDaLoja(body.customer_id, null)) ?? tabela;
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
    // Link amarrado a um cliente (035): o cadastro já diz quem é — nome e
    // WhatsApp digitados viram complemento, não obrigação.
    const clienteDoLink = customer_id ?? null;
    if (!clienteDoLink) {
      if (!nome || nome.length < 2) {
        await reply.status(400).send({ error: 'Informe o nome da loja', code: 'VALIDATION_ERROR', statusCode: 400 });
        return;
      }
      if (zap.length < 10 || zap.length > 11) {
        await reply.status(400).send({ error: 'Informe o WhatsApp com DDD', code: 'VALIDATION_ERROR', statusCode: 400 });
        return;
      }
    } else if (zap.length > 0 && (zap.length < 10 || zap.length > 11)) {
      await reply.status(400).send({ error: 'Informe o WhatsApp com DDD', code: 'VALIDATION_ERROR', statusCode: 400 });
      return;
    }
    // Quem abriu o link NÃO escolhe para quem está comprando: o cliente é o do
    // link (assinado no token) — ou nenhum, nos links antigos de visitante.
    const doLink = { ...body };
    delete doLink.customer_id;
    corpo = clienteDoLink ? { ...doLink, customer_id: clienteDoLink } : doLink;
    if (clienteDoLink) {
      // O preço é o do CADASTRO do cliente, como em todo caminho que tem cliente.
      tabela = (await tabelaDaLoja(clienteDoLink, dono ?? null)) ?? tabela;
    }
    origem = {
      source: 'showcase',
      guest_name: nome ?? null,
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

    // Pedido que chegou de FORA cai na triagem — o rep fica sabendo na hora.
    if (order.status === 'pending_rep') avisarTriagemDoRep(company_id, order);

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
  const { company_id, sub: rep_id, role, name } = request.user;
  const { id } = request.params as { id: string };

  const result = await deleteOrder(id, company_id, rep_id, role, name ?? '');
  if (!result.ok) {
    if (result.reason === 'forbidden') {
      await reply.status(403).send({ error: 'Você só pode excluir seus próprios pedidos', code: 'FORBIDDEN', statusCode: 403 });
      return;
    }
    if (result.reason === 'invoiced') {
      await reply.status(409).send({ error: 'Pedido faturado não pode ser excluído', code: 'ORDER_INVOICED', statusCode: 409 });
      return;
    }
    if (result.reason === 'sem_copia') {
      // A cópia para a aba "Excluídos" não gravou — o pedido fica onde está.
      await reply.status(500).send({
        error: 'Não deu para guardar a cópia do pedido; nada foi excluído. Tente de novo.',
        code: 'SEM_COPIA',
        statusCode: 500,
      });
      return;
    }
    await reply.status(404).send({ error: 'Pedido não encontrado', code: 'NOT_FOUND', statusCode: 404 });
    return;
  }
  await reply.send({ data: { ok: true } });
}

/** GET /orders/excluidos — a aba do admin (migração 040). */
export async function listDeletedOrdersHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const lista = await listDeletedOrders(request.user.company_id);
  if (lista === null) {
    await reply.status(500).send({ error: 'Não deu para ler os pedidos excluídos', code: 'DB_ERROR', statusCode: 500 });
    return;
  }
  await reply.send({ data: lista });
}

export async function setInvoicedHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, role, sub, venda_interna } = request.user;
  const { id } = request.params as { id: string };
  const body = await parseBody(setInvoicedSchema, request.body, reply);
  if (!body) return;

  // Representante comum não fatura — só o de VENDA INTERNA, e só o pedido
  // dele (o balcão fecha a própria venda; a dos colegas é da fábrica).
  if (role === 'rep' && venda_interna !== true) {
    await reply.status(403).send({
      error: 'Faturar é do financeiro e da fábrica — ou da venda interna, nos próprios pedidos.',
      code: 'PERMISSAO_NEGADA',
      statusCode: 403,
    });
    return;
  }

  const order = await setOrderInvoiced(id, company_id, body.invoiced, {
    somenteDoRep: role === 'rep' ? sub : null,
  });
  if (!order) {
    await reply.status(404).send({ error: 'Pedido não encontrado', code: 'NOT_FOUND', statusCode: 404 });
    return;
  }

  // A notícia que o rep mais espera — só no CARIMBO, nunca no desfazer.
  if (body.invoiced) avisarFaturadoAoRep(company_id, order, sub);

  await reply.send({ data: order });
}

export async function setDiscountHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, sub: rep_id, role } = request.user;
  const { id } = request.params as { id: string };
  const body = await parseBody(setDiscountSchema, request.body, reply);
  if (!body) return;

  const result = await setOrderDiscount(
    id,
    company_id,
    rep_id,
    role,
    { percent: body.desconto, valor: body.desconto_valor },
    request.user.venda_interna === true,
  );
  if (result.ok) {
    await reply.send({ data: result.order });
    return;
  }

  switch (result.reason) {
    case 'forbidden':
      await reply.status(403).send({
        error: 'Você só pode dar desconto nos seus próprios pedidos',
        code: 'FORBIDDEN',
        statusCode: 403,
      });
      return;
    case 'tarde_demais':
      await reply.status(409).send({
        error: 'Este pedido já saiu para a fábrica — o desconto vale só antes de mandar',
        code: 'ORDER_JA_ENVIADO',
        statusCode: 409,
      });
      return;
    case 'maior_que_o_pedido':
      await reply.status(422).send({
        error: 'O desconto é maior que o valor do pedido',
        code: 'DESCONTO_MAIOR_QUE_PEDIDO',
        statusCode: 422,
      });
      return;
    case 'sem_coluna':
      await reply.status(503).send({
        error: 'O desconto ainda não está disponível — falta aplicar a migração 029',
        code: 'DESCONTO_INDISPONIVEL',
        statusCode: 503,
      });
      return;
    default:
      await reply.status(404).send({ error: 'Pedido não encontrado', code: 'NOT_FOUND', statusCode: 404 });
  }
}

export async function setNotesHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, sub, role } = request.user;
  const { id } = request.params as { id: string };
  const body = await parseBody(setNotesSchema, request.body, reply);
  if (!body) return;

  const result = await setOrderNotes(id, company_id, sub, role, body.notes, request.user.venda_interna === true);
  if (result.ok) {
    await reply.send({ data: result.order });
    return;
  }

  switch (result.reason) {
    case 'forbidden':
      await reply.status(403).send({
        error: 'Você só pode alterar os seus próprios pedidos',
        code: 'FORBIDDEN',
        statusCode: 403,
      });
      return;
    case 'tarde_demais':
      await reply.status(409).send({
        error: 'Este pedido já saiu do seu alcance — a observação não pode mais mudar por aqui',
        code: 'ORDER_JA_ENVIADO',
        statusCode: 409,
      });
      return;
    default:
      await reply.status(404).send({ error: 'Pedido não encontrado', code: 'NOT_FOUND', statusCode: 404 });
  }
}

export async function setPaymentHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, sub, role } = request.user;
  const { id } = request.params as { id: string };
  const body = await parseBody(setPaymentSchema, request.body, reply);
  if (!body) return;

  const result = await setOrderPayment(id, company_id, sub, role, body.payment_condition_id, request.user.venda_interna === true);
  if (result.ok) {
    await reply.send({ data: result.order });
    return;
  }

  switch (result.reason) {
    case 'forbidden':
      await reply.status(403).send({
        error: 'Você só pode alterar os seus próprios pedidos',
        code: 'FORBIDDEN',
        statusCode: 403,
      });
      return;
    case 'tarde_demais':
      await reply.status(409).send({
        error: 'Este pedido já saiu do seu alcance — a condição não pode mais mudar por aqui',
        code: 'ORDER_JA_ENVIADO',
        statusCode: 409,
      });
      return;
    case 'condicao_invalida':
      await reply.status(422).send({
        error: 'Condição de pagamento inválida ou inativa',
        code: 'CONDICAO_INVALIDA',
        statusCode: 422,
      });
      return;
    case 'sem_coluna':
      await reply.status(503).send({
        error: 'Condições de pagamento ainda não estão disponíveis — falta a migração 028',
        code: 'CONDICAO_INDISPONIVEL',
        statusCode: 503,
      });
      return;
    default:
      await reply.status(404).send({ error: 'Pedido não encontrado', code: 'NOT_FOUND', statusCode: 404 });
  }
}

export async function setItemsHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, sub, role } = request.user;
  const { id } = request.params as { id: string };
  const body = await parseBody(setOrderItemsSchema, request.body, reply);
  if (!body) return;

  const result = await setOrderItems(id, company_id, sub, role, body.items, request.user.venda_interna === true);
  if (result.ok) {
    await reply.send({ data: result.order });
    return;
  }

  switch (result.reason) {
    case 'forbidden':
      await reply.status(403).send({
        error: 'Você só pode alterar as peças dos seus próprios pedidos',
        code: 'FORBIDDEN',
        statusCode: 403,
      });
      return;
    case 'tarde_demais':
      await reply.status(409).send({
        error: 'Este pedido já saiu do seu alcance — as peças não podem mais mudar por aqui',
        code: 'ORDER_JA_ENVIADO',
        statusCode: 409,
      });
      return;
    case 'price_not_found':
      await reply.status(422).send({
        error: 'Há peças sem preço na tabela deste pedido',
        code: 'PRICE_NOT_FOUND',
        statusCode: 422,
      });
      return;
    case 'save_failed':
      await reply.status(500).send({
        error: 'Não foi possível salvar as peças — tente de novo',
        code: 'SAVE_FAILED',
        statusCode: 500,
      });
      return;
    default:
      await reply.status(404).send({ error: 'Pedido não encontrado', code: 'NOT_FOUND', statusCode: 404 });
  }
}

/** A Larissa corrige o número do Control que digitou errado (antes da nota). */
export async function corrigirNumeroErpHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { company_id } = request.user;
  const { id } = request.params as { id: string };
  const body = await parseBody(corrigirNumeroErpSchema, request.body, reply);
  if (!body) return;

  const r = await corrigirNumeroErp(id, company_id, body.erp_order_id);
  if (r.ok) {
    await reply.send({ data: { erp_order_id: r.erp_order_id } });
    return;
  }
  const respostas = {
    formato: { status: 422, error: 'Número do Control inválido — são duas letras e a numeração, ex.: CS17379', code: 'ERP_NUMBER_INVALID' },
    em_uso: { status: 409, error: 'Este número do Control já está em outro pedido', code: 'ERP_NUMBER_IN_USE' },
    nao_lancado: { status: 409, error: 'Só dá para corrigir o número de um pedido já lançado no ERP', code: 'NAO_LANCADO' },
    ja_faturado: { status: 409, error: 'O pedido já foi faturado — o número agora é o da nota e não muda', code: 'JA_FATURADO' },
    not_found: { status: 404, error: 'Pedido não encontrado', code: 'NOT_FOUND' },
    erro: { status: 500, error: 'Não foi possível corrigir o número', code: 'UPDATE_FAILED' },
  } as const;
  const resp = respostas[r.motivo];
  await reply.status(resp.status).send({ error: resp.error, code: resp.code, statusCode: resp.status });
}

/** O último número do Control lançado — a tela sugere o próximo a partir dele. */
export async function ultimoNumeroErpHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id } = request.user;
  await reply.send({ data: { ultimo: await ultimoNumeroErp(company_id) } });
}

export async function updateStatusHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, sub: approverId, role } = request.user;
  const { id } = request.params as { id: string };
  const body = await parseBody(updateOrderStatusSchema, request.body, reply);
  if (!body) return;

  try {
    const order = await updateOrderStatus(
      id,
      company_id,
      approverId,
      { status: body.status, notes: body.notes ?? '', ...(body.erp_order_id ? { erp_order_id: body.erp_order_id } : {}) },
      role,
      request.user.venda_interna === true,
    );
    if (!order) {
      await reply.status(404).send({ error: 'Pedido não encontrado', code: 'NOT_FOUND', statusCode: 404 });
      return;
    }

    // Os avisos do fluxo: quem precisa saber, sabe na hora — sem e-mail.
    if (body.status === 'pending_approval') avisarMesaParaAceite(company_id, order, approverId);
    if (body.status === 'approved') avisarDecisaoAoRep(company_id, order, true, approverId);
    if (body.status === 'rejected') {
      avisarDecisaoAoRep(company_id, order, false, approverId);
      // O Fabian entra em contato com o rep — recusa precisa de conversa.
      avisarMesaDaRecusa(company_id, order, approverId);
    }

    await reply.send({ data: order });
  } catch (err) {
    if (err instanceof Error && err.message === 'FORBIDDEN_NOT_OWNER') {
      await reply.status(403).send({ error: 'Você só pode alterar seus próprios pedidos', code: 'FORBIDDEN', statusCode: 403 });
      return;
    }
    if (err instanceof Error && err.message === 'FORBIDDEN_ROLE') {
      await reply.status(403).send({
        error: 'Aprovar, recusar e lançar pedido no ERP é do financeiro',
        code: 'FORBIDDEN',
        statusCode: 403,
      });
      return;
    }
    if (err instanceof Error && err.message === 'ERP_NUMBER_REQUIRED') {
      await reply.status(422).send({
        error: 'Informe o número que o Control deu ao pedido (duas letras e a numeração, ex.: SX14627)',
        code: 'ERP_NUMBER_REQUIRED',
        statusCode: 422,
      });
      return;
    }
    if (err instanceof Error && err.message === 'ERP_NUMBER_IN_USE') {
      await reply.status(409).send({
        error: 'Este número do Control já está em outro pedido — confira no ERP',
        code: 'ERP_NUMBER_IN_USE',
        statusCode: 409,
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
