/**
 * A OUTRA MÃO dos cadastros e a exclusão avisada pelo Control (16/09/2026).
 *
 *   • GET /partner/v1/clientes?desde=        → o que mudou nos clientes no app
 *   • GET /partner/v1/representantes?desde=  → o que mudou nos representantes
 *   • POST /partner/v1/pedidos/:id/excluir   → o Control excluiu o pedido lá;
 *                                              o app exclui aqui (com a cópia)
 *
 * O Control PUXA as duas listas a cada ~5 min (e quando GET /status pedir
 * `sincronizar_agora`). As duas exigem o canal de cadastro em 'api'; a
 * exclusão exige o canal de pedidos em 'api'. Tudo com chave X-API-Key.
 * A porta (chave, canal, corpo, registro) está em partner.porta.ts.
 *
 * Desde 17/09/2026 cada cliente do GET leva `alterado_no_app` (051): a edição
 * do cadastro feita no app que o Control ainda não tem, com os campos nos
 * nomes deste contrato.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { anotarChamada } from './partner.chamada.js';
import { listarClientesAlterados, listarRepresentantesAlterados } from './partner.sync.service.js';
import { excluirPedidoPeloControl } from '../orders/exclusaoPeloControl.service.js';
import {
  CORPO_DESDE_INVALIDO,
  CORPO_ERRO_INTERNO,
  CORPO_NAO_ENCONTRADO,
  autenticar,
  lerDesde,
  recusouPorCanal,
  responder,
} from './partner.porta.js';

/**
 * Quanto o `servidor_hora` recua em relação à hora de antes da consulta.
 *
 * A hora de antes não basta (revisão de 17/09/2026): o `updated_at` de uma
 * gravação é carimbado ANTES de ela ser confirmada — a edição do cadastro
 * toma a hora da API e só então manda o UPDATE; a trigger da 013 usa o início
 * da transação, no relógio do banco. Um UPDATE que espera trava, fila do
 * PostgREST ou rede confirma DEPOIS de a puxada ter lido a lista, com um
 * `updated_at` ANTERIOR ao `servidor_hora` — e ficava de fora das duas
 * puxadas. Dois minutos cobrem essas esperas com sobra; o preço é o que mudou
 * nesse intervalo sair de novo na puxada seguinte, o que é inofensivo
 * (reenviar é `sem_mudanca`).
 */
export const FOLGA_DO_SERVIDOR_HORA_MS = 2 * 60_000;

/**
 * O `servidor_hora` de uma puxada — o `desde` que o Control manda na próxima.
 *
 * Tomado ANTES da consulta (17/09/2026) e recuado pela folga acima. Antes era
 * tomado depois: uma edição gravada enquanto a lista era lida (com
 * `updated_at` entre o início da leitura e a resposta) não entrava nesta lista
 * e ficava antes do `desde` da próxima — nunca saía. Com a hora de antes, menos
 * a folga, o pior caso é a mesma mudança sair mais de uma vez, o que é
 * inofensivo. (A lista paginada pela chave — `buscarPelaChaveOuFalhar` — fecha
 * o outro furo: o cliente empurrado para uma página já lida.)
 */
function horaDaPuxada(): string {
  return new Date(Date.now() - FOLGA_DO_SERVIDOR_HORA_MS).toISOString();
}

