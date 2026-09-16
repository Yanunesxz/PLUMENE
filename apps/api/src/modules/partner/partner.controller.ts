import type { FastifyRequest, FastifyReply } from 'fastify';
import {
  getPartnerOrders,
  confirmOrderImport,
  conciliarPedidoErp,
  contarConciliacao,
  listarExcluidosComNumero,
} from './partner.service.js';
import {
  receberClientes,
  receberRepresentantes,
  type ClienteParceiro,
  type RepresentanteParceiro,
} from './partner.sync.service.js';
import { receberFaturamento, type FaturamentoParceiro } from './partner.faturamento.service.js';
import { anotarChamada } from './partner.chamada.js';
import { lerCanais, type Canais } from '../../lib/canais.js';
import { lerSolicitacaoDeSync } from '../integracao/integracao.service.js';
import {
  MAX_POR_LOTE,
  anotarLote,
  autenticar,
  extrairLista,
  momentoComFuso,
  recusouPorCanal,
  responder,
  CORPO_NAO_ENCONTRADO,
  CORPO_ERRO_INTERNO,
} from './partner.porta.js';

/** O `pedido_erp` do corpo, aparado; '' quando não veio em texto. */
function pedidoErpDoCorpo(corpo: unknown): string {
  // Corpo nulo, lista, ou `pedido_erp` numérico: nada disso pode virar
  // TypeError (que o app.ts carimbaria como 500 INTERNAL_ERROR).
  const bruto =
    corpo && typeof corpo === 'object' && !Array.isArray(corpo)
      ? (corpo as { pedido_erp?: unknown }).pedido_erp
      : undefined;
  return typeof bruto === 'string' ? bruto.trim() : '';
}

const CORPO_SEM_PEDIDO_ERP = {
  error: 'Informe "pedido_erp" — o número do pedido gerado no seu ERP',
  code: 'MISSING_PEDIDO_ERP',
  statusCode: 400,
};

const CORPO_PEDIDO_ERP_INVALIDO = {
  error: 'pedido_erp fora do formato: duas letras e ate 10 digitos (ex.: CS17379)',
  code: 'INVALID_PEDIDO_ERP',
  statusCode: 400,
};

function corpoNumeroEmUso(pedido_em_uso: { id: string; numero: number | null } | null) {
  return {
    error: pedido_em_uso
      ? `Número do Control já usado pelo pedido ${pedido_em_uso.numero ?? pedido_em_uso.id}`
      : 'Número do Control já usado por outro pedido',
    code: 'ERP_NUMBER_IN_USE',
    statusCode: 409,
    pedido_em_uso,
  };
}

function corpoJaConfirmado(pedido_erp_atual: string) {
  return {
    error: `Pedido já confirmado com outro número: ${pedido_erp_atual}`,
    code: 'ORDER_ALREADY_CONFIRMED',
    statusCode: 409,
    pedido_erp_atual,
  };
}

