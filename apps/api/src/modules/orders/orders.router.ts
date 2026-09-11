import type { FastifyInstance } from 'fastify';
import { authenticate, requireRole, requirePermission } from '../../middleware/auth.js';
import { diagnosticoDoEmail } from '../../lib/email.js';
import {
  listOrders,
  getOrder,
  createOrderHandler,
  updateStatusHandler,
  setInvoicedHandler,
  setDiscountHandler,
  setItemsHandler,
  setPaymentHandler,
  setNotesHandler,
  ultimoNumeroErpHandler,
  corrigirNumeroErpHandler,
  erpSyncHandler,
  deleteOrderHandler,
  listDeletedOrdersHandler,
  pedidoPublicoHandler,
  listPaymentConditions,
} from './orders.controller.js';

export async function ordersRouter(fastify: FastifyInstance): Promise<void> {
  // A loja consulta os pedidos DELA; o visitante da vitrine não consulta nada —
  // ele só monta e envia, e não tem onde acompanhar (não há conta).
  const daFabricaOuLoja = { preHandler: [authenticate, requireRole(['rep', 'manager', 'admin', 'store', 'financeiro'])] };
  // Mexer no ciclo do pedido é de quem vende. Quem compra não muda status nem
  // apaga: sem isto, uma loja poderia aprovar o próprio pedido.
  //
  // Decidir e excluir andam juntos na mesma tecla: são as duas formas de tirar
  // um pedido do caminho de alguém. A tecla não atinge o representante — a
  // triagem dele usa esta mesma rota, e `temPermissao` deixa passar quem não é
  // gerente justamente por isso.
  const decideOPedido = {
    preHandler: [
      authenticate,
      requireRole(['rep', 'manager', 'admin', 'financeiro']),
      requirePermission('aprovar_pedidos'),
    ],
  };

  // Página pública do pedido (o link do e-mail). Sem login — a segurança é o
  // token assinado. Rate-limit apertado, como as outras rotas /public.
  fastify.get(
    '/public/pedido/:token',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    pedidoPublicoHandler,
  );

  // O e-mail está de pé? Testa a autenticação no Gmail SEM enviar nada. A
  // falha de SMTP é silenciosa por desenho (nunca derruba pedido) — esta rota
  // é o jeito de enxergá-la sem caçar log no Railway. Não expõe segredo.
  fastify.get(
    '/public/health-email',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (_request, reply) => {
      await reply.send({ data: await diagnosticoDoEmail() });
    },
  );

  // A lista que o seletor de condição de pagamento usa — rep e loja escolhem
  // no pedido, então a loja também lê (mesmo conjunto de papéis dos pedidos).
  fastify.get('/payment-conditions', daFabricaOuLoja, listPaymentConditions);

  fastify.get('/orders', daFabricaOuLoja, listOrders);
  // O último número do Control lançado — para a Larissa seguir a ordem de lá.
  fastify.get(
    '/orders/ultimo-numero-erp',
    { preHandler: [authenticate, requireRole(['financeiro', 'admin'])] },
    ultimoNumeroErpHandler,
  );
  // A aba "Excluídos" (migração 040): a cópia de cada pedido apagado, com as
  // peças e quem apagou. Só o admin — é auditoria, não operação. Fica antes
  // do /orders/:id por clareza; o roteador já prefere a rota fixa.
  fastify.get(
    '/orders/excluidos',
    { preHandler: [authenticate, requireRole(['admin'])] },
    listDeletedOrdersHandler,
  );
  fastify.get('/orders/:id', daFabricaOuLoja, getOrder);
  fastify.post('/orders', { preHandler: authenticate }, createOrderHandler);
  fastify.delete('/orders/:id', decideOPedido, deleteOrderHandler);
  fastify.patch('/orders/:id/status', decideOPedido, updateStatusHandler);
  // Mexer no pedido em aberto — peças, desconto e condição de pagamento — segue
  // um portão só (podeMexerNoPedido, no service): o representante nos próprios
  // pedidos enquanto estão com ele; o gerente em tudo que ainda não virou nota.
  // Regra do Yan (14/08/2026): "o gerente pode mudar o pedido do representante
  // e do cliente" — revisão do desconto-só-do-rep do dia 13. A tecla da decisão
  // vale para os três: alterar pedido é parte de decidir.
  fastify.patch('/orders/:id/desconto', decideOPedido, setDiscountHandler);
  fastify.patch('/orders/:id/items', decideOPedido, setItemsHandler);
  fastify.patch('/orders/:id/pagamento', decideOPedido, setPaymentHandler);
  // A observação livre (o recado do rep) segue o MESMO portão — para a venda
  // interna, vale até o carimbo do faturamento em qualquer estado.
  fastify.patch('/orders/:id/observacao', decideOPedido, setNotesHandler);
  // Corrigir o número do Control digitado errado no lançamento — de quem lança
  // (financeiro; admin como válvula), e só antes de a nota sair.
  fastify.patch(
    '/orders/:id/numero-erp',
    { preHandler: [authenticate, requireRole(['financeiro', 'admin'])] },
    corrigirNumeroErpHandler,
  );
  // "Atualizar no ERP" (046): a venda interna editou as peças de um pedido que
  // já está no Control e avisa a fábrica; quem mexe no Control confirma depois.
  // O portão fino (dono do pedido x escritório) está no controller, porque
  // depende da AÇÃO pedida.
  fastify.patch(
    '/orders/:id/erp-sync',
    { preHandler: [authenticate, requireRole(['rep', 'financeiro', 'admin'])] },
    erpSyncHandler,
  );
  fastify.patch(
    '/orders/:id/invoice',
    {
      preHandler: [
        authenticate,
        requireRole(['manager', 'admin', 'financeiro', 'rep']),
        requirePermission('faturar_pedidos'),
      ],
    },
    setInvoicedHandler,
  );
}
