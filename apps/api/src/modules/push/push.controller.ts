import type { FastifyRequest, FastifyReply } from 'fastify';
import { env } from '../../config/env.js';
import {
  pushConfigurado,
  salvarAssinatura,
  removerAssinatura,
  enviarParaUsuarios,
  resolverPublico,
  type AssinaturaRecebida,
  type PublicoDoAviso,
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

const PUBLICOS: PublicoDoAviso[] = ['todos', 'reps', 'lojas', 'lojas_compraram', 'escritorio'];

/**
 * POST /push/enviar — o aviso manual da fábrica (promoção, coleção nova,
 * recado geral). Só gerente/admin (portão no router). O corpo diz título,
 * mensagem, para quem e o que abre no toque.
 */
export async function enviarAvisoHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id } = request.user;
  if (!pushConfigurado()) {
    await reply.status(503).send({
      error: 'Push sem chaves no servidor (VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY)',
      code: 'PUSH_NAO_CONFIGURADO',
      statusCode: 503,
    });
    return;
  }

  const body = request.body as {
    title?: string;
    body?: string;
    url?: string;
    publico?: string;
    dias?: number;
  } | null;

  const titulo = body?.title?.trim() ?? '';
  const mensagem = body?.body?.trim() ?? '';
  if (titulo.length < 2 || titulo.length > 80) {
    await reply.status(400).send({ error: 'Título entre 2 e 80 letras', code: 'VALIDATION_ERROR', statusCode: 400 });
    return;
  }
  if (mensagem.length < 2 || mensagem.length > 200) {
    await reply.status(400).send({ error: 'Mensagem entre 2 e 200 letras', code: 'VALIDATION_ERROR', statusCode: 400 });
    return;
  }
  if (!PUBLICOS.includes(body?.publico as PublicoDoAviso)) {
    await reply.status(400).send({ error: 'Escolha o público do aviso', code: 'VALIDATION_ERROR', statusCode: 400 });
    return;
  }

  // O toque abre uma ROTA do app, nunca um endereço de fora — aviso não é
  // canal para link externo.
  const url = body?.url && body.url.startsWith('/') ? body.url : '/catalog';
  const dias = Math.min(365, Math.max(1, Math.round(body?.dias ?? 90)));

  const pessoas = await resolverPublico(company_id, body!.publico as PublicoDoAviso, dias);
  const aparelhos = await enviarParaUsuarios(company_id, pessoas, {
    title: titulo,
    body: mensagem,
    url,
    tag: `aviso-${Date.now()}`,
  });

  await reply.send({ data: { pessoas: pessoas.length, aparelhos } });
}