/** GET /partner/v1/status — teste de conexão e de chave */
export async function partnerStatusHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const partner = await autenticar(request, reply);
  if (!partner) return;

  // O /status é a rota de DIAGNÓSTICO: é ela que o parceiro chama para saber se
  // a chave e a conexão estão boas. Um soluço do banco não pode transformá-la
  // em 500 — aí ele perde justamente o instrumento de distinguir "minha chave
  // está errada" de "o app está com problema". Então aqui o canal degrada:
  // `canais: null` significa "não deu para ler agora". As rotas que GRAVAM
  // continuam lançando (canal fechado por falta de resposta).
  let canais: Omit<Canais, 'migracao'> | null = null;
  try {
    const lidos = await lerCanais(partner.company_id);
    canais = {
      pedido_erp: lidos.pedido_erp,
      faturamento: lidos.faturamento,
      cadastro: lidos.cadastro,
      retrato: lidos.retrato,
      catalogo: lidos.catalogo,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[parceiro] /status sem resposta do banco sobre os canais: ${msg}`);
    anotarChamada(request, { detalhe: { canais: 'nao_lidos' } });
  }

  // "Sincronizar agora" (049): alguém no app apertou o botão da tela de
  // integração e o Control ainda não avisou que rodou (POST /sincronizacao).
  // Mesma degradação dos canais: sem resposta do banco vale `false` (o Control
  // segue o horário normal dele) e fica anotado. É sempre booleano, para o
  // robô do parceiro não ter de interpretar um terceiro valor; `solicitado_em`
  // é o que ele devolve no aviso de concluída.
  let sincronizar_agora = false;
  let solicitado_em: string | null = null;
  try {
    const { solicitacao } = await lerSolicitacaoDeSync(partner.company_id);
    sincronizar_agora = Boolean(solicitacao);
    solicitado_em = solicitacao?.solicitado_em ?? null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[parceiro] /status sem resposta do banco sobre o "sincronizar agora": ${msg}`);
    anotarChamada(request, { detalhe: { sincronizar_agora: 'nao_lido' } });
  }
  if (sincronizar_agora) anotarChamada(request, { detalhe: { sincronizar_agora: true } });

  await reply.send({
    ok: true,
    parceiro: partner.name,
    servidor_hora: new Date().toISOString(),
    // Quais mãos estão ligadas para a API nesta empresa (os cinco canais).
    // Aditivo. `null` = o banco não respondeu agora; tente de novo.
    canais,
    // `true` = rode a rodada inteira agora (fila, cadastros, faturamento,
    // catálogo, retrato), sem esperar o próximo horário — e depois avise com
    // POST /partner/v1/sincronizacao { concluida: true, solicitado_em }.
    sincronizar_agora,
    solicitado_em,
  });
}

