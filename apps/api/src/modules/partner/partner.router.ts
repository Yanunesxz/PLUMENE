/**
 * API de Parceiro — integração de ERPs externos (v1).
 *
 * Autenticação: header X-API-Key (ver partner.auth.ts).
 *
 * Duas mãos:
 *  • pedidos SAEM — o parceiro busca GET /partner/v1/pedidos e confirma;
 *  • cadastros ENTRAM — o parceiro empurra clientes e representantes com POST.
 */
import type { FastifyInstance } from 'fastify';
import {
  partnerStatusHandler,
  partnerOrdersHandler,
  partnerConfirmOrderHandler,
  partnerClientesHandler,
  partnerRepresentantesHandler,
  partnerFaturamentoHandler,
} from './partner.controller.js';

export async function partnerRouter(fastify: FastifyInstance): Promise<void> {
  fastify.get('/partner/v1/status', partnerStatusHandler);
  fastify.get('/partner/v1/pedidos', partnerOrdersHandler);
  fastify.post('/partner/v1/pedidos/:id/confirmar', partnerConfirmOrderHandler);

  // O ERP informa o que faturou — é isso que vira "Aprovado" para o lojista e
  // venda no painel. Pronto e ativo; o ERP passa a usar quando quiser.
  fastify.post('/partner/v1/faturamento', partnerFaturamentoHandler);

  // Cadastros que o ERP mantém atualizados aqui.
  fastify.post('/partner/v1/clientes', partnerClientesHandler);
  fastify.post('/partner/v1/representantes', partnerRepresentantesHandler);
}
