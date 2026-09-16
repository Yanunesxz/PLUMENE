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
  solicitarLancamentoNoErp,
  deleteOrder,
  listDeletedOrders,
} from './orders.service.js';
import type { OrigemPedido } from './orders.service.js';
import { pedirAtualizacao, confirmarAtualizacao } from './erpSync.service.js';
import { lerCanais } from '../../lib/canais.js';
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
  avisarPedidoMudouNoErp,
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
  erpSyncSchema,
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

  // Os canais da empresa (048) vão junto: é por eles que a tela sabe se
  // "Lançar" pede o número (manual) ou solicita ao Control (api), e se o botão
  // de faturado existe. Lembrado por 30 s no `lerCanais` — a tela que fica
  // consultando o pedido a cada 3 s não custa uma leitura de empresa por vez.
  // Sem resposta do banco, `null`: a tela se comporta como hoje (manual).
  let canais: { pedido_erp: string; faturamento: string } | null = null;
  try {
    const lidos = await lerCanais(company_id);
    canais = { pedido_erp: lidos.pedido_erp, faturamento: lidos.faturamento };
  } catch (e) {
    request.log.error({ err: e }, 'pedido lido, mas o banco não respondeu sobre os canais da empresa');
  }

  await reply.send({
    data: {
      ...order,
      public_link: `${env.APP_PUBLIC_URL}/pedido/${tokenDoPedido(order.id)}`,
      rep_info: (rep as { name: string; erp_rep_id: string | null } | null) ?? null,
      canais,
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
    if (result.reason === 'tem_numero_erp') {
      await reply.status(409).send({
        error: 'Este pedido já está no Control e não pode ser excluído. Peça a correção ao financeiro.',
        code: 'ORDER_HAS_ERP_NUMBER',
        statusCode: 409,
      });
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
  const { company_id, role, sub, venda_interna, name } = request.user;
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

  const r = await setOrderInvoiced(id, company_id, body.invoiced, {
    somenteDoRep: role === 'rep' ? sub : null,
    por: sub,
    por_nome: name ?? null,
  });
  if (!r.ok) {
    if (r.reason === 'faturamento_pelo_control') {
      await reply.status(409).send({
        error: 'O faturamento deste pedido vem do Control pela integração — o botão manual está desligado nesta empresa.',
        code: 'FATURAMENTO_PELO_CONTROL',
        statusCode: 409,
      });
      return;
    }
    // O banco não disse se o faturamento desta empresa vem do Control. Nada
    // foi gravado, e a mensagem diz isso — 500 sem código deixaria a dúvida.
    if (r.reason === 'canal_indisponivel') {
      await reply.status(503).send({
        error: 'Não deu para conferir o canal desta empresa. Nada foi alterado — tente de novo em instantes.',
        code: 'CANAL_INDISPONIVEL',
        statusCode: 503,
      });
      return;
    }
    if (r.reason === 'erro') {
      await reply.status(500).send({
        error: 'Não foi possível gravar o faturamento — tente de novo',
        code: 'UPDATE_FAILED',
        statusCode: 500,
      });
      return;
    }
    await reply.status(404).send({ error: 'Pedido não encontrado', code: 'NOT_FOUND', statusCode: 404 });
    return;
  }

  // A notícia que o rep mais espera — só no CARIMBO de verdade: nunca no
  // desfazer, e nunca no recarimbo de um pedido que já estava faturado.
  if (body.invoiced && r.mudou) avisarFaturadoAoRep(company_id, r.order, sub);

  await reply.send({ data: r.order });
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
    case 'sem_foto_do_erp':
      await reply.status(503).send({
        error: 'Não deu para guardar a versão que o Control conhece deste pedido. Nada foi alterado — tente de novo em instantes.',
        code: 'FOTO_DO_ERP_FALHOU',
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
    case 'sem_foto_do_erp':
      await reply.status(503).send({
        error: 'Não deu para guardar a versão que o Control conhece deste pedido. Nada foi alterado — tente de novo em instantes.',
        code: 'FOTO_DO_ERP_FALHOU',
        statusCode: 503,
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
    case 'sem_foto_do_erp':
      await reply.status(503).send({
        error: 'Não deu para guardar a versão que o Control conhece deste pedido. Nada foi alterado — tente de novo em instantes.',
        code: 'FOTO_DO_ERP_FALHOU',
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
    case 'sem_foto_do_erp':
      await reply.status(503).send({
        error: 'Não deu para guardar a versão que o Control conhece deste pedido. Nada foi alterado — tente de novo em instantes.',
        code: 'FOTO_DO_ERP_FALHOU',
        statusCode: 503,
      });
      return;
    case 'original_nao_guardado':
      await reply.status(503).send({
        error: 'Não deu para guardar a cópia do pedido original antes de mexer nas peças. Nada foi alterado — tente de novo em instantes.',
        code: 'ORIGINAL_NAO_GUARDADO',
        statusCode: 503,
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
  const { company_id, sub, name } = request.user;
  const { id } = request.params as { id: string };
  const body = await parseBody(corrigirNumeroErpSchema, request.body, reply);
  if (!body) return;

  const r = await corrigirNumeroErp(id, company_id, body.erp_order_id, { id: sub, nome: name ?? null });
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

/**
 * PATCH /orders/:id/solicitar-erp — "Lançar no Control" com o canal na API (049).
 *
 * Não muda status e não recebe número: só marca o pedido como solicitado e o
 * põe na fila que o Control puxa. A tela fica consultando GET /orders/:id
 * até `erp_order_id` chegar pela confirmação do Control.
 */
export async function solicitarErpHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, sub, name } = request.user;
  const { id } = request.params as { id: string };

  const r = await solicitarLancamentoNoErp(id, company_id, { id: sub, nome: name ?? null });
  if (r.ok) {
    await reply.send({ data: { solicitado_em: r.solicitado_em, ja_solicitado: r.ja_solicitado } });
    return;
  }
  const respostas = {
    not_found: { status: 404, code: 'NOT_FOUND', error: 'Pedido não encontrado' },
    nao_aprovado: {
      status: 409,
      code: 'ORDER_NOT_APPROVED',
      error: 'Só pedido aprovado vai para o Control — este ainda não foi aceito (ou já saiu da mesa)',
    },
    ja_faturado: {
      status: 409,
      code: 'JA_FATURADO',
      error: 'O pedido já foi faturado — não há o que lançar no Control',
    },
    ja_lancado: {
      status: 409,
      code: 'ORDER_HAS_ERP_NUMBER',
      error: 'Este pedido já tem número no Control',
    },
    canal_manual: {
      status: 409,
      code: 'CANAL_MANUAL',
      error: 'Nesta empresa o lançamento é manual: lance com o número que o Control deu ao pedido',
    },
    canal_indisponivel: {
      status: 503,
      code: 'CANAL_INDISPONIVEL',
      error: 'Não deu para conferir o canal desta empresa. Nada foi alterado — tente de novo em instantes.',
    },
    sem_migracao: {
      status: 503,
      code: 'MIGRACAO_PENDENTE',
      error: 'A migração 049 ainda não rodou neste banco — solicitar ao Control ainda não funciona aqui',
    },
    erro: { status: 500, code: 'UPDATE_FAILED', error: 'Não foi possível solicitar o lançamento — tente de novo' },
  } as const;
  const resp = respostas[r.reason];
  await reply.status(resp.status).send({
    error: resp.error,
    code: resp.code,
    statusCode: resp.status,
    ...(r.reason === 'ja_lancado' && r.erp_order_id ? { erp_order_id: r.erp_order_id } : {}),
  });
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
      request.user.name ?? null,
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
    // O banco não respondeu sobre o canal desta empresa: nada foi lançado, e o
    // 503 diz isso. Sem este ramo a exceção virava 500 sem código e o diálogo
    // do lançamento deixava a dúvida de o número ter sido gravado ou não.
    if (err instanceof Error && err.message === 'CANAL_INDISPONIVEL') {
      await reply.status(503).send({
        error: 'Não deu para conferir o canal desta empresa. Nada foi alterado — tente de novo em instantes.',
        code: 'CANAL_INDISPONIVEL',
        statusCode: 503,
      });
      return;
    }
    if (err instanceof Error && err.message === 'CANAL_API') {
      await reply.status(409).send({
        error: 'Lançar no ERP pela tela está desligado nesta empresa: o número agora vem do Control pela API.',
        code: 'CANAL_API',
        statusCode: 409,
      });
      return;
    }
    // Canal na API e ninguém digitou número: o caminho é SOLICITAR ao Control
    // (PATCH /orders/:id/solicitar-erp), que não muda o status. É a tela
    // antiga, ainda em cache no aparelho, chegando na empresa já virada.
    if (err instanceof Error && err.message === 'LANCAMENTO_PELO_CONTROL') {
      await reply.status(409).send({
        error: 'Nesta empresa o pedido é solicitado ao Control — use "Lançar no Control", sem digitar número. Atualize o app se o botão não aparecer.',
        code: 'LANCAMENTO_PELO_CONTROL',
        statusCode: 409,
      });
      return;
    }
    if (err instanceof Error && err.message === 'ERP_NUMBER_REQUIRED') {
      await reply.status(422).send({
        error: 'Informe o número que o Control deu ao pedido (duas letras e a numeração, ex.: CS17379)',
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

/**
 * PATCH /orders/:id/erp-sync — o botão "Atualizar no ERP" (046).
 *
 * Duas ações na mesma rota porque são os dois lados da mesma conversa:
 *
 *   pedir     → quem editou um pedido já lançado avisa que o Control está com
 *               a versão velha. Chega como push na mesa de quem mexe no Control,
 *               e a resposta diz em quantos aparelhos o aviso chegou.
 *   confirmar → quem mexeu no Control diz que já atualizou lá. A fotografia é
 *               tirada de novo e a divergência some sozinha — desde que o
 *               pedido não tenha mudado outra vez enquanto isso.
 *
 * Quem PEDE é quem pode ter mudado o pedido depois do lançamento: a venda
 * interna DONA dele (o portão de edição só a deixa passar do sent_erp), ou o
 * escritório. Representante comum não mexe em pedido lançado, então não tem o
 * que pedir. Quem CONFIRMA é só quem mexe no Control — financeiro e admin.
 */
export async function erpSyncHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, sub, role, venda_interna } = request.user;
  const { id } = request.params as { id: string };
  const body = await parseBody(erpSyncSchema, request.body, reply);
  if (!body) return;

  const doEscritorio = role === 'financeiro' || role === 'admin';

  if (body.acao === 'confirmar' && !doEscritorio) {
    await reply.status(403).send({
      error: 'Só quem lança no Control confirma que atualizou lá',
      code: 'FORBIDDEN_ROLE',
      statusCode: 403,
    });
    return;
  }

  if (body.acao === 'pedir' && !doEscritorio) {
    if (venda_interna !== true) {
      await reply.status(403).send({
        error: 'Pedido lançado no Control só muda pela venda interna ou pelo escritório',
        code: 'FORBIDDEN_ROLE',
        statusCode: 403,
      });
      return;
    }
    const { data: dono } = await supabase
      .from('orders')
      .select('rep_id')
      .eq('id', id)
      .eq('company_id', company_id)
      .maybeSingle();
    if (!dono || (dono as { rep_id: string }).rep_id !== sub) {
      await reply.status(403).send({ error: 'Este pedido não é seu', code: 'FORBIDDEN', statusCode: 403 });
      return;
    }
  }

  const r =
    body.acao === 'pedir'
      ? await pedirAtualizacao(id, company_id, sub, body.observacao ?? null)
      : await confirmarAtualizacao(id, company_id, sub, body.assinatura ?? null);

  if (!r.ok) {
    const respostas = {
      sem_tabela: {
        status: 503,
        error: 'A migração 046 ainda não rodou neste banco — o aviso de "atualizar no Control" ainda não funciona aqui',
        code: 'MIGRACAO_PENDENTE',
      },
      nao_lancado: {
        status: 409,
        error: 'Este pedido ainda não foi lançado no Control — não há o que atualizar lá',
        code: 'NAO_LANCADO',
      },
      mudou_de_novo: {
        status: 409,
        error: 'O pedido mudou de novo enquanto você atualizava o Control. Confira a lista outra vez antes de confirmar.',
        code: 'MUDOU_DE_NOVO',
      },
      ja_faturado: {
        status: 409,
        error: 'O pedido já foi faturado — a nota saiu e não há mais o que atualizar no Control',
        code: 'JA_FATURADO',
      },
      erro: { status: 500, error: 'Não foi possível registrar', code: 'UPDATE_FAILED' },
    } as const;
    const resp = respostas[r.motivo];
    await reply.status(resp.status).send({ error: resp.error, code: resp.code, statusCode: resp.status });
    return;
  }

  // O aviso é carona, nunca condição: push falhando não desfaz o registro. Mas
  // a resposta diz para quantos aparelhos saiu, separando financeiro de admin —
  // a tela não pode dizer "a Larissa foi avisada" quando só o admin recebeu.
  // `null` = o envio não terminou dentro do tempo; não se sabe.
  let avisados: { financeiro: number; admin: number } | null = null;
  if (body.acao === 'pedir') {
    const { data: pedido } = await supabase
      .from('orders')
      .select('id, order_number, erp_order_id')
      .eq('id', id)
      .eq('company_id', company_id)
      .maybeSingle();
    avisados = pedido
      ? await avisarPedidoMudouNoErp(
          company_id,
          pedido as { id: string; order_number: number | null; erp_order_id: string | null },
          sub,
          body.observacao ?? null,
        )
      : { financeiro: 0, admin: 0 };
  }

  // `data` continua sendo a sincronia, como na primeira versão da rota: o app
  // que ainda está aberto no celular com o pacote antigo lê `data` direto, e
  // mudar o formato deixava a tela do pedido em branco para ele.
  await reply.send({
    data: r.sincronia,
    avisados,
    aparelhos: avisados ? avisados.financeiro + avisados.admin : null,
  });
}
