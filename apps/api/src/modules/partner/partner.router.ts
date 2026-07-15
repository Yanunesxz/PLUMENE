/**
 * API de Parceiro — integração de ERPs externos (v1).
 *
 * Autenticação: header X-API-Key (ver partner.auth.ts).
 * Fluxo: o programa do parceiro busca GET /partner/v1/pedidos, grava cada
 * pedido no ERP dele e confirma com POST /partner/v1/pedidos/:id/confirmar.
 */
import type { FastifyInstance } from 'fastify';
import {
  partnerStatusHandler,
  partnerOrdersHandler,
  partnerConfirmOrderHandler,
} from './partner.controller.js';

export async function partnerRouter(fastify: FastifyInstance): Promise<void> {
  fastify.get('/partner/v1/status', partnerStatusHandler);
  fastify.get('/partner/v1/pedidos', partnerOrdersHandler);
  fastify.post('/partner/v1/pedidos/:id/confirmar', partnerConfirmOrderHandler);
}
