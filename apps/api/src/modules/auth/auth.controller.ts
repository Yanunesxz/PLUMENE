import type { FastifyRequest, FastifyReply } from 'fastify';
import type { AuthPayload, User } from '@csb/shared';
import { findUserByEmail, buildAuthPayload, getTokenConfig, upgradePasswordHash } from './auth.service.js';
import { verifyPassword, hashPassword } from '../../lib/password.js';
import { parseBody } from '../../lib/validation.js';
import { loginSchema, refreshTokenSchema } from './auth.schema.js';

export async function login(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = await parseBody(loginSchema, request.body, reply);
  if (!body) return;
  const { email, password } = body;

  const user = await findUserByEmail(email);
  const check = user ? await verifyPassword(password, user.password_hash) : { ok: false, legacy: false };
  if (!user || !check.ok) {
    await reply.status(401).send({
      error: 'Credenciais inválidas',
      code: 'INVALID_CREDENTIALS',
      statusCode: 401,
    });
    return;
  }

  // Migração suave: senha legada (SHA-256) vira bcrypt no primeiro login.
  if (check.legacy) {
    try {
      await upgradePasswordHash(user.id, await hashPassword(password));
    } catch {
      /* não bloqueia o login se a atualização falhar */
    }
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
        price_table_id: user.price_table_id ?? null,
        commission_rate: user.commission_rate ?? null,
        // A loja precisa do próprio customer_id no aparelho: é ele que vai no
        // pedido montado offline, quando não há token para o servidor resolver.
        customer_id: user.customer_id ?? null,
        rep_id: user.rep_id ?? null,
      },
    },
  });
}

export async function refreshToken(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = await parseBody(refreshTokenSchema, request.body, reply);
  if (!body) return;
  const { refresh_token } = body;

  try {
    const decoded = request.server.jwt.verify<{ sub: string; type: string }>(refresh_token);
    if (decoded.type !== 'refresh') throw new Error('Invalid token type');

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
