import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { criarSupabaseFake } from './supabaseFake.js';

/**
 * O login precisa carregar as teclas do gerente para dentro do token — é de lá
 * que o guard lê, sem ir ao banco a cada requisição. E precisa carimbar o
 * último acesso sem segurar a resposta.
 */

const EMPRESA = 'empresa-1';
// bcrypt de "senha123", 10 rounds — igual ao que `hashPassword` gera.
const HASH = '$2b$10$QmybCZ1MSLkcX.qAQzIc6eh3g1zSgdCFlVfxntTCKd98lACMRCITa';

const GERENTE = {
  id: 'ger-1',
  company_id: EMPRESA,
  name: 'Gerente',
  email: 'gerente@csb.com',
  role: 'manager',
  active: true,
  password_hash: HASH,
  permissions: ['aprovar_pedidos'],
  last_login_at: null,
};

let app: FastifyInstance;
let fake: ReturnType<typeof criarSupabaseFake>;

beforeAll(async () => {
  fake = criarSupabaseFake({
    users: { data: GERENTE, error: null },
  });
  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));

  const { buildApp } = await import('../apps/api/src/app.js');
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app?.close();
});

const entrar = () =>
  app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: 'gerente@csb.com', password: 'senha123' },
  });

describe('login', () => {
  it('leva as teclas do gerente para dentro do token e para a resposta', async () => {
    const res = await entrar();

    expect(res.statusCode).toBe(200);
    const { data } = res.json() as { data: { token: string; user: { permissions: string[] } } };

    expect(data.user.permissions).toEqual(['aprovar_pedidos']);

    const corpo = JSON.parse(Buffer.from(data.token.split('.')[1]!, 'base64url').toString()) as {
      permissions: string[];
      role: string;
    };
    expect(corpo.role).toBe('manager');
    expect(corpo.permissions).toEqual(['aprovar_pedidos']);
  });

  it('carimba o último acesso', async () => {
    await entrar();
    const gravado = fake.ultimaGravacao('users', 'update');
    expect(gravado?.valores).toMatchObject({
      last_login_at: expect.any(String) as unknown as string,
    });
  });

  it('não devolve o hash da senha', async () => {
    const res = await entrar();
    expect(res.body).not.toContain('$2b$');
    expect(res.body).not.toContain('password_hash');
  });
});
