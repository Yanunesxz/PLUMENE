import type { FastifyRequest, FastifyReply } from 'fastify';
import { requirePartner } from './partner.auth.js';
import { getPartnerOrders, confirmOrderImport } from './partner.service.js';

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
