import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { criarSupabaseFake } from './supabaseFake.js';

/**
 * De quem é o preço de um pedido.
 *
 * O defeito que este teste tranca: `createOrderHandler` precificava o pedido do
 * representante com a tabela DELE, enquanto o mesmo cliente comprando pelo
 * login próprio saía pela tabela do cadastro. Duas verdades para a mesma loja,
 * decididas por quem clicou.
 *
 * A regra agora é uma só, nos dois caminhos: o preço de um cliente é o do
 * cadastro dele, caindo para a do representante quando ele não tem tabela —
 * situação de 809 dos 1.353 clientes em produção.
 */

const EMPRESA = 'empresa-1';
const SEGREDO = 'segredo-de-teste-nao-usar-em-producao'; // igual ao tests/setup.ts
const TABELA_DO_REP = 'tabela-do-rep';
const TABELA_DO_CLIENTE = 'tabela-do-cliente';

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

const TOKEN_REP = assinar({
  sub: 'rep-1',
  email: 'rep@csb.com',
  company_id: EMPRESA,
  name: 'SIMONE',
  role: 'rep',
  price_table_id: TABELA_DO_REP,
});

/**
 * Sobe a aplicação com um cliente cujo cadastro aponta para OUTRA tabela que
 * não a do representante — é a única configuração em que os dois caminhos
 * possíveis dão respostas diferentes.
 */
async function subir(tabelaDoCliente: string | null) {
  const fake = criarSupabaseFake({
    customers: [
      // 1ª consulta: `tabelaDaLoja` procurando a tabela do cadastro.
      { data: { price_table_id: tabelaDoCliente }, error: null },
      // 2ª: `createOrder` conferindo que o cliente existe e não está bloqueado.
      { data: { id: 'c1', blocked: false }, error: null },
    ],
    users: { data: { price_table_id: TABELA_DO_REP }, error: null },
    product_prices: { data: [{ product_id: 'p1', price: 42 }], error: null },
    orders: [
      { data: { id: 'o1' }, error: null },
      { data: { id: 'o1', items: [] }, error: null },
    ],
    order_items: { data: [], error: null },
  } as never);

  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
  const { buildApp } = await import('../apps/api/src/app.js');
  const app = await buildApp();
  await app.ready();
  return { app, fake };
}

/** Com qual tabela o servidor foi buscar o preço dos itens. */
function tabelaConsultada(fake: ReturnType<typeof criarSupabaseFake>): unknown {
  return fake.filtrosDe('product_prices', 'eq').find((f) => f.args[0] === 'price_table_id')?.args[1];
}

const PEDIDO = {
  customer_id: 'c1',
  submit: true,
  items: [{ product_id: 'p1', quantity: 2, unit_price: 999 }],
};

describe('pedido do representante', () => {
  let app: FastifyInstance;
  let fake: ReturnType<typeof criarSupabaseFake>;

  beforeAll(async () => {
    vi.resetModules();
    ({ app, fake } = await subir(TABELA_DO_CLIENTE));
  });

  afterAll(async () => {
    await app?.close();
  });

  it('sai precificado pela tabela do CLIENTE, não pela do representante', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: `Bearer ${TOKEN_REP}` },
      payload: PEDIDO,
    });

    expect(res.statusCode).toBe(201);
    expect(tabelaConsultada(fake)).toBe(TABELA_DO_CLIENTE);
    expect(tabelaConsultada(fake)).not.toBe(TABELA_DO_REP);
  });
});

describe('pedido de cliente sem tabela', () => {
  let app: FastifyInstance;
  let fake: ReturnType<typeof criarSupabaseFake>;

  beforeAll(async () => {
    vi.resetModules();
    ({ app, fake } = await subir(null));
  });

  afterAll(async () => {
    await app?.close();
  });

  it('cai para a tabela do representante — sem ela, 809 lojas ficariam sem preço', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: `Bearer ${TOKEN_REP}` },
      payload: PEDIDO,
    });

    expect(res.statusCode).toBe(201);
    expect(tabelaConsultada(fake)).toBe(TABELA_DO_REP);
  });
});
