import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { criarSupabaseFake } from './supabaseFake.js';

/**
 * Matriz de autorização batendo na aplicação de verdade (via `app.inject`,
 * sem abrir porta). É o teste que impede o retorno de duas falhas encontradas
 * na auditoria: o representante consultando outra tabela de preço pela query
 * string, e o catálogo devolvendo estoque para ele.
 */

const EMPRESA = 'empresa-1';
const SEGREDO = 'segredo-de-teste-nao-usar-em-producao'; // igual ao tests/setup.ts

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

function assinar(payload: Record<string, unknown>, segredo = SEGREDO, validoPor = 3600): string {
  const cabecalho = b64({ alg: 'HS256', typ: 'JWT' });
  const agora = Math.floor(Date.now() / 1000);
  const corpo = b64({ ...payload, iat: agora, exp: agora + validoPor });
  const assinatura = crypto
    .createHmac('sha256', segredo)
    .update(`${cabecalho}.${corpo}`)
    .digest('base64url');
  return `${cabecalho}.${corpo}.${assinatura}`;
}

const base = { email: 'x@csb.com', company_id: EMPRESA, name: 'Teste', commission_rate: 10 };
const TOKEN = {
  rep: assinar({ ...base, sub: 'rep-1', role: 'rep', price_table_id: 'tabela-do-rep' }),
  gerente: assinar({ ...base, sub: 'ger-1', role: 'manager', price_table_id: null }),
  admin: assinar({ ...base, sub: 'adm-1', role: 'admin', price_table_id: null }),
  expirado: assinar({ ...base, sub: 'rep-1', role: 'rep' }, SEGREDO, -60),
  outroSegredo: assinar({ ...base, sub: 'adm-1', role: 'admin' }, 'segredo-errado'),
  refresh: assinar({ sub: 'rep-1', type: 'refresh' }),
};

let app: FastifyInstance;

beforeAll(async () => {
  const fake = criarSupabaseFake({
    products: { data: [{ id: 'p1', sku: '0001', name: 'Camisola', active: true, image_url: null }], error: null },
    product_variants: { data: [{ id: 'v1', product_id: 'p1', size: 'P', stock_quantity: 7, stock_committed: 1 }], error: null },
    product_prices: { data: [{ product_id: 'p1', price: 30 }], error: null },
    price_tables: { data: [{ id: 'tabela-2', name: 'TABELA 02', company_id: EMPRESA }], error: null },
    customers: { data: [], error: null },
    orders: { data: [], error: null },
    users: { data: [], error: null },
  });
  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));

  const { buildApp } = await import('../apps/api/src/app.js');
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app?.close();
});

const chamar = (url: string, token?: string, method: 'GET' | 'POST' = 'GET') =>
  app.inject({
    method,
    url,
    ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
  });

describe('token', () => {
  it.each([
    ['/products'],
    ['/customers'],
    ['/orders'],
    ['/reps'],
    ['/price-tables'],
  ])('%s exige autenticação', async (url) => {
    expect((await chamar(url)).statusCode).toBe(401);
  });

  it('recusa token assinado com outro segredo', async () => {
    expect((await chamar('/products', TOKEN.outroSegredo)).statusCode).toBe(401);
  });

  it('recusa token expirado', async () => {
    expect((await chamar('/products', TOKEN.expirado)).statusCode).toBe(401);
  });

  it('recusa refresh token usado como token de acesso', async () => {
    expect((await chamar('/products', TOKEN.refresh)).statusCode).toBe(401);
  });
});

describe('papéis', () => {
  it.each([
    ['/reps'],
    ['/price-tables'],
    ['/catalog/price-tables'],
  ])('representante não acessa %s', async (url) => {
    expect((await chamar(url, TOKEN.rep)).statusCode).toBe(403);
  });

  it.each([
    ['gerente', TOKEN.gerente],
    ['admin', TOKEN.admin],
  ])('%s acessa /catalog/price-tables', async (_papel, token) => {
    expect((await chamar('/catalog/price-tables', token)).statusCode).toBe(200);
  });
});

describe('catálogo', () => {
  it('bloqueia o representante que tenta consultar outra tabela de preço', async () => {
    const res = await chamar('/products?price_table_id=tabela-2', TOKEN.rep);
    expect(res.statusCode).toBe(403);
  });

  it('deixa o gerente consultar outra tabela de preço', async () => {
    const res = await chamar('/products?price_table_id=tabela-2', TOKEN.gerente);
    expect(res.statusCode).toBe(200);
  });

  it('não manda estoque para o representante', async () => {
    const res = await chamar('/products', TOKEN.rep);
    const { data } = res.json() as { data: Array<{ variants: Array<Record<string, unknown>> }> };

    expect(res.statusCode).toBe(200);
    expect(JSON.stringify(data)).not.toContain('stock_quantity');
    expect(data[0]!.variants[0]).not.toHaveProperty('available');
    expect(data[0]!.variants[0]!['in_stock']).toBe(true);
  });

  it('manda a quantidade para o gerente', async () => {
    const res = await chamar('/products', TOKEN.gerente);
    const { data } = res.json() as { data: Array<{ variants: Array<{ available?: number }> }> };

    expect(data[0]!.variants[0]!.available).toBe(6); // 7 − 1
  });
});

describe('respostas de erro', () => {
  it('não revela se o e-mail existe no login', async () => {
    const inexistente = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'ninguem@csb.com', password: 'x' },
    });
    expect(inexistente.statusCode).toBe(401);
    expect(inexistente.json()).toEqual({
      error: 'Credenciais inválidas',
      code: 'INVALID_CREDENTIALS',
      statusCode: 401,
    });
  });

  it('recusa e-mail malformado com 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'nao-e-email', password: 'x' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('responde /health sem autenticação', async () => {
    const res = await chamar('/health');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok' });
  });
});
