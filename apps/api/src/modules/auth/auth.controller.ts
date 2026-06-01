import type { FastifyRequest, FastifyReply } from 'fastify';
import { createHash } from 'crypto';
import type { LoginRequest, AuthPayload, User } from '@csb/shared';
import { findUserByEmail, buildAuthPayload, getTokenConfig } from './auth.service.js';

function hashPassword(password: string): string {
  return createHash('sha256').update(password).digest('hex');
}

export async function login(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { email, password } = request.body as LoginRequest;

  if (!email || !password) {
    await reply.status(400).send({
      error: 'Email e senha são obrigatórios',
      code: 'VALIDATION_ERROR',
      statusCode: 400,
    });
    return;
  }

  const user = await findUserByEmail(email);
  if (!user || user.password_hash !== hashPassword(password)) {
    await reply.status(401).send({
      error: 'Credenciais inválidas',
      code: 'INVALID_CREDENTIALS',
      statusCode: 401,
    });
    return;
  }

  const payload = buildAuthPayload(user);
  const config = getTokenConfig();
  const token = request.server.jwt.sign(payload, { expiresIn: config.expiresIn });
  const refresh_token = request.server.jwt.sign(
    // refresh tokens use a custom shape that differs from AuthPayload
    { sub: user.id, type: 'refresh' } as unknown as AuthPayload,
    { expiresIn: config.refreshExpiresIn },
  );

  await reply.send({
    data: {
      token,
      refresh_token,
      user: {
        id: user.id,
        company_id: user.company_id,
        name: user.name,
        email: user.email,
        role: user.role,
        active: user.active,
      },
    },
  });
}

export async function refreshToken(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { refresh_token } = request.body as { refresh_token: string };

  if (!refresh_token) {
    await reply.status(400).send({
      error: 'refresh_token é obrigatório',
      code: 'VALIDATION_ERROR',
      statusCode: 400,
    });
    return;
  }

  try {
    const decoded = request.server.jwt.verify<{ sub: string; type: string }>(refresh_token);
    if (decoded.type !== 'refresh') throw new Error('Invalid token type');

    const user = await findUserByEmail('');
    if (!user) {
      await reply.status(401).send({
        error: 'Usuário não encontrado',
        code: 'USER_NOT_FOUND',
        statusCode: 401,
      });
      return;
    }

    const { data: userData, error } = await (
      await import('../../config/supabase.js')
    ).supabase
      .from('users')
      .select('*')
      .eq('id', decoded.sub)
      .eq('active', true)
      .single();

    if (error || !userData) {
      await reply.status(401).send({
        error: 'Usuário não encontrado ou inativo',
        code: 'USER_NOT_FOUND',
        statusCode: 401,
      });
      return;
    }

    const payload = buildAuthPayload(userData as User);
    const config = getTokenConfig();
    const token = request.server.jwt.sign(payload, { expiresIn: config.expiresIn });

    await reply.send({ data: { token } });
  } catch {
    await reply.status(401).send({
      error: 'Refresh token inválido ou expirado',
      code: 'INVALID_REFRESH_TOKEN',
      statusCode: 401,
    });
  }
}
