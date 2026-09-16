/**
 * API de Parceiro — integração de ERPs externos (v1).
 *
 * Autenticação: header X-API-Key (ver partner.auth.ts).
 *
 * Duas mãos:
 *  • pedidos SAEM — o parceiro busca GET /partner/v1/pedidos e confirma;
 *  • cadastros, catálogo, preço, estoque, retrato e faturamento ENTRAM — o
 *    parceiro empurra com POST; e o que muda no app volta a ele por
 *    GET /clientes e /representantes com ?desde= (decisão 7 de 16/09/2026).
 *
 * Toda chamada COM chave (certa ou errada) fica registrada em `erp_sync_log`
 * (migração 048), com o resumo que o handler anotou (partner.chamada.ts). O
 * registro roda depois que a resposta saiu e nunca a derruba. Requisição sem
 * header nenhum não é registrada — ver `vaiParaOLog`.
 *
 * Canal por empresa (lib/canais.ts): cada rota que grava ou entrega dado exige
 * o canal daquele fluxo em 'api' (409 CANAL_FECHADO). As rotas de leitura de
 * diagnóstico (status, conciliação, excluídos) e o aviso de sincronização
 * concluída são sempre liberadas.
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
import {
  partnerClientesAlteradosHandler,
  partnerRepresentantesAlteradosHandler,
  partnerExcluirPedidoHandler,
} from './partner.cadastros.controller.js';
import {
  partnerTabelasPrecoHandler,
  partnerCondicoesPagamentoHandler,
  partnerProdutosHandler,
  partnerPrecosHandler,
  partnerEstoqueHandler,
} from './partner.catalogo.controller.js';
import { partnerRetratoHandler } from './partner.retrato.controller.js';
import { partnerSincronizacaoHandler } from './partner.sincronizacao.controller.js';
import { anotarChamada, montarChamada, vaiParaOLog } from './partner.chamada.js';
import { registrarChamada } from './partner.log.js';

export async function partnerRouter(fastify: FastifyInstance): Promise<void> {
  // O resumo da chamada nasce vazio em toda requisição deste plugin (o plugin
  // é encapsulado: os hooks abaixo não valem para as outras rotas do app).
  fastify.decorateRequest('partnerLog', null);

  fastify.addHook('onRequest', async (request) => {
    anotarChamada(request, { started_at: new Date().toISOString() });
  });

  fastify.addHook('onResponse', async (request, reply) => {
    // Robô que varre a internet não escreve no nosso banco: sem o header
    // X-API-Key, a chamada não vira linha em `erp_sync_log`.
    if (!vaiParaOLog(request)) return;
    // `registrarChamada` nunca lança; o try é só para um defeito na montagem
    // do resumo não virar log de erro do Fastify a cada chamada.
    try {
      await registrarChamada(montarChamada(request, reply));
    } catch (e) {
      request.log.error({ err: e }, '[parceiro] falha ao montar o registro da chamada');
    }
  });

  // ── Diagnóstico e controle (sempre liberadas) ─────────────────────────────
  fastify.get('/partner/v1/status', partnerStatusHandler);
  // Só contagens.
  fastify.get('/partner/v1/conciliacao', partnerConciliacaoHandler);
  // Só leitura: os excluídos no app que já tinham número do Control.
  fastify.get('/partner/v1/pedidos/excluidos', partnerExcluidosHandler);
  // O Control avisa que rodou a passada que o `sincronizar_agora` pediu.
  fastify.post('/partner/v1/sincronizacao', partnerSincronizacaoHandler);

  // ── Pedidos (canal_pedido_erp = 'api') ────────────────────────────────────
  // A fila: aprovado, sem número, não faturado e SOLICITADO pelo financeiro.
  fastify.get('/partner/v1/pedidos', partnerOrdersHandler);
  fastify.post('/partner/v1/pedidos/:id/confirmar', partnerConfirmOrderHandler);
  // O passivo: pedido enviado ao ERP sem número recebe o número do Control.
  fastify.post('/partner/v1/pedidos/:id/conciliar', partnerConciliarOrderHandler);
  // O Control excluiu do lado dele e avisa; o app exclui com a cópia da 040.
  fastify.post('/partner/v1/pedidos/:id/excluir', partnerExcluirPedidoHandler);

  // ── Faturamento (canal_faturamento = 'api') ───────────────────────────────
  // O ERP informa o que faturou — é isso que vira "Aprovado" para o lojista e
  // venda no painel. Uma nota por pedido: nota nova substitui a anterior.
  fastify.post('/partner/v1/faturamento', partnerFaturamentoHandler);

  // ── Cadastros (canal_cadastro = 'api') — as duas mãos ─────────────────────
  // O Control manda; o app grava (casa por CNPJ, depois pelo código).
  fastify.post('/partner/v1/clientes', partnerClientesHandler);
  fastify.post('/partner/v1/representantes', partnerRepresentantesHandler);
  // O Control puxa o que mudou no app (?desde=), no mesmo formato do POST.
  fastify.get('/partner/v1/clientes', partnerClientesAlteradosHandler);
  fastify.get('/partner/v1/representantes', partnerRepresentantesAlteradosHandler);

  // ── Catálogo (canal_catalogo = 'api') — o Control manda e sobrescreve ─────
  // Ordem que o Control respeita: tabelas e produtos ANTES de preços e estoque.
  fastify.post('/partner/v1/tabelas-preco', partnerTabelasPrecoHandler);
  fastify.post('/partner/v1/condicoes-pagamento', partnerCondicoesPagamentoHandler);
  fastify.post('/partner/v1/produtos', partnerProdutosHandler);
  fastify.post('/partner/v1/precos', partnerPrecosHandler);
  fastify.post('/partner/v1/estoque', partnerEstoqueHandler);

  // ── Retrato do cliente (canal_retrato = 'api') ────────────────────────────
  // Última compra, total comprado, vencido, pendência financeira — 1x por dia.
  fastify.post('/partner/v1/retrato', partnerRetratoHandler);
}
