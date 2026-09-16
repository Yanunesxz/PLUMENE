/**
 * A tela da integração com o Control (decisão 7 de 16/09/2026).
 *
 * Duas rotas, com JWT:
 *   • GET   /erp/integracao/status      — financeiro, gerente e admin olham;
 *   • PATCH /erp/integracao/sincronizar — financeiro e admin pedem ao Control
 *                                         que puxe tudo na próxima passagem.
 *
 * O lado do parceiro (POST /partner/v1/sincronizacao, que limpa o pedido)
 * mora em partner/partner.sincronizacao.controller.ts e entra pelo
 * partnerRouter, para ficar no mesmo registro de chamadas.
 */
import type { FastifyInstance } from 'fastify';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { pedirSincronizacaoHandler, statusDaIntegracaoHandler } from './integracao.controller.js';

export async function integracaoRouter(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    '/erp/integracao/status',
    { preHandler: [authenticate, requireRole(['admin', 'manager', 'financeiro'])] },
    statusDaIntegracaoHandler,
  );
  // O gerente vê, mas quem PEDE é o financeiro (ou o admin): é a mesa dele que
  // espera o número do Control.
  fastify.patch(
    '/erp/integracao/sincronizar',
    { preHandler: [authenticate, requireRole(['admin', 'financeiro'])] },
    pedirSincronizacaoHandler,
  );
}