/** GET /partner/v1/pedidos?desde=ISO&incluir=todos — fila de pedidos p/ importar */
export async function partnerOrdersHandler(
  request: FastifyRequest<{ Querystring: { desde?: string; incluir?: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const partner = await autenticar(request, reply);
  if (!partner) return;
  if (await recusouPorCanal(request, reply, partner.company_id, 'pedido_erp')) return;

  const { desde, incluir } = request.query ?? {};
  if (desde && Number.isNaN(Date.parse(desde))) {
    await responder(request, reply, 400, {
      error: 'Parâmetro "desde" deve ser uma data ISO (ex.: 2026-07-15T00:00:00Z)',
      code: 'INVALID_DESDE',
      statusCode: 400,
    });
    return;
  }

  const incluirImportados = incluir === 'todos';
  const pedidos = await getPartnerOrders(partner.company_id, { desde, incluirImportados });

  anotarChamada(request, {
    detalhe: {
      incluir: incluirImportados ? 'todos' : 'fila',
      pedidos: pedidos.length,
      importaveis: pedidos.filter((p) => p.importavel).length,
    },
  });
  await reply.send({
    total: pedidos.length,
    servidor_hora: new Date().toISOString(),
    pedidos,
  });
}

/**
 * POST /partner/v1/pedidos/:id/confirmar { pedido_erp } — marca como importado.
 *
 * Cada desfecho do service tem o seu código textual; é o que o programador do
 * Fábio lê para decidir se tenta de novo (5xx) ou corrige do lado dele (4xx).
 */
export async function partnerConfirmOrderHandler(
  request: FastifyRequest<{ Params: { id: string }; Body: { pedido_erp?: unknown } }>,
  reply: FastifyReply,
): Promise<void> {
  const partner = await autenticar(request, reply);
  if (!partner) return;
  if (await recusouPorCanal(request, reply, partner.company_id, 'pedido_erp')) return;

  const pedido_erp = pedidoErpDoCorpo(request.body);
  if (!pedido_erp) {
    await responder(request, reply, 400, CORPO_SEM_PEDIDO_ERP);
    return;
  }

  const order_id = request.params.id;
  anotarChamada(request, { detalhe: { order_id } });
  const result = await confirmOrderImport(partner.company_id, order_id, pedido_erp, partner.name);

  switch (result.outcome) {
    case 'invalid_number':
      await responder(request, reply, 400, CORPO_PEDIDO_ERP_INVALIDO);
      return;
    case 'not_found':
      await responder(request, reply, 404, CORPO_NAO_ENCONTRADO);
      return;
    case 'conflict':
      await responder(request, reply, 409, corpoJaConfirmado(result.pedido_erp_atual));
      return;
    case 'not_confirmable':
      await responder(request, reply, 409, {
        error: 'so pedido aprovado pode ser confirmado',
        code: 'ORDER_NOT_APPROVED',
        statusCode: 409,
        situacao: result.situacao,
      });
      return;
    case 'number_in_use':
      await responder(request, reply, 409, corpoNumeroEmUso(result.pedido_em_uso));
      return;
    case 'ok':
      anotarChamada(request, {
        recebidos: 1,
        gravados: result.ja_confirmado ? 0 : 1,
        sem_mudanca: result.ja_confirmado ? 1 : 0,
        detalhe: { ja_confirmado: result.ja_confirmado },
      });
      await reply.send({ ok: true, ja_confirmado: result.ja_confirmado });
      return;
    default:
      // Outcome sem `case` deixava a requisição pendurada até o timeout do
      // cliente. Melhor um 500 honesto do que silêncio.
      await responder(request, reply, 500, CORPO_ERRO_INTERNO);
  }
}

/**
 * POST /partner/v1/pedidos/:id/conciliar { pedido_erp } — dá o número do
 * Control a um pedido que foi enviado ao ERP sem número (o passivo de antes da
 * API). Pedido aprovado usa o `/confirmar`.
 */
export async function partnerConciliarOrderHandler(
  request: FastifyRequest<{ Params: { id: string }; Body: { pedido_erp?: unknown } }>,
  reply: FastifyReply,
): Promise<void> {
  const partner = await autenticar(request, reply);
  if (!partner) return;
  if (await recusouPorCanal(request, reply, partner.company_id, 'pedido_erp')) return;

  const pedido_erp = pedidoErpDoCorpo(request.body);
  if (!pedido_erp) {
    await responder(request, reply, 400, CORPO_SEM_PEDIDO_ERP);
    return;
  }

  const order_id = request.params.id;
  anotarChamada(request, { detalhe: { order_id } });
  const result = await conciliarPedidoErp(partner.company_id, order_id, pedido_erp, partner.name);

  switch (result.outcome) {
    case 'invalid_number':
      await responder(request, reply, 400, CORPO_PEDIDO_ERP_INVALIDO);
      return;
    case 'not_found':
      await responder(request, reply, 404, CORPO_NAO_ENCONTRADO);
      return;
    case 'conflict':
      await responder(request, reply, 409, corpoJaConfirmado(result.pedido_erp_atual));
      return;
    case 'not_reconcilable':
      await responder(request, reply, 409, {
        error: 'Só pedido enviado ao ERP sem número é conciliado; pedido aprovado usa /confirmar',
        code: 'ORDER_NOT_RECONCILABLE',
        statusCode: 409,
        situacao: result.situacao,
      });
      return;
    case 'number_in_use':
      await responder(request, reply, 409, corpoNumeroEmUso(result.pedido_em_uso));
      return;
    case 'ok':
      anotarChamada(request, {
        recebidos: 1,
        gravados: result.ja_conciliado ? 0 : 1,
        sem_mudanca: result.ja_conciliado ? 1 : 0,
        detalhe: { ja_conciliado: result.ja_conciliado },
      });
      await reply.send({ ok: true, ja_conciliado: result.ja_conciliado });
      return;
    default:
      await responder(request, reply, 500, CORPO_ERRO_INTERNO);
  }
}

/**
 * GET /partner/v1/conciliacao — só contagens da empresa da chave. Sempre
 * liberada: não grava nada e não devolve linha nenhuma.
 */
export async function partnerConciliacaoHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const partner = await autenticar(request, reply);
  if (!partner) return;

  const contagens = await contarConciliacao(partner.company_id);
  anotarChamada(request, { detalhe: { ...contagens } });
  await reply.send({ ...contagens, servidor_hora: new Date().toISOString() });
}

/**
 * GET /partner/v1/pedidos/excluidos?desde=ISO — pedidos excluídos no app que
 * já tinham número do Control. Sempre liberada (só leitura).
 */
export async function partnerExcluidosHandler(
  request: FastifyRequest<{ Querystring: { desde?: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const partner = await autenticar(request, reply);
  if (!partner) return;

  const desde = typeof request.query?.desde === 'string' ? request.query.desde.trim() : undefined;
  if (desde !== undefined && desde !== '' && !momentoComFuso(desde)) {
    await responder(request, reply, 400, {
      error: 'Parâmetro "desde" deve ser uma data ISO com fuso (ex.: 2026-09-15T00:00:00Z ou 2026-09-15T00:00:00-03:00)',
      code: 'INVALID_DESDE',
      statusCode: 400,
    });
    return;
  }

  const excluidos = await listarExcluidosComNumero(partner.company_id, desde || undefined);
  anotarChamada(request, { detalhe: { excluidos: excluidos.length } });
  await reply.send({
    total: excluidos.length,
    servidor_hora: new Date().toISOString(),
    excluidos,
  });
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
  const partner = await autenticar(request, reply);
  if (!partner) return;
  if (await recusouPorCanal(request, reply, partner.company_id, 'faturamento')) return;

  const lista = extrairLista<FaturamentoParceiro>(request.body, 'faturamento');
  if (!lista) {
    await responder(request, reply, 400, {
      error: 'Envie { "faturamento": [...] } ou uma lista no corpo',
      code: 'INVALID_BODY',
      statusCode: 400,
    });
    return;
  }
  if (lista.length > MAX_POR_LOTE) {
    anotarChamada(request, { recebidos: lista.length });
    await responder(request, reply, 400, {
      error: `Máximo ${MAX_POR_LOTE} pedidos por requisição — divida em lotes`,
      code: 'BATCH_TOO_LARGE',
      statusCode: 400,
    });
    return;
  }

  // O nome do parceiro vai nos eventos do pedido (order_erp_events).
  const resultado = await receberFaturamento(partner.company_id, lista, { parceiro: partner.name });
  anotarLote(request, resultado);
  await reply.send({ ok: true, ...resultado, servidor_hora: new Date().toISOString() });
}

/** POST /partner/v1/clientes — o ERP empurra clientes atualizados */
export async function partnerClientesHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const partner = await autenticar(request, reply);
  if (!partner) return;
  if (await recusouPorCanal(request, reply, partner.company_id, 'cadastro')) return;

  const lista = extrairLista<ClienteParceiro>(request.body, 'clientes');
  if (!lista) {
    await responder(request, reply, 400, {
      error: 'Envie { "clientes": [...] } ou uma lista de clientes no corpo',
      code: 'INVALID_BODY',
      statusCode: 400,
    });
    return;
  }
  if (lista.length > MAX_POR_LOTE) {
    anotarChamada(request, { recebidos: lista.length });
    await responder(request, reply, 400, {
      error: `Máximo ${MAX_POR_LOTE} clientes por requisição — divida em lotes (recomendado 500)`,
      code: 'BATCH_TOO_LARGE',
      statusCode: 400,
    });
    return;
  }

  const resultado = await receberClientes(partner.company_id, lista);
  anotarLote(request, resultado);
  await reply.send({ ok: true, ...resultado, servidor_hora: new Date().toISOString() });
}

/** POST /partner/v1/representantes — o ERP empurra representantes atualizados */
export async function partnerRepresentantesHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const partner = await autenticar(request, reply);
  if (!partner) return;
  if (await recusouPorCanal(request, reply, partner.company_id, 'cadastro')) return;

  const lista = extrairLista<RepresentanteParceiro>(request.body, 'representantes');
  if (!lista) {
    await responder(request, reply, 400, {
      error: 'Envie { "representantes": [...] } ou uma lista no corpo',
      code: 'INVALID_BODY',
      statusCode: 400,
    });
    return;
  }
  if (lista.length > MAX_POR_LOTE) {
    anotarChamada(request, { recebidos: lista.length });
    await responder(request, reply, 400, {
      error: `Máximo ${MAX_POR_LOTE} representantes por requisição — divida em lotes`,
      code: 'BATCH_TOO_LARGE',
      statusCode: 400,
    });
    return;
  }

  const resultado = await receberRepresentantes(partner.company_id, lista);
  anotarLote(request, resultado);
  await reply.send({ ok: true, ...resultado, servidor_hora: new Date().toISOString() });
}
