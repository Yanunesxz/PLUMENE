import type { FastifyRequest, FastifyReply } from 'fastify';
import { requirePartner } from './partner.auth.js';
import { getPartnerOrders, confirmOrderImport } from './partner.service.js';
import {
  receberClientes,
  receberRepresentantes,
  type ClienteParceiro,
  type RepresentanteParceiro,
} from './partner.sync.service.js';
import { receberFaturamento, type FaturamentoParceiro } from './partner.faturamento.service.js';

/**
 * Máximo por requisição. Mantém o corpo bem abaixo do limite de 1 MB do Fastify;
 * o parceiro divide em lotes (a spec recomenda 500). Passar disso é 400, não um
 * 413 críptico no meio do envio.
 */
const MAX_POR_LOTE = 1000;

/** Aceita `{ clientes: [...] }`, `{ dados: [...] }` ou a lista pura no corpo. */
function extrairLista<T>(body: unknown, chave: string): T[] | null {
  if (Array.isArray(body)) return body as T[];
  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>;
    const lista = obj[chave] ?? obj['dados'];
    if (Array.isArray(lista)) return lista as T[];
  }
  return null;
}

/** GET /partner/v1/status — teste de conexão e de chave */
export async function partnerStatusHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const partner = await requirePartner(request, reply);
  if (!partner) return;

  await reply.send({
    ok: true,
    parceiro: partner.name,
    servidor_hora: new Date().toISOString(),
  });
}

/** GET /partner/v1/pedidos?desde=ISO&incluir=todos — fila de pedidos p/ importar */
export async function partnerOrdersHandler(
  request: FastifyRequest<{ Querystring: { desde?: string; incluir?: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const partner = await requirePartner(request, reply);
  if (!partner) return;

  const { desde, incluir } = request.query;
  if (desde && Number.isNaN(Date.parse(desde))) {
    await reply.status(400).send({
      error: 'Parâmetro "desde" deve ser uma data ISO (ex.: 2026-07-15T00:00:00Z)',
      code: 'INVALID_DESDE',
      statusCode: 400,
    });
    return;
  }

  const pedidos = await getPartnerOrders(partner.company_id, {
    desde,
    incluirImportados: incluir === 'todos',
  });

  await reply.send({
    total: pedidos.length,
    servidor_hora: new Date().toISOString(),
    pedidos,
  });
}

/** POST /partner/v1/pedidos/:id/confirmar { pedido_erp } — marca como importado */
export async function partnerConfirmOrderHandler(
  request: FastifyRequest<{ Params: { id: string }; Body: { pedido_erp?: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const partner = await requirePartner(request, reply);
  if (!partner) return;

  const pedido_erp = request.body?.pedido_erp?.trim();
  if (!pedido_erp) {
    await reply.status(400).send({
      error: 'Informe "pedido_erp" — o número do pedido gerado no seu ERP',
      code: 'MISSING_PEDIDO_ERP',
      statusCode: 400,
    });
    return;
  }

  const result = await confirmOrderImport(partner.company_id, request.params.id, pedido_erp);

  switch (result.outcome) {
    case 'not_found':
      await reply.status(404).send({
        error: 'Pedido não encontrado',
        code: 'ORDER_NOT_FOUND',
        statusCode: 404,
      });
      return;
    case 'conflict':
      await reply.status(409).send({
        error: `Pedido já confirmado com outro número: ${result.pedido_erp_atual}`,
        code: 'ORDER_ALREADY_CONFIRMED',
        statusCode: 409,
        pedido_erp_atual: result.pedido_erp_atual,
      });
      return;
    case 'ok':
      await reply.send({ ok: true, ja_confirmado: result.ja_confirmado });
  }
}

/**
 * POST /partner/v1/faturamento — o ERP informa o que faturou
 *
 * É o que promove o pedido a "Aprovado" aos olhos do lojista e o que conta
 * como venda no painel. Ver partner.faturamento.service.ts.
 */
export async function partnerFaturamentoHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const partner = await requirePartner(request, reply);
  if (!partner) return;

  const lista = extrairLista<FaturamentoParceiro>(request.body, 'faturamento');
  if (!lista) {
    await reply.status(400).send({
      error: 'Envie { "faturamento": [...] } ou uma lista no corpo',
      code: 'INVALID_BODY',
      statusCode: 400,
    });
    return;
  }
  if (lista.length > MAX_POR_LOTE) {
    await reply.status(400).send({
      error: `Máximo ${MAX_POR_LOTE} pedidos por requisição — divida em lotes`,
      code: 'BATCH_TOO_LARGE',
      statusCode: 400,
    });
    return;
  }

  const resultado = await receberFaturamento(partner.company_id, lista);
  await reply.send({ ok: true, ...resultado, servidor_hora: new Date().toISOString() });
}

/** POST /partner/v1/clientes — o ERP empurra clientes atualizados */
export async function partnerClientesHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const partner = await requirePartner(request, reply);
  if (!partner) return;

  const lista = extrairLista<ClienteParceiro>(request.body, 'clientes');
  if (!lista) {
    await reply.status(400).send({
      error: 'Envie { "clientes": [...] } ou uma lista de clientes no corpo',
      code: 'INVALID_BODY',
      statusCode: 400,
    });
    return;
  }
  if (lista.length > MAX_POR_LOTE) {
    await reply.status(400).send({
      error: `Máximo ${MAX_POR_LOTE} clientes por requisição — divida em lotes (recomendado 500)`,
      code: 'BATCH_TOO_LARGE',
      statusCode: 400,
    });
    return;
  }

  const resultado = await receberClientes(partner.company_id, lista);
  await reply.send({ ok: true, ...resultado, servidor_hora: new Date().toISOString() });
}

/** POST /partner/v1/representantes — o ERP empurra representantes atualizados */
export async function partnerRepresentantesHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const partner = await requirePartner(request, reply);
  if (!partner) return;

  const lista = extrairLista<RepresentanteParceiro>(request.body, 'representantes');
  if (!lista) {
    await reply.status(400).send({
      error: 'Envie { "representantes": [...] } ou uma lista no corpo',
      code: 'INVALID_BODY',
      statusCode: 400,
    });
    return;
  }
  if (lista.length > MAX_POR_LOTE) {
    await reply.status(400).send({
      error: `Máximo ${MAX_POR_LOTE} representantes por requisição — divida em lotes`,
      code: 'BATCH_TOO_LARGE',
      statusCode: 400,
    });
    return;
  }

  const resultado = await receberRepresentantes(partner.company_id, lista);
  await reply.send({ ok: true, ...resultado, servidor_hora: new Date().toISOString() });
}
