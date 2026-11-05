import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { mensagemDoErroDaDistribuicao } from '@csb/shared';
import { parseBody } from '../../lib/validation.js';
import { avisarPedidoFracionado } from '../push/push.avisos.js';
import { fracionarPedido, mudarDataDeEnvio } from './fracionamento.service.js';

/**
 * O corpo só é conferido na FORMA aqui. Se a distribuição fecha (toda peça em
 * uma entrega, toda entrega com peça e data) quem diz é `conferirDistribuicao`
 * (shared), com a frase que a tela também usa.
 */
const fracionarSchema = z.object({
  entregas: z
    .array(
      z.object({
        ship_date: z.string().max(10),
        itens: z
          .array(z.object({ item_id: z.string().min(1), quantity: z.number() }))
          .max(5000),
      }),
    )
    .max(12),
});

const dataSchema = z.object({ ship_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data de envio inválida') });

const SEM_MIGRACAO = {
  status: 503,
  code: 'MIGRACAO_PENDENTE',
  error: 'A migração 057 ainda não rodou neste banco — fracionar pedido ainda não funciona aqui',
} as const;
const BANCO_INDISPONIVEL = {
  status: 503,
  code: 'BANCO_INDISPONIVEL',
  error: 'Não deu para falar com o banco agora. Nada foi alterado — tente de novo em instantes.',
} as const;
const NAO_ENCONTRADO = { status: 404, code: 'NOT_FOUND', error: 'Pedido não encontrado' } as const;

/** POST /orders/:id/fracionar { entregas: [{ ship_date, itens: [{ item_id, quantity }] }] } */
export async function fracionarHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, sub, role, venda_interna } = request.user;
  const { id } = request.params as { id: string };
  const body = await parseBody(fracionarSchema, request.body, reply);
  if (!body) return;

  const r = await fracionarPedido(id, company_id, { id: sub, role, venda_interna }, body.entregas);
  if (r.ok) {
    // "Tem que ser avisado quando é fracionado" (Yan, 05/11/2026): o dono do
    // pedido e a mesa ficam sabendo. O push é carona — nunca condição.
    avisarPedidoFracionado(company_id, r.order, r.entregas, sub);
    await reply.send({ data: { order: r.order, entregas: r.entregas } });
    return;
  }

  if (r.reason === 'distribuicao') {
    await reply.status(400).send({
      error: mensagemDoErroDaDistribuicao(r.erro ?? 'soma_diferente', r.entrega),
      code: 'DISTRIBUICAO_INVALIDA',
      statusCode: 400,
    });
    return;
  }
  const respostas = {
    not_found: NAO_ENCONTRADO,
    forbidden: { status: 403, code: 'FORBIDDEN', error: 'Você não pode fracionar este pedido' },
    tarde_demais: {
      status: 409,
      code: 'ORDER_JA_ENVIADO',
      error: 'Este pedido já saiu do seu alcance — não dá mais para fracionar por aqui',
    },
    ja_fracionado: {
      status: 409,
      code: 'JA_FRACIONADO',
      error: 'Este pedido já é uma entrega de um pedido fracionado — ajuste as peças em "Editar peças"',
    },
    mudou: {
      status: 409,
      code: 'PEDIDO_MUDOU',
      error: 'O pedido mudou enquanto você fracionava. Nada foi alterado — abra o pedido de novo e confira.',
    },
    sem_migracao: SEM_MIGRACAO,
    banco_indisponivel: BANCO_INDISPONIVEL,
    erro: {
      status: 500,
      code: 'FRACIONAMENTO_FALHOU',
      error: 'Não foi possível fracionar o pedido. Nada foi alterado — tente de novo.',
    },
  } as const;
  const resp = respostas[r.reason];
  await reply.status(resp.status).send({ error: resp.error, code: resp.code, statusCode: resp.status });
}

/** PATCH /orders/:id/data-de-envio { ship_date } — a data de envio de uma entrega. */
export async function dataDeEnvioHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, sub, role, venda_interna } = request.user;
  const { id } = request.params as { id: string };
  const body = await parseBody(dataSchema, request.body, reply);
  if (!body) return;

  const r = await mudarDataDeEnvio(id, company_id, { id: sub, role, venda_interna }, body.ship_date);
  if (r.ok) {
    await reply.send({ data: r.order });
    return;
  }
  const respostas = {
    not_found: NAO_ENCONTRADO,
    forbidden: { status: 403, code: 'FORBIDDEN', error: 'Você não pode mudar a data de envio deste pedido' },
    tarde_demais: {
      status: 409,
      code: 'ORDER_JA_ENVIADO',
      error: 'Este pedido já saiu do seu alcance — a data de envio não pode mais mudar por aqui',
    },
    nao_fracionado: {
      status: 409,
      code: 'NAO_FRACIONADO',
      error: 'Só pedido fracionado em entregas tem data de envio',
    },
    sem_migracao: SEM_MIGRACAO,
    banco_indisponivel: BANCO_INDISPONIVEL,
    erro: { status: 500, code: 'UPDATE_FAILED', error: 'Não foi possível gravar a data de envio — tente de novo' },
  } as const;
  const resp = respostas[r.reason];
  await reply.status(resp.status).send({ error: resp.error, code: resp.code, statusCode: resp.status });
}
