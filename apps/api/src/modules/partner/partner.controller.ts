import type { FastifyRequest, FastifyReply } from 'fastify';
import { requirePartner, type Partner } from './partner.auth.js';
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
import { corpoCanalFechado, exigirCanal, lerCanais, type NomeDoCanal, type ValorDoCanal } from '../../lib/canais.js';

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

/**
 * Momento com fuso: `2026-09-15T13:00:00Z` ou `...-03:00`. Sem fuso, o mesmo
 * texto é uma hora no Railway (UTC) e outra no ERP (Brasília).
 */
const MOMENTO_COM_FUSO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})$/i;

function momentoComFuso(v: string): boolean {
  return MOMENTO_COM_FUSO.test(v) && !Number.isNaN(Date.parse(v));
}

/** Valida a chave e deixa anotado de quem ela é, para o registro da chamada. */
async function autenticar(request: FastifyRequest, reply: FastifyReply): Promise<Partner | null> {
  const partner = await requirePartner(request, reply);
  // Recusada na porta (401/503): o `code` entra no registro pelo montarChamada,
  // porque a resposta já saiu quando o `requirePartner` volta.
  if (partner) anotarChamada(request, { company_id: partner.company_id, parceiro: partner.name });
  return partner;
}

/** Responde e anota o `code` da resposta no registro da chamada. */
async function responder(
  request: FastifyRequest,
  reply: FastifyReply,
  status: number,
  corpo: Record<string, unknown>,
): Promise<void> {
  if (typeof corpo['code'] === 'string') anotarChamada(request, { detalhe: { code: corpo['code'] } });
  await reply.status(status).send(corpo);
}

/**
 * O canal da empresa está ligado para a API? Se não, responde 409 CANAL_FECHADO
 * e devolve true (o handler encerra). Erro ao ler o canal sobe (500): um
 * soluço do banco não abre nem fecha canal.
 */
async function recusouPorCanal(
  request: FastifyRequest,
  reply: FastifyReply,
  company_id: string,
  canal: NomeDoCanal,
): Promise<boolean> {
  // 'api' é valor válido nos cinco canais.
  const recusa = await exigirCanal(company_id, canal, 'api' as ValorDoCanal<typeof canal>);
  if (!recusa) return false;
  const corpo = corpoCanalFechado(recusa);
  anotarChamada(request, { detalhe: { canal: recusa.canal, valor_atual: recusa.valor_atual } });
  await responder(request, reply, 409, corpo);
  return true;
}

/**
 * Anota as contagens de uma rota de lote (faturamento, clientes,
 * representantes) a partir do que o service devolveu. Lê os campos com
 * tolerância: cada service tem os seus contadores.
 */
function anotarLote(request: FastifyRequest, resultado: object): void {
  const r = resultado as Record<string, unknown>;
  const numero = (chave: string): number | undefined => {
    const v = r[chave];
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  };
  const ignorados = Array.isArray(r['ignorados']) ? (r['ignorados'] as unknown[]) : [];
  const avisos = Array.isArray(r['avisos']) ? r['avisos'].length : undefined;
  anotarChamada(request, {
    recebidos: numero('recebidos'),
    gravados: (numero('criados') ?? 0) + (numero('atualizados') ?? 0),
    sem_mudanca: numero('sem_mudanca') ?? numero('inalterados'),
    ignorados: ignorados.length,
    detalhe: {
      // Só a referência e o motivo de cada ignorado — nada do registro.
      ignorados: ignorados.map((i) => {
        const item = (i && typeof i === 'object' ? i : {}) as Record<string, unknown>;
        return {
          referencia: item['pedido'] ?? item['codigo'] ?? item['pedido_erp'] ?? item['id'] ?? null,
          motivo: item['motivo'] ?? null,
        };
      }),
      ...(avisos === undefined ? {} : { avisos }),
    },
  });
}

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

const CORPO_NAO_ENCONTRADO = {
  error: 'Pedido não encontrado',
  code: 'ORDER_NOT_FOUND',
  statusCode: 404,
};

const CORPO_ERRO_INTERNO = {
  error: 'Erro interno do servidor',
  code: 'INTERNAL_ERROR',
  statusCode: 500,
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
  let canais: { pedido_erp: string; faturamento: string; cadastro: string } | null = null;
  try {
    const lidos = await lerCanais(partner.company_id);
    canais = {
      pedido_erp: lidos.pedido_erp,
      faturamento: lidos.faturamento,
      cadastro: lidos.cadastro,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[parceiro] /status sem resposta do banco sobre os canais: ${msg}`);
    anotarChamada(request, { detalhe: { canais: 'nao_lidos' } });
  }

  await reply.send({
    ok: true,
    parceiro: partner.name,
    servidor_hora: new Date().toISOString(),
    // Quais mãos estão ligadas para a API nesta empresa. Aditivo.
    // `null` = o banco não respondeu agora; tente de novo.
    canais,
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
