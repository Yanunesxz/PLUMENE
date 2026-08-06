import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { criarSupabaseFake } from './supabaseFake.js';

/**
 * O controle de logins pelo admin, com foco nas trancas.
 *
 * A pior falha possível aqui não é um 500: é o admin conseguir se bloquear, ou
 * bloquear o último admin da fábrica. Nesse estado ninguém mais entra para
 * desfazer, e não existe tela para consertar — só SQL no Supabase.
 */

const EMPRESA = 'empresa-1';
const SEGREDO = 'segredo-de-teste-nao-usar-em-producao';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

function assinar(payload: Record<string, unknown>): string {
  const cabecalho = b64({ alg: 'HS256', typ: 'JWT' });
  const agora = Math.floor(Date.now() / 1000);
  const corpo = b64({ ...payload, iat: agora, exp: agora + 3600 });
  const assinatura = crypto
    .createHmac('sha256', SEGREDO)
    .update(`${cabecalho}.${corpo}`)
    .digest('base64url');
  return `${cabecalho}.${corpo}.${assinatura}`;
}

const base = { email: 'x@csb.com', company_id: EMPRESA, name: 'Teste', price_table_id: null };
const TOKEN = {
  admin: assinar({ ...base, sub: 'adm-1', role: 'admin' }),
  gerente: assinar({ ...base, sub: 'ger-1', role: 'manager' }),
  rep: assinar({ ...base, sub: 'rep-1', role: 'rep' }),
  loja: assinar({ ...base, sub: 'loja-1', role: 'store', customer_id: 'c-1', rep_id: 'rep-1' }),
};

const ADMIN_LOGADO = {
  id: 'adm-1',
  company_id: EMPRESA,
  name: 'Admin Sistema',
  email: 'admin@csb.com',
  role: 'admin',
  active: true,
  password_hash: '$2b$10$naoDeveVazarNunca',
  permissions: null,
  last_login_at: '2026-08-05T12:00:00.000Z',
  created_at: '2026-01-01T00:00:00.000Z',
};

const OUTRO_ADMIN = { ...ADMIN_LOGADO, id: 'adm-2', email: 'admin2@csb.com', name: 'Segundo Admin' };
const GERENTE = {
  ...ADMIN_LOGADO,
  id: 'ger-1',
  email: 'gerente@csb.com',
  name: 'Gerente',
  role: 'manager',
  permissions: null,
};

const abertos: FastifyInstance[] = [];

/**
 * O dublê consome DUAS entradas da fila por consulta — uma no `from()` e outra
 * na entrega. Sem isto, uma fila de três respostas atende só duas consultas, e a
 * segunda recebe a resposta da terceira: foi assim que "criar gerente" apanhou
 * um 409 de e-mail repetido usando a linha que era do insert.
 *
 * Aqui a fila descreve as consultas na ordem em que o service as faz, e a
 * duplicação de cada uma cuida do consumo interno do dublê.
 */
const naOrdem = (
  ...respostas: Array<{ data: unknown; error: null; count?: number | null }>
): Array<{ data: unknown; error: null; count?: number | null }> =>
  respostas.flatMap((r) => [r, r]);

/** Monta o app com as respostas que o teste precisa naquele caso. */
async function comBanco(respostas: Parameters<typeof criarSupabaseFake>[0]) {
  vi.resetModules();
  const fake = criarSupabaseFake(respostas);
  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
  const { buildApp } = await import('../apps/api/src/app.js');
  const app = await buildApp();
  await app.ready();
  abertos.push(app);
  return { app, fake };
}

afterAll(async () => {
  await Promise.all(abertos.map((a) => a.close()));
});

