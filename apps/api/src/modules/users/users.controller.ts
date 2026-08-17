import type { FastifyRequest, FastifyReply } from 'fastify';
import type { CriarUsuarioRequest, AtualizarUsuarioRequest } from '@csb/shared';
import {
  listUsuarios,
  criarUsuario,
  atualizarUsuario,
  excluirUsuario,
  type MotivoUsuario,
} from './users.service.js';

/**
 * Sem a 022 aplicada, as teclas não têm onde ser gravadas. Dizer "salvo" sem
 * avisar faria o admin sair da tela achando que limitou um gerente que continua
 * com tudo — exatamente o engano que este recurso existe para evitar.
 */
const AVISO_MIGRACAO =
  'Salvo, mas as permissões NÃO foram gravadas: a migração 022 ainda não foi aplicada no banco.';

const RESPOSTA: Record<MotivoUsuario, { status: number; code: string; error: string }> = {
  nao_encontrado: { status: 404, code: 'NOT_FOUND', error: 'Login não encontrado.' },
  email_em_uso: { status: 409, code: 'EMAIL_TAKEN', error: 'Já existe um usuário com esse e-mail.' },
  proprio_login: {
    status: 409,
    code: 'PROPRIO_LOGIN',
    error:
      'Você não pode bloquear, excluir nem rebaixar o seu próprio login — ficaria sem ninguém para desfazer. Peça a outro administrador.',
  },
  ultimo_admin: {
    status: 409,
    code: 'ULTIMO_ADMIN',
    error:
      'Este é o único administrador ativo da empresa. Promova outro antes de bloquear ou excluir este.',
  },
  tem_pedidos: { status: 409, code: 'HAS_ORDERS', error: 'Login com pedidos no histórico.' },
  papel_invalido: {
    status: 400,
    code: 'VALIDATION_ERROR',
    error: 'Papel ou permissão inválidos. Por aqui criam-se administradores, gerentes e financeiro.',
  },
  erro: { status: 500, code: 'ERRO', error: 'Não foi possível concluir a operação.' },
};

async function recusar(reply: FastifyReply, motivo: MotivoUsuario, detalhe?: string): Promise<void> {
  const r = RESPOSTA[motivo];
  await reply.status(r.status).send({
    error: detalhe ?? r.error,
    code: r.code,
    statusCode: r.status,
  });
}

export async function listarUsuariosHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  await reply.send({ data: await listUsuarios(request.user.company_id) });
}

export async function criarUsuarioHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const body = request.body as CriarUsuarioRequest;

  if (!body?.name?.trim() || !body?.email?.trim() || !body?.password || !body?.role) {
    await reply.status(400).send({
      error: 'Campos obrigatórios: nome, e-mail, senha e papel.',
      code: 'VALIDATION_ERROR',
      statusCode: 400,
    });
    return;
  }

  const r = await criarUsuario(request.user.company_id, body);
  if (!r.ok) {
    await recusar(reply, r.motivo);
    return;
  }
  await reply.status(201).send({
    data: r.usuario,
    ...(r.teclas_ignoradas ? { aviso: AVISO_MIGRACAO } : {}),
  });
}

export async function atualizarUsuarioHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { company_id, sub } = request.user;
  const { id } = request.params as { id: string };

  const r = await atualizarUsuario(company_id, sub, id, request.body as AtualizarUsuarioRequest);
  if (!r.ok) {
    await recusar(reply, r.motivo);
    return;
  }
  await reply.send({
    data: r.usuario,
    ...(r.teclas_ignoradas ? { aviso: AVISO_MIGRACAO } : {}),
  });
}

export async function excluirUsuarioHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { company_id, sub } = request.user;
  const { id } = request.params as { id: string };

  const r = await excluirUsuario(company_id, sub, id);
  if (!r.ok) {
    await recusar(
      reply,
      r.motivo,
      r.motivo === 'tem_pedidos'
        ? `Este login tem ${r.pedidos} pedido(s) no histórico e não pode ser excluído — o histórico de vendas depende dele. Bloqueie o acesso em vez de excluir.`
        : undefined,
    );
    return;
  }
  await reply.send({ data: { ok: true, clientes_sem_representante: r.clientes_sem_representante } });
}
