import type { FastifyRequest, FastifyReply } from 'fastify';
import type { AuthPayload } from '@csb/shared';
import { env } from '../../config/env.js';
import { supabase } from '../../config/supabase.js';
import { parseBody } from '../../lib/validation.js';
import { criarConviteSchema, criarVitrineSchema, aceitarConviteSchema } from './access.schema.js';
import {
  criarConvite,
  abrirConvite,
  usarConvite,
  listarConvites,
  revogarConvite,
} from './invites.service.js';
import {
  criarVitrine,
  abrirVitrine,
  listarVitrines,
  revogarVitrine,
} from './showcase.service.js';
import { montarMinhaArea } from './loja.service.js';
import { resolverTabelaEscolhida } from '../reps/reps.service.js';
import { buildAuthPayload, getTokenConfig } from '../auth/auth.service.js';
import type { User } from '@csb/shared';

/**
 * O link que vai para a pessoa. `APP_URL` aponta para o front; sem ele
 * configurado, cai na primeira origem do CORS, que em produção é o próprio app.
 */
function baseDoApp(): string {
  return (process.env['APP_URL'] ?? env.CORS_ORIGIN[0] ?? '').replace(/\/+$/, '');
}

// ─── Convite (representante) ─────────────────────────────────────────────────

export async function criarConviteHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, sub, role, erp_rep_id } = request.user;
  const body = await parseBody(criarConviteSchema, request.body, reply);
  if (!body) return;

  const resultado = await criarConvite(company_id, sub, body.customer_id, {
    erp_rep_id: erp_rep_id ?? null,
    irrestrito: role === 'manager' || role === 'admin',
  });

  if (!resultado.ok) {
    const mensagens: Record<string, [number, string]> = {
      cliente_nao_encontrado: [404, 'Cliente não encontrado na sua carteira'],
      ja_tem_login: [409, 'Esta loja já tem acesso criado'],
      convite_pendente: [409, 'Já existe um convite pendente para esta loja'],
      erro: [500, 'Não foi possível criar o convite'],
    };
    const [status, mensagem] = mensagens[resultado.motivo] ?? [500, 'Erro'];
    await reply.status(status).send({ error: mensagem, code: resultado.motivo.toUpperCase(), statusCode: status });
    return;
  }

  await reply.status(201).send({
    data: {
      id: resultado.convite.id,
      url: `${baseDoApp()}/convite/${resultado.convite.token}`,
      expires_at: resultado.convite.expires_at,
    },
  });
}

export async function listarConvitesHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, sub } = request.user;
  await reply.send({ data: await listarConvites(company_id, sub) });
}

export async function revogarConviteHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, sub } = request.user;
  const { id } = request.params as { id: string };
  const ok = await revogarConvite(id, company_id, sub);
  if (!ok) {
    await reply.status(404).send({ error: 'Convite não encontrado ou já usado', code: 'NOT_FOUND', statusCode: 404 });
    return;
  }
  await reply.send({ data: { ok: true } });
}

// ─── Vitrine (representante) ─────────────────────────────────────────────────

export async function criarVitrineHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, sub, role, price_table_id } = request.user;
  const body = await parseBody(criarVitrineSchema, request.body, reply);
  if (!body) return;

  // Mesma revalidação do cadastro de cliente: o link mostra preço, e mostrar o
  // preço errado a um desconhecido é o mesmo estrago sem ninguém para conferir.
  const tabela = await resolverTabelaEscolhida(company_id, sub, role, body.price_table_id);
  if (!tabela.ok) {
    if (tabela.motivo === 'escolha_obrigatoria') {
      await reply.status(400).send({
        error: 'Escolha a tabela de preço do link.',
        code: 'PRICE_TABLE_REQUIRED',
        statusCode: 400,
      });
      return;
    }
    await reply.status(403).send({
      error: 'Esta tabela de preço não está disponível para você.',
      code: 'FORBIDDEN',
      statusCode: 403,
    });
    return;
  }

  let vitrine;
  try {
    vitrine = await criarVitrine(company_id, sub, tabela.price_table_id ?? price_table_id ?? null, body.hours);
  } catch (err) {
    if (err instanceof Error && err.message === 'ACESSO_INDISPONIVEL') {
      request.log.error('Vitrine indisponível: migração 014 não aplicada');
      await reply.status(503).send({
        error: 'Os links de acesso ainda não foram liberados no sistema.',
        code: 'UNAVAILABLE',
        statusCode: 503,
      });
      return;
    }
    throw err;
  }
  if (!vitrine) {
    await reply.status(500).send({ error: 'Não foi possível criar o link', code: 'CREATE_FAILED', statusCode: 500 });
    return;
  }

  await reply.status(201).send({
    data: {
      id: vitrine.id,
      url: `${baseDoApp()}/vitrine/${vitrine.token}`,
      expires_at: vitrine.expires_at,
    },
  });
}

