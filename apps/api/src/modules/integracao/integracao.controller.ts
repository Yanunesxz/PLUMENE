import type { FastifyRequest, FastifyReply } from 'fastify';
import { lerEstadoDaIntegracao, pedirSincronizacao } from './integracao.service.js';

/**
 * GET /erp/integracao/status — o estado da integração com o Control, para a
 * tela. Tudo pela empresa do token; nunca o `detalhe` do registro, nunca linha
 * de pedido. Cada bloco que não deu para ler vem `null` com uma frase em
 * `avisos` — a tela mostra o que conseguiu.
 */
export async function statusDaIntegracaoHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const estado = await lerEstadoDaIntegracao(request.user.company_id);
  await reply.send({ data: estado });
}

/**
 * PATCH /erp/integracao/sincronizar — "Pedir sincronização agora".
 *
 * Grava o carimbo em `companies` (049). Com pedido já pendente, devolve o que
 * está lá sem gravar (`ja_solicitado: true`). Sem a 049 no banco, 503 com o
 * código que a tela sabe explicar.
 */
export async function pedirSincronizacaoHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const r = await pedirSincronizacao(request.user.company_id, {
    id: request.user.sub,
    nome: request.user.name,
  });
  if (!r.ok) {
    await reply.status(503).send({
      error: 'A migração 049 ainda não rodou neste banco — o pedido de sincronização ainda não tem onde ficar.',
      code: 'MIGRACAO_PENDENTE',
      statusCode: 503,
    });
    return;
  }
  await reply.send({ data: { ja_solicitado: r.ja_solicitado, solicitacao: r.solicitacao } });
}