const chamar = (
  app: FastifyInstance,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  token: string,
  payload?: unknown,
) =>
  app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}` },
    ...(payload ? { payload } : {}),
  });

describe('só o admin entra', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    ({ app } = await comBanco({ users: { data: [], error: null } }));
  });

  it.each([
    ['gerente', TOKEN.gerente],
    ['representante', TOKEN.rep],
    ['loja', TOKEN.loja],
  ])('%s recebe 403 em GET /usuarios', async (_papel, token) => {
    expect((await chamar(app, 'GET', '/usuarios', token)).statusCode).toBe(403);
  });

  it('sem token, 401', async () => {
    expect((await app.inject({ method: 'GET', url: '/usuarios' })).statusCode).toBe(401);
  });

  it('gerente não cria login', async () => {
    const res = await chamar(app, 'POST', '/usuarios', TOKEN.gerente, {
      name: 'Novo',
      email: 'n@csb.com',
      password: 'x',
      role: 'admin',
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('listagem', () => {
  it('nunca devolve o hash da senha', async () => {
    const { app } = await comBanco({
      users: { data: [ADMIN_LOGADO, GERENTE], error: null },
    });
    const res = await chamar(app, 'GET', '/usuarios', TOKEN.admin);

    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('password_hash');
    expect(res.body).not.toContain('$2b$');

    const { data } = res.json() as { data: Array<{ email: string; last_login_at: string | null }> };
    expect(data).toHaveLength(2);
    expect(data[0]).toHaveProperty('last_login_at');
  });

  it('filtra pela empresa do token', async () => {
    const { app, fake } = await comBanco({ users: { data: [ADMIN_LOGADO], error: null } });
    await chamar(app, 'GET', '/usuarios', TOKEN.admin);

    const porEmpresa = fake.filtrosDe('users', 'eq').filter((f) => f.args[0] === 'company_id');
    expect(porEmpresa.length).toBeGreaterThan(0);
    expect(porEmpresa[0]!.args[1]).toBe(EMPRESA);
  });
});

describe('o admin não se tranca fora', () => {
  it('não se bloqueia', async () => {
    const { app } = await comBanco({ users: { data: ADMIN_LOGADO, error: null } });
    const res = await chamar(app, 'PATCH', '/usuarios/adm-1', TOKEN.admin, { active: false });

    expect(res.statusCode).toBe(409);
    expect((res.json() as { code: string }).code).toBe('PROPRIO_LOGIN');
  });

  it('não se exclui', async () => {
    const { app } = await comBanco({ users: { data: ADMIN_LOGADO, error: null } });
    const res = await chamar(app, 'DELETE', '/usuarios/adm-1', TOKEN.admin);

    expect(res.statusCode).toBe(409);
    expect((res.json() as { code: string }).code).toBe('PROPRIO_LOGIN');
  });

  it('não se rebaixa a gerente', async () => {
    const { app } = await comBanco({ users: { data: ADMIN_LOGADO, error: null } });
    const res = await chamar(app, 'PATCH', '/usuarios/adm-1', TOKEN.admin, { role: 'manager' });

    expect(res.statusCode).toBe(409);
    expect((res.json() as { code: string }).code).toBe('PROPRIO_LOGIN');
  });
});

describe('a fábrica nunca fica sem admin', () => {
  it('bloquear o último admin ativo é recusado', async () => {
    const { app } = await comBanco({
      users: [
        { data: OUTRO_ADMIN, error: null }, // o alvo
        { data: [], error: null, count: 0 }, // nenhum outro admin ativo sobraria
      ],
    });
    const res = await chamar(app, 'PATCH', '/usuarios/adm-2', TOKEN.admin, { active: false });

    expect(res.statusCode).toBe(409);
    expect((res.json() as { code: string }).code).toBe('ULTIMO_ADMIN');
  });

  it('com outro admin ativo sobrando, bloquear passa', async () => {
    const { app } = await comBanco({
      users: naOrdem(
        { data: OUTRO_ADMIN, error: null }, // buscar o alvo
        { data: [], error: null, count: 1 }, // sobra outro admin ativo
        { data: { ...OUTRO_ADMIN, active: false }, error: null }, // o update
      ),
    });
    const res = await chamar(app, 'PATCH', '/usuarios/adm-2', TOKEN.admin, { active: false });
    expect(res.statusCode).toBe(200);
  });
});

describe('criação', () => {
  it('cria gerente com as teclas escolhidas e grava a senha em hash', async () => {
    const { app, fake } = await comBanco({
      users: naOrdem(
        { data: [{ permissions: null, last_login_at: null }], error: null }, // detecção da 022
        { data: null, error: null }, // e-mail livre
        { data: { ...GERENTE, id: 'ger-9', permissions: ['aprovar_pedidos'] }, error: null },
      ),
    });
    const res = await chamar(app, 'POST', '/usuarios', TOKEN.admin, {
      name: 'Novo Gerente',
      email: 'NOVO@CSB.com',
      password: 'senha123',
      role: 'manager',
      permissions: ['aprovar_pedidos'],
    });

    expect(res.statusCode).toBe(201);
    const gravado = fake.ultimaGravacao('users', 'insert')?.valores as Record<string, unknown>;
    expect(gravado['email']).toBe('novo@csb.com'); // normalizado
    expect(gravado['company_id']).toBe(EMPRESA);
    expect(gravado['role']).toBe('manager');
    expect(gravado['password_hash']).toMatch(/^\$2[aby]\$/);
    expect(gravado).not.toHaveProperty('password');
  });

  it('recusa papel que não se cria por aqui', async () => {
    const { app } = await comBanco({ users: { data: null, error: null } });
    for (const role of ['rep', 'store', 'guest', 'root']) {
      const res = await chamar(app, 'POST', '/usuarios', TOKEN.admin, {
        name: 'X',
        email: `${role}@csb.com`,
        password: 'senha123',
        role,
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it('recusa e-mail já usado', async () => {
    const { app } = await comBanco({ users: { data: { id: 'ja-existe' }, error: null } });
    const res = await chamar(app, 'POST', '/usuarios', TOKEN.admin, {
      name: 'X',
      email: 'admin@csb.com',
      password: 'senha123',
      role: 'manager',
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { code: string }).code).toBe('EMAIL_TAKEN');
  });

  it('recusa tecla inventada', async () => {
    const { app } = await comBanco({ users: { data: null, error: null } });
    const res = await chamar(app, 'POST', '/usuarios', TOKEN.admin, {
      name: 'X',
      email: 'x@csb.com',
      password: 'senha123',
      role: 'manager',
      permissions: ['apagar_tudo'],
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('exclusão', () => {
  it('login com pedido no histórico não é apagado — oferece bloquear', async () => {
    const { app } = await comBanco({
      users: { data: GERENTE, error: null },
      orders: { data: [], error: null, count: 3 },
    });
    const res = await chamar(app, 'DELETE', '/usuarios/ger-1', TOKEN.admin);

    expect(res.statusCode).toBe(409);
    expect((res.json() as { code: string }).code).toBe('HAS_ORDERS');
  });

  it('login sem pedido é apagado', async () => {
    const { app, fake } = await comBanco({
      users: { data: GERENTE, error: null },
      orders: { data: [], error: null, count: 0 },
    });
    const res = await chamar(app, 'DELETE', '/usuarios/ger-1', TOKEN.admin);

    expect(res.statusCode).toBe(200);
    expect(fake.ultimaGravacao('users', 'delete')).toBeDefined();
  });

  it('usuário de outra empresa não é encontrado', async () => {
    const { app } = await comBanco({ users: { data: null, error: null } });
    const res = await chamar(app, 'DELETE', '/usuarios/de-outra-fabrica', TOKEN.admin);
    expect(res.statusCode).toBe(404);
  });
});

describe('troca de senha', () => {
  it('grava hash, nunca texto puro, e não devolve nada disso', async () => {
    const { app, fake } = await comBanco({
      users: [
        { data: GERENTE, error: null },
        { data: GERENTE, error: null },
      ],
    });
    const res = await chamar(app, 'PATCH', '/usuarios/ger-1', TOKEN.admin, {
      password: 'nova-senha',
    });

    expect(res.statusCode).toBe(200);
    const gravado = fake.ultimaGravacao('users', 'update')?.valores as Record<string, unknown>;
    expect(gravado['password_hash']).toMatch(/^\$2[aby]\$/);
    expect(JSON.stringify(gravado)).not.toContain('nova-senha');
    expect(res.body).not.toContain('password');
  });
});
