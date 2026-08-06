import type { FastifyRequest, FastifyReply } from 'fastify';
import type { AuthPayload, User } from '@csb/shared';
import {
  findUserByEmail,
  buildAuthPayload,
  getTokenConfig,
  upgradePasswordHash,
  registrarAcesso,
} from './auth.service.js';
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

  // Sem `await`: o carimbo não pode atrasar a entrada de ninguém.
  void registrarAcesso(user.id);

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
        // O web esconde botão pelas teclas; sem elas na resposta, o gerente veria
        // botão que a API recusa.
        permissions: user.permissions ?? null,
        last_login_at: user.last_login_at ?? null,
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

    // O usuário volta junto do token: quando o admin mexe nas teclas de alguém,
    // o servidor passa a negar na hora do refresh, mas a tela continuaria
    // mostrando os botões antigos até a pessoa deslogar. Campo novo — cliente
    // antigo que só lê `token` continua funcionando.
    const u = userData as User;
    await reply.send({
      data: {
        token,
        user: {
          id: u.id,
          company_id: u.company_id,
          name: u.name,
          email: u.email,
          role: u.role,
          active: u.active,
          price_table_id: u.price_table_id ?? null,
          commission_rate: u.commission_rate ?? null,
          customer_id: u.customer_id ?? null,
          rep_id: u.rep_id ?? null,
          permissions: u.permissions ?? null,
          last_login_at: u.last_login_at ?? null,
        },
      },
    });
  } catch {
    await reply.status(401).send({
      error: 'Refresh token inválido ou expirado',
      code: 'INVALID_REFRESH_TOKEN',
      statusCode: 401,
    });
  }
}
