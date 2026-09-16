/**
 * API de Parceiro — integração de ERPs externos (v1).
 *
 * Autenticação: header X-API-Key (ver partner.auth.ts).
 *
 * Duas mãos:
 *  • pedidos SAEM — o parceiro busca GET /partner/v1/pedidos e confirma;
 *  • cadastros ENTRAM — o parceiro empurra clientes e representantes com POST.
 *
 * Toda chamada fica registrada em `erp_sync_log` (migração 048), com o resumo
 * que o handler anotou (partner.chamada.ts). O registro roda depois que a
 * resposta saiu e nunca a derruba.
 */
import type { FastifyInstance } from 'fastify';
import {
  partnerStatusHandler,
  partnerOrdersHandler,
  partnerConfirmOrderHandler,
  partnerConciliarOrderHandler,
  partnerConciliacaoHandler,
  partnerExcluidosHandler,
  partnerClientesHandler,
  partnerRepresentantesHandler,
  partnerFaturamentoHandler,
} from './partner.controller.js';
import { anotarChamada, montarChamada } from './partner.chamada.js';
import { registrarChamada } from './partner.log.js';

export async function partnerRouter(fastify: FastifyInstance): Promise<void> {
  // O resumo da chamada nasce vazio em toda requisição deste plugin (o plugin
  // é encapsulado: os hooks abaixo não valem para as outras rotas do app).
  fastify.decorateRequest('partnerLog', null);

  fastify.addHook('onRequest', async (request) => {
    anotarChamada(request, { started_at: new Date().toISOString() });
  });

  fastify.addHook('onResponse', async (request, reply) => {
    // `registrarChamada` nunca lança; o try é só para um defeito na montagem
    // do resumo não virar log de erro do Fastify a cada chamada.
    try {
      await registrarChamada(montarChamada(request, reply));
    } catch (e) {
      request.log.error({ err: e }, '[parceiro] falha ao montar o registro da chamada');
    }
  });

  fastify.get('/partner/v1/status', partnerStatusHandler);
  fastify.get('/partner/v1/pedidos', partnerOrdersHandler);
  // Só leitura, sempre liberada: os excluídos no app que já tinham número do Control.
  fastify.get('/partner/v1/pedidos/excluidos', partnerExcluidosHandler);
  fastify.post('/partner/v1/pedidos/:id/confirmar', partnerConfirmOrderHandler);
  // O passivo: pedido enviado ao ERP sem número recebe o número do Control.
  fastify.post('/partner/v1/pedidos/:id/conciliar', partnerConciliarOrderHandler);
  // Só contagens, sempre liberada.
  fastify.get('/partner/v1/conciliacao', partnerConciliacaoHandler);

  // O ERP informa o que faturou — é isso que vira "Aprovado" para o lojista e
  // venda no painel. Pronto e ativo; o ERP passa a usar quando quiser.
  fastify.post('/partner/v1/faturamento', partnerFaturamentoHandler);

  // Cadastros que o ERP mantém atualizados aqui.
  fastify.post('/partner/v1/clientes', partnerClientesHandler);
  fastify.post('/partner/v1/representantes', partnerRepresentantesHandler);
}
