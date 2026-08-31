import type { FastifyRequest, FastifyReply } from 'fastify';
import { env } from '../../config/env.js';
import {
  pushConfigurado,
  salvarAssinatura,
  removerAssinatura,
  enviarParaUsuarios,
  type AssinaturaRecebida,
} from './push.service.js';

/** GET /push/chave-publica — o app pergunta se o push está ligado e pega a chave. */
export async function chavePublicaHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  await reply.send({ data: { chave: pushConfigurado() ? env.VAPID_PUBLIC_KEY : null } });
}

/** POST /push/assinar — o navegador registrou o aparelho; guardamos o endereço. */
export async function assinarHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, sub } = request.user;
  const body = request.body as Partial<AssinaturaRecebida> | null;
  if (!body?.endpoint || !body.keys?.p256dh || !body.keys.auth) {
    await reply.status(400).send({
      error: 'Assinatura incompleta — precisa de endpoint e das chaves p256dh/auth',
      code: 'INVALID_BODY',
      statusCode: 400,
    });
    return;
  }
  const gravou = await salvarAssinatura(
    company_id,
    sub,
    { endpoint: body.endpoint, keys: { p256dh: body.keys.p256dh, auth: body.keys.auth } },
    request.headers['user-agent'],
  );
  if (!gravou) {
    // Migração 034 ainda não rodou neste banco.
    await reply.status(503).send({
      error: 'Avisos ainda não habilitados neste servidor',
      code: 'PUSH_NAO_CONFIGURADO',
      statusCode: 503,
    });
    return;
  }
  await reply.send({ data: { ok: true } });
}

/** POST /push/desassinar — a pessoa desligou os avisos neste aparelho. */
export async function desassinarHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { sub } = request.user;
  const body = request.body as { endpoint?: string } | null;
  if (!body?.endpoint) {
    await reply.status(400).send({ error: 'Informe o endpoint', code: 'INVALID_BODY', statusCode: 400 });
    return;
  }
  await removerAssinatura(sub, body.endpoint);
  await reply.send({ data: { ok: true } });
}

/**
 * POST /push/teste — manda um aviso para os aparelhos DE QUEM CLICOU.
 * É a prova de fogo do cano inteiro: chave, assinatura, envio e entrega.
 */
export async function testeHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, sub } = request.user;
  if (!pushConfigurado()) {
    await reply.status(503).send({
      error: 'Push sem chaves no servidor (VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY)',
      code: 'PUSH_NAO_CONFIGURADO',
      statusCode: 503,
    });
    return;
  }
  const entregues = await enviarParaUsuarios(company_id, [sub], {
    title: 'Funcionou! 🔔',
    body: 'Os avisos estão ligados neste aparelho. Pedidos e faturamentos vão chegar por aqui.',
    url: '/orders',
    tag: 'teste',
  });
  await reply.send({ data: { entregues } });
}
