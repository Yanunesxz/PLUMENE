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

  const { registros, avisos } = await listarClientesAlterados(partner.company_id, desde);
  anotarChamada(request, {
    detalhe: {
      desde: desde ?? null,
      clientes: registros.length,
      novos_no_control: registros.filter((c) => c.novo_no_control).length,
      ...(avisos.length > 0 ? { avisos: avisos.length } : {}),
    },
  });
  await reply.send({
    total: registros.length,
    servidor_hora: new Date().toISOString(),
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
    servidor_hora: new Date().toISOString(),
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
 * evento 'excluido_pelo_erp'. Funciona mesmo com número do Control (é o único
 * caminho que apaga um pedido com número: pela tela ninguém pode).
 *
 *   200 { ok, excluido_em }   apagado
 *   404 ORDER_NOT_FOUND       não existe nesta empresa (ou já foi apagado)
 *   409 ORDER_INVOICED        faturado: desfaça o faturamento antes
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
