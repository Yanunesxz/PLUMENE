import type { FastifyRequest, FastifyReply } from 'fastify';
import { anotarChamada } from './partner.chamada.js';
import { autenticar, momentoComFuso } from './partner.porta.js';
import { concluirSincronizacao } from '../integracao/integracao.service.js';
import { pedidoDeSyncExpirado } from '../integracao/expiracaoDoSync.js';

/**
 * POST /partner/v1/sincronizacao { concluida: true } — o Control avisa que
 * rodou tudo (a passada que o `sincronizar_agora: true` do `/status` pediu) e
 * o pedido pendente é limpo (companies.sync_solicitado_em, migração 049).
 *
 * Sempre liberada (não depende de canal): é sinal de controle, não dado.
 * Sem pedido pendente, responde 200 sem gravar nada. `solicitado_em` é
 * opcional: o momento que o Control viu no `/status`; um pedido mais novo que
 * ele fica de pé (alguém clicou de novo enquanto o Control rodava).
 *
 * Registrada no partnerRouter como POST /partner/v1/sincronizacao.
 */

export async function partnerSincronizacaoHandler(
  request: FastifyRequest<{ Body: unknown }>,
  reply: FastifyReply,
): Promise<void> {
  const partner = await autenticar(request, reply);
  if (!partner) return;

  const corpo =
    request.body && typeof request.body === 'object' && !Array.isArray(request.body)
      ? (request.body as Record<string, unknown>)
      : {};

  if (corpo['concluida'] !== true) {
    anotarChamada(request, { detalhe: { code: 'MISSING_CONCLUIDA' } });
    await reply.status(400).send({
      error: 'Informe "concluida": true — este aviso diz que a sincronização pedida foi feita',
      code: 'MISSING_CONCLUIDA',
      statusCode: 400,
    });
    return;
  }

  const bruto = corpo['solicitado_em'];
  let solicitado_em: string | undefined;
  if (bruto != null) {
    if (typeof bruto !== 'string' || !momentoComFuso(bruto)) {
      anotarChamada(request, { detalhe: { code: 'INVALID_SOLICITADO_EM' } });
      await reply.status(400).send({
        error: 'solicitado_em deve ser um momento ISO com fuso (ex.: 2026-09-16T14:00:00Z), o que veio no /status',
        code: 'INVALID_SOLICITADO_EM',
        statusCode: 400,
      });
      return;
    }
    solicitado_em = bruto;
  }

  const r = await concluirSincronizacao(partner.company_id, { solicitado_em });

  anotarChamada(request, {
    recebidos: 1,
    gravados: r.limpo ? 1 : 0,
    sem_mudanca: r.limpo ? 0 : 1,
    detalhe: { limpo: r.limpo, migracao: r.migracao, pendente: r.pendente != null },
  });
  await reply.send({
    ok: true,
    limpo: r.limpo,
    // O que o Control veria num /status logo depois: `true` = há pedido novo e
    // ainda dentro dos 15 minutos (expiracaoDoSync.ts, a mesma regra do /status).
    sincronizar_agora: r.pendente != null && !pedidoDeSyncExpirado(r.pendente),
    solicitado_em: r.pendente,
    servidor_hora: new Date().toISOString(),
  });
}