export async function listarVitrinesHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, sub } = request.user;
  await reply.send({ data: await listarVitrines(company_id, sub) });
}

export async function revogarVitrineHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, sub } = request.user;
  const { id } = request.params as { id: string };
  const ok = await revogarVitrine(id, company_id, sub);
  if (!ok) {
    await reply.status(404).send({ error: 'Link não encontrado ou já revogado', code: 'NOT_FOUND', statusCode: 404 });
    return;
  }
  await reply.send({ data: { ok: true } });
}

// ─── Públicas ────────────────────────────────────────────────────────────────

const MOTIVO_CONVITE: Record<string, string> = {
  invalido: 'Este link não é válido. Peça um novo ao seu representante.',
  expirado: 'Este convite expirou. Peça um novo ao seu representante.',
  usado: 'Este convite já foi usado. Entre com o e-mail e a senha que você criou.',
  revogado: 'Este convite foi cancelado. Fale com o seu representante.',
};

export async function abrirConviteHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { token } = request.params as { token: string };
  const abertura = await abrirConvite(token);

  if (!abertura.ok) {
    await reply.status(410).send({
      error: MOTIVO_CONVITE[abertura.motivo],
      code: abertura.motivo.toUpperCase(),
      statusCode: 410,
    });
    return;
  }

  await reply.send({
    data: {
      customer_name: abertura.customer_name,
      company_name: abertura.company_name,
      nome_sugerido: abertura.nome_sugerido,
    },
  });
}

export async function aceitarConviteHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { token } = request.params as { token: string };
  const body = await parseBody(aceitarConviteSchema, request.body, reply);
  if (!body) return;

  const resultado = await usarConvite(token, body.email, body.password, body.name);
  if (!resultado.ok) {
    if (resultado.motivo === 'email_em_uso') {
      await reply.status(409).send({
        error: 'Este e-mail já está em uso. Escolha outro.',
        code: 'EMAIL_TAKEN',
        statusCode: 409,
      });
      return;
    }
    if (resultado.motivo === 'erro') {
      await reply.status(500).send({ error: 'Não foi possível criar o acesso', code: 'CREATE_FAILED', statusCode: 500 });
      return;
    }
    await reply.status(410).send({
      error: MOTIVO_CONVITE[resultado.motivo],
      code: resultado.motivo.toUpperCase(),
      statusCode: 410,
    });
    return;
  }

  // Já entra: a loja acabou de provar quem é definindo a senha.
  const { data: usuario } = await supabase
    .from('users')
    .select('*')
    .eq('id', resultado.user_id)
    .single();

  const payload = buildAuthPayload(usuario as User);
  const config = getTokenConfig();
  const jwt = request.server.jwt.sign(payload, { expiresIn: config.expiresIn });
  const refresh = request.server.jwt.sign(
    { sub: resultado.user_id, type: 'refresh' } as unknown as AuthPayload,
    { expiresIn: config.refreshExpiresIn },
  );

  await reply.status(201).send({
    data: {
      token: jwt,
      refresh_token: refresh,
      user: {
        id: resultado.user_id,
        company_id: payload.company_id,
        name: payload.name,
        email: payload.email,
        role: payload.role,
        active: true,
        price_table_id: payload.price_table_id ?? null,
        customer_id: payload.customer_id ?? null,
        rep_id: payload.rep_id ?? null,
      },
    },
  });
}