/** GET /partner/v1/clientes?desde=ISO — os clientes que mudaram no app */
export async function partnerClientesAlteradosHandler(
  request: FastifyRequest<{ Querystring: { desde?: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const partner = await autenticar(request, reply);
  if (!partner) return;
  if (await recusouPorCanal(request, reply, partner.company_id, 'cadastro')) return;

  const desde = lerDesde(request.query);
  if (desde === null) {
    await responder(request, reply, 400, CORPO_DESDE_INVALIDO);
    return;
  }

  // A hora ANTES da consulta, com folga (ver `horaDaPuxada`).
  const servidor_hora = horaDaPuxada();
  const { registros, avisos } = await listarClientesAlterados(partner.company_id, desde);
  const alteradosNoApp = registros.filter((c) => c.alterado_no_app).length;
  anotarChamada(request, {
    detalhe: {
      desde: desde ?? null,
      clientes: registros.length,
      novos_no_control: registros.filter((c) => c.novo_no_control).length,
      ...(alteradosNoApp > 0 ? { alterados_no_app: alteradosNoApp } : {}),
      ...(avisos.length > 0 ? { avisos: avisos.length } : {}),
    },
  });
  await reply.send({
    total: registros.length,
    servidor_hora,
    clientes: registros,
    avisos,
  });
}

/** GET /partner/v1/representantes?desde=ISO — os representantes que mudaram no app */
export async function partnerRepresentantesAlteradosHandler(
  request: FastifyRequest<{ Querystring: { desde?: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const partner = await autenticar(request, reply);
  if (!partner) return;
  if (await recusouPorCanal(request, reply, partner.company_id, 'cadastro')) return;

  const desde = lerDesde(request.query);
  if (desde === null) {
    await responder(request, reply, 400, CORPO_DESDE_INVALIDO);
    return;
  }

  // A hora ANTES da consulta, com folga (ver `horaDaPuxada`).
  const servidor_hora = horaDaPuxada();
  const { registros, avisos } = await listarRepresentantesAlterados(partner.company_id, desde);
  anotarChamada(request, {
    detalhe: {
      desde: desde ?? null,
      representantes: registros.length,
      ...(avisos.length > 0 ? { avisos: avisos.length } : {}),
    },
  });
  await reply.send({
    total: registros.length,
    servidor_hora,
    representantes: registros,
    avisos,
  });
}

/** O `motivo` do corpo, aparado; `null` quando não veio em texto. */
function motivoDoCorpo(corpo: unknown): string | null {
  const bruto =
    corpo && typeof corpo === 'object' && !Array.isArray(corpo) ? (corpo as { motivo?: unknown }).motivo : undefined;
  if (typeof bruto !== 'string') return null;
  const motivo = bruto.trim();
  return motivo === '' ? null : motivo.slice(0, 500);
}

/**
 * POST /partner/v1/pedidos/:id/excluir { motivo } — o Control excluiu o pedido
 * do lado dele e avisa; o app exclui aqui, com a cópia em deleted_orders e o
 * evento 'excluido' (origem api). É o único caminho que apaga um pedido com
 * número (pela tela ninguém pode) — e só apaga o que o Control tem: com número
 * dele, ou solicitado ao Control pelo financeiro.
 *
 *   200 { ok, excluido_em }   apagado
 *   404 ORDER_NOT_FOUND       não existe nesta empresa (ou já foi apagado)
 *   409 ORDER_INVOICED        faturado: desfaça o faturamento antes
 *   409 ORDER_NOT_IN_CONTROL  sem número do Control e não solicitado: o Control nunca o recebeu
 *   500 SEM_COPIA             a cópia da 040 não gravou — nada foi apagado
 *   500 INTERNAL_ERROR        o banco recusou apagar
 */
export async function partnerExcluirPedidoHandler(
  request: FastifyRequest<{ Params: { id: string }; Body: { motivo?: unknown } }>,
  reply: FastifyReply,
): Promise<void> {
  const partner = await autenticar(request, reply);
  if (!partner) return;
  if (await recusouPorCanal(request, reply, partner.company_id, 'pedido_erp')) return;

  const order_id = request.params.id;
  anotarChamada(request, { recebidos: 1, detalhe: { order_id } });
  const resultado = await excluirPedidoPeloControl(
    partner.company_id,
    order_id,
    partner.name,
    motivoDoCorpo(request.body),
  );

  switch (resultado.outcome) {
    case 'not_found':
      await responder(request, reply, 404, CORPO_NAO_ENCONTRADO);
      return;
    case 'faturado':
      await responder(request, reply, 409, {
        error: 'Pedido faturado não é excluído — desfaça o faturamento (POST /faturamento com "faturado": false) antes',
        code: 'ORDER_INVOICED',
        statusCode: 409,
      });
      return;
    case 'fora_do_control':
      await responder(request, reply, 409, {
        error:
          'Este pedido não está no Control (sem número do Control e não solicitado pelo financeiro) — o aplicativo não o exclui por aviso do Control',
        code: 'ORDER_NOT_IN_CONTROL',
        statusCode: 409,
      });
      return;
    case 'sem_copia':
      await responder(request, reply, 500, {
        error: 'A cópia do pedido excluído não foi gravada — o pedido NÃO foi apagado; tente de novo',
        code: 'SEM_COPIA',
        statusCode: 500,
      });
      return;
    case 'falhou':
      await responder(request, reply, 500, {
        error: `Falha ao excluir o pedido: ${resultado.erro}`,
        code: 'INTERNAL_ERROR',
        statusCode: 500,
      });
      return;
    case 'ok':
      anotarChamada(request, { gravados: 1, detalhe: { pedido_erp: resultado.pedido_erp, numero: resultado.numero } });
      await reply.send({ ok: true, excluido_em: resultado.excluido_em });
      return;
    default:
      await responder(request, reply, 500, CORPO_ERRO_INTERNO);
  }
}
