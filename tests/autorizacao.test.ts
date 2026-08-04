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
  // Loja: compra para o cliente dela, recebe pelo representante dono.
  loja: assinar({
    ...base,
    sub: 'loja-1',
    role: 'store',
    price_table_id: null,
    customer_id: 'cliente-1',
    rep_id: 'rep-1',
  }),
  // Vitrine: não é usuário. `sub` é o próprio link.
  visitante: assinar({
    ...base,
    sub: 'link-1',
    role: 'guest',
    name: 'Visitante',
    price_table_id: 'tabela-do-rep',
    customer_id: null,
    rep_id: 'rep-1',
  }),
};

let app: FastifyInstance;

beforeAll(async () => {
  const fake = criarSupabaseFake({
    products: { data: [{ id: 'p1', sku: '0001', name: 'Camisola', active: true, image_url: null }], error: null },
    product_variants: { data: [{ id: 'v1', product_id: 'p1', size: 'P', stock_quantity: 7, stock_committed: 1 }], error: null },
    product_prices: { data: [{ product_id: 'p1', price: 30 }], error: null },
    price_tables: { data: [{ id: 'tabela-2', name: 'TABELA 02', company_id: EMPRESA }], error: null },
    // `tabelaDaLoja` consulta o cliente para achar a tabela de preço dela.
    customers: { data: { price_table_id: 'tabela-2' }, error: null },
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

describe('loja', () => {
  it.each([
    ['/customers'],
    ['/reps'],
    ['/price-tables'],
    ['/catalog/price-tables'],
    ['/invites'],
    ['/showcase-links'],
  ])('não acessa %s', async (url) => {
    expect((await chamar(url, TOKEN.loja)).statusCode).toBe(403);
  });

  it('vê o catálogo', async () => {
    expect((await chamar('/products', TOKEN.loja)).statusCode).toBe(200);
  });

  it('consulta os próprios pedidos', async () => {
    expect((await chamar('/orders', TOKEN.loja)).statusCode).toBe(200);
  });

  it('não aprova pedido — nem o próprio', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/orders/00000000-0000-0000-0000-000000000000/status',
      headers: { authorization: `Bearer ${TOKEN.loja}` },
      payload: { status: 'approved' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('não fatura', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/orders/00000000-0000-0000-0000-000000000000/invoice',
      headers: { authorization: `Bearer ${TOKEN.loja}` },
      payload: { invoiced: true },
    });
    expect(res.statusCode).toBe(403);
  });

  it('não apaga pedido', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/orders/00000000-0000-0000-0000-000000000000',
      headers: { authorization: `Bearer ${TOKEN.loja}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('não recebe quantidade em estoque', async () => {
    const res = await chamar('/products', TOKEN.loja);
    const { data } = res.json() as { data: Array<{ variants: Array<Record<string, unknown>> }> };
    expect(JSON.stringify(data)).not.toContain('stock_quantity');
    expect(data[0]!.variants[0]).not.toHaveProperty('available');
  });

  it('não consulta outra tabela de preço pela query string', async () => {
    expect((await chamar('/products?price_table_id=tabela-2', TOKEN.loja)).statusCode).toBe(403);
  });
});

describe('vitrine (visitante)', () => {
  it('vê o catálogo — é para isso que o link existe', async () => {
    expect((await chamar('/products', TOKEN.visitante)).statusCode).toBe(200);
  });

  it.each([
    ['/orders'],
    ['/customers'],
    ['/reps'],
    ['/price-tables'],
    ['/catalog/price-tables'],
    ['/invites'],
    ['/showcase-links'],
  ])('não acessa %s', async (url) => {
    expect((await chamar(url, TOKEN.visitante)).statusCode).toBe(403);
  });

  it('não gera link para si mesmo', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/showcase-links',
      headers: { authorization: `Bearer ${TOKEN.visitante}` },
      payload: { hours: 24 },
    });
    expect(res.statusCode).toBe(403);
  });

  it('não recebe quantidade em estoque', async () => {
    const res = await chamar('/products', TOKEN.visitante);
    const { data } = res.json() as { data: Array<{ variants: Array<Record<string, unknown>> }> };
    expect(data[0]!.variants[0]).not.toHaveProperty('available');
  });

  it('não consulta outra tabela de preço pela query string', async () => {
    expect((await chamar('/products?price_table_id=tabela-2', TOKEN.visitante)).statusCode).toBe(403);
  });
});

describe('rotas públicas', () => {
  it('link de vitrine inexistente responde 410, não 500', async () => {
    const res = await app.inject({ method: 'POST', url: '/public/showcase/inventado' });
    expect(res.statusCode).toBe(410);
  });

  it('convite inexistente responde 410', async () => {
    const res = await app.inject({ method: 'GET', url: '/public/invite/inventado' });
    expect(res.statusCode).toBe(410);
  });
});

describe('catálogo', () => {
  // O rep passou a poder abrir o catálogo nas tabelas do conjunto DELE — precisa
  // disso porque o pedido é precificado pela tabela do cliente. Fora do
  // conjunto (é o caso aqui: `rep_price_tables` vazia) continua 403.
  it('bloqueia o representante que tenta consultar tabela fora do conjunto dele', async () => {
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