export async function abrirVitrineHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { token } = request.params as { token: string };
  const abertura = await abrirVitrine(token);

  if (!abertura.ok) {
    const mensagens: Record<string, string> = {
      invalido: 'Este link não é válido. Peça um novo ao seu representante.',
      expirado: 'Este link expirou. Peça um novo ao seu representante.',
      revogado: 'Este link foi encerrado. Fale com o seu representante.',
    };
    await reply.status(410).send({
      error: mensagens[abertura.motivo],
      code: abertura.motivo.toUpperCase(),
      statusCode: 410,
    });
    return;
  }

  const { link } = abertura;

  const { data: rep } = await supabase
    .from('users')
    .select('name')
    .eq('id', link.rep_id)
    .maybeSingle();

  // O token morre junto com o link: `exp` é o próprio `expires_at`. Assim um
  // token já emitido não sobrevive ao vencimento nem à revogação do link.
  const segundos = Math.max(60, Math.floor((new Date(link.expires_at).getTime() - Date.now()) / 1000));
  const payload: AuthPayload = {
    sub: link.id,
    email: '',
    role: 'guest',
    company_id: link.company_id,
    name: 'Visitante',
    price_table_id: link.price_table_id,
    rep_id: link.rep_id,
    customer_id: null,
  };

  await reply.send({
    data: {
      token: request.server.jwt.sign(payload, { expiresIn: segundos }),
      expires_at: link.expires_at,
      rep_name: (rep as { name: string } | null)?.name ?? '',
    },
  });
}

// ─── Conta da loja ───────────────────────────────────────────────────────────

/**
 * O que a loja vê de si mesma. Só leitura: CNPJ, tabela e limite saem do ERP, e
 * deixar a loja editar criaria divergência com o que o faturamento enxerga.
 */
export async function minhaContaHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { customer_id, rep_id } = request.user;
  if (!customer_id) {
    await reply.status(403).send({ error: 'Acesso sem loja vinculada', code: 'FORBIDDEN', statusCode: 403 });
    return;
  }

  // Sem `price_table_id`: qual tabela a loja está não sai daqui nem no payload.
  // Saber que está na "TABELA 03" é saber que existem 01 e 02 — conversa para
  // ter com o representante, não informação de tela.
  const { data: cliente } = await supabase
    .from('customers')
    .select('name, trade_name, cnpj, whatsapp')
    .eq('id', customer_id)
    .maybeSingle();

  if (!cliente) {
    await reply.status(404).send({ error: 'Cadastro não encontrado', code: 'NOT_FOUND', statusCode: 404 });
    return;
  }

  const c = cliente as {
    name: string;
    trade_name: string | null;
    cnpj: string | null;
    whatsapp: string | null;
  };

  const { data: rep } = rep_id
    ? await supabase.from('users').select('name, phone').eq('id', rep_id).maybeSingle()
    : { data: null };

  const repDados = rep as { name: string; phone: string | null } | null;

  await reply.send({
    data: {
      name: c.name,
      trade_name: c.trade_name,
      cnpj: c.cnpj,
      whatsapp: c.whatsapp,
      rep_name: repDados?.name ?? null,
      rep_whatsapp: repDados?.phone ?? null,
    },
  });
}

/**
 * O painel da loja: conta + histórico + o que ela mais compra.
 *
 * Uma resposta só. A tela abre em campo, muitas vezes com sinal ruim, e cada
 * requisição a mais é uma chance de a tela ficar pela metade.
 */
export async function minhaAreaHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, customer_id, rep_id } = request.user;
  if (!customer_id) {
    await reply.status(403).send({ error: 'Acesso sem loja vinculada', code: 'FORBIDDEN', statusCode: 403 });
    return;
  }

  const area = await montarMinhaArea(company_id, customer_id, rep_id);
  if (!area) {
    await reply.status(404).send({ error: 'Cadastro não encontrado', code: 'NOT_FOUND', statusCode: 404 });
    return;
  }

  await reply.send({ data: area });
}
