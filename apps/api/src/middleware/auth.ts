import type { FastifyRequest, FastifyReply } from 'fastify';
import type { AuthPayload, AuthRole, PermissaoGerente } from '@csb/shared';
import { temPermissao } from '@csb/shared';

// Augmenta @fastify/jwt para tipar request.user como AuthPayload
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AuthPayload;
    user: AuthPayload;
  }
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    await reply.status(401).send({
      error: 'Token inválido ou expirado',
      code: 'UNAUTHORIZED',
      statusCode: 401,
    });
    return;
  }

  // Refresh tokens (assinados com o mesmo segredo) só valem em /auth/refresh —
  // nunca como token de acesso a rotas protegidas.
  if ((request.user as { type?: string }).type === 'refresh') {
    await reply.status(401).send({
      error: 'Token inválido ou expirado',
      code: 'UNAUTHORIZED',
      statusCode: 401,
    });
  }
}

export function requireRole(roles: AuthRole[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user || !roles.includes(request.user.role)) {
      await reply.status(403).send({
        error: 'Acesso negado para este papel',
        code: 'FORBIDDEN',
        statusCode: 403,
      });
    }
  };
}

/**
 * Exige uma tecla do gerente. Vai DEPOIS do `requireRole` da rota, nunca no
 * lugar dele: quem entra é decisão do papel, e a tecla só estreita isso para o
 * gerente.
 *
 * `temPermissao` deixa passar quem não é gerente de propósito — é o que mantém a
 * triagem do representante viva em `PATCH /orders/:id/status`, que é a mesma
 * rota que o gerente usa para aprovar.
 */
export function requirePermission(tecla: PermissaoGerente) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const usuario = request.user;
    if (!usuario || !temPermissao(usuario.role, usuario.permissions ?? null, tecla)) {
      await reply.status(403).send({
        error: 'Seu acesso não inclui esta ação. Fale com o administrador.',
        code: 'PERMISSAO_NEGADA',
        statusCode: 403,
      });
    }
  };
}
