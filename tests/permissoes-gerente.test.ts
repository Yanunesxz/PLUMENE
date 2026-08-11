import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { criarSupabaseFake } from './supabaseFake.js';

/**
 * As teclas do gerente valendo nas rotas de verdade.
 *
 * O teste que importa é o do gerente LEGADO: quem já existia tem `permissions`
 * nulo e não pode perder nada no dia em que isto entrou no ar.
 */

const EMPRESA = 'empresa-1';
const SEGREDO = 'segredo-de-teste-nao-usar-em-producao'; // igual ao tests/setup.ts
const PEDIDO = '00000000-0000-0000-0000-000000000000';

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
  /** Gerente de antes das teclas: coluna nula. */
  legado: assinar({ ...base, sub: 'ger-0', role: 'manager', permissions: null }),
  /** Só aprova. Não fatura, não mexe em rep, não importa. */
  soAprova: assinar({ ...base, sub: 'ger-1', role: 'manager', permissions: ['aprovar_pedidos'] }),
  /** Só fatura. */
  soFatura: assinar({ ...base, sub: 'ger-2', role: 'manager', permissions: ['faturar_pedidos'] }),
  /** Sem tecla nenhuma — o admin desligou tudo. */
  semNada: assinar({ ...base, sub: 'ger-3', role: 'manager', permissions: [] }),
  /** Gerente com a tecla que era exclusiva do admin. */
  importador: assinar({
    ...base,
    sub: 'ger-4',
    role: 'manager',
    permissions: ['importar_produtos'],
  }),
  admin: assinar({ ...base, sub: 'adm-1', role: 'admin', permissions: [] }),
  rep: assinar({ ...base, sub: 'rep-1', role: 'rep', permissions: [] }),
};

let app: FastifyInstance;

beforeAll(async () => {
  const fake = criarSupabaseFake({
    users: { data: [], error: null },
    orders: { data: null, error: null },
    products: { data: [], error: null },
    price_tables: { data: [], error: null },
  });
  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));

  const { buildApp } = await import('../apps/api/src/app.js');
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app?.close();
});

const chamar = (
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
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

/** 403 é a recusa da tecla. Qualquer outra coisa significa que ele passou pelo guard. */
const passou = (status: number) => status !== 403;

describe('gerente legado (permissions nulo) mantém o que já fazia', () => {
  it('aprova pedido', async () => {
    const res = await chamar('PATCH', `/orders/${PEDIDO}/status`, TOKEN.legado, {
      status: 'approved',
    });
    expect(passou(res.statusCode)).toBe(true);
  });

  it('fatura', async () => {
    const res = await chamar('PATCH', `/orders/${PEDIDO}/invoice`, TOKEN.legado, {
      invoiced: true,
    });
    expect(passou(res.statusCode)).toBe(true);
  });

  it('mexe em representante', async () => {
    const res = await chamar('PATCH', '/reps/rep-1', TOKEN.legado, { name: 'Novo nome' });
    expect(passou(res.statusCode)).toBe(true);
  });

  it('não importa produto — isso sempre foi só do admin', async () => {
    const res = await chamar('POST', '/products/import', TOKEN.legado, { produtos: [] });
    expect(res.statusCode).toBe(403);
  });
});

describe('tecla aprovar_pedidos', () => {
  it('sem a tecla, não aprova', async () => {
    const res = await chamar('PATCH', `/orders/${PEDIDO}/status`, TOKEN.soFatura, {
      status: 'approved',
    });
    expect(res.statusCode).toBe(403);
  });

  it('sem a tecla, não exclui pedido', async () => {
    const res = await chamar('DELETE', `/orders/${PEDIDO}`, TOKEN.soFatura);
    expect(res.statusCode).toBe(403);
  });

  it('com a tecla, passa', async () => {
    const res = await chamar('PATCH', `/orders/${PEDIDO}/status`, TOKEN.soAprova, {
      status: 'approved',
    });
    expect(passou(res.statusCode)).toBe(true);
  });
});

describe('tecla faturar_pedidos', () => {
  it('sem a tecla, não fatura', async () => {
    const res = await chamar('PATCH', `/orders/${PEDIDO}/invoice`, TOKEN.soAprova, {
      invoiced: true,
    });
    expect(res.statusCode).toBe(403);
  });

  it('com a tecla, passa', async () => {
    const res = await chamar('PATCH', `/orders/${PEDIDO}/invoice`, TOKEN.soFatura, {
      invoiced: true,
    });
    expect(passou(res.statusCode)).toBe(true);
  });
});

describe('tecla gerenciar_representantes', () => {
  it.each([
    ['POST', '/reps'],
    ['PATCH', '/reps/rep-1'],
    ['DELETE', '/reps/rep-1'],
    ['PUT', '/reps/rep-1/meta'],
  ])('sem a tecla, %s %s é negado', async (metodo, url) => {
    const res = await chamar(metodo as 'POST', url, TOKEN.semNada, {});
    expect(res.statusCode).toBe(403);
  });

  it('a LISTA continua aberta ao gerente sem a tecla — outras telas vivem dela', async () => {
    expect((await chamar('GET', '/reps', TOKEN.semNada)).statusCode).toBe(200);
    expect((await chamar('GET', '/price-tables', TOKEN.semNada)).statusCode).toBe(200);
  });
});

describe('tecla importar_produtos', () => {
  it('gerente com a tecla passa a importar — poder novo, dado pelo admin', async () => {
    const res = await chamar('POST', '/products/import', TOKEN.importador, { produtos: [] });
    expect(passou(res.statusCode)).toBe(true);
  });
});

describe('quem não é gerente não é afetado', () => {
  it('admin com array vazio continua podendo tudo', async () => {
    for (const [metodo, url, corpo] of [
      ['PATCH', `/orders/${PEDIDO}/status`, { status: 'approved' }],
      ['PATCH', `/orders/${PEDIDO}/invoice`, { invoiced: true }],
      ['PATCH', '/reps/rep-1', { name: 'x' }],
      ['POST', '/products/import', { produtos: [] }],
    ] as const) {
      const res = await chamar(metodo, url, TOKEN.admin, corpo);
      expect(passou(res.statusCode)).toBe(true);
    }
  });

  it('a triagem do representante não é atingida pelo guard da rota que ele divide com o gerente', async () => {
    const res = await chamar('PATCH', `/orders/${PEDIDO}/status`, TOKEN.rep, {
      status: 'pending_approval',
    });
    expect(passou(res.statusCode)).toBe(true);
  });
});
