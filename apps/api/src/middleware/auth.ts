import type { FastifyRequest, FastifyReply } from 'fastify';
import type { AuthPayload, UserRole } from '@csb/shared';

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
  }
}

export function requireRole(roles: UserRole[]) {
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
