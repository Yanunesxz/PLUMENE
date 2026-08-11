import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { criarSupabaseFake } from './supabaseFake.js';

/**
 * O pedido registra em que tabela foi precificado.
 *
 * Ninguém escolhe: a tabela é a do cadastro do cliente, caindo para a do
 * representante quando o cliente não tem uma. O que a migração 025 acrescenta é
 * GRAVAR essa tabela no pedido, em vez de deixá-la implícita no preço dos itens.
 *
 * Sem o registro, quem lê depois só consegue deduzir pelo cadastro do cliente —
 * e a dedução erra quando o cliente troca de tabela: o pedido antigo passa a
 * "pertencer" a uma tabela que não o precificou. A exportação para o Control
 * escolhe o modelo de planilha por esse campo, então errar aí significa mandar
 * para a fábrica um pedido com o preço de outra região.
 */

const EMPRESA = 'empresa-1';
const SEGREDO = 'segredo-de-teste-nao-usar-em-producao'; // igual ao tests/setup.ts
const TABELA_DO_REP = 'tabela-01';
const TABELA_DO_CLIENTE = 'tabela-02';

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

/** `tabelaDoCliente = null` reproduz os 536 clientes sem tabela cadastrada. */
async function subir(tabelaDoCliente: string | null) {
  const fake = criarSupabaseFake({
    customers: [
      { data: { price_table_id: tabelaDoCliente }, error: null },
      { data: { id: 'c1', blocked: false }, error: null },
    ],
    users: { data: { price_table_id: TABELA_DO_REP }, error: null },
    product_prices: { data: [{ product_id: 'p1', price: 42 }], error: null },
    orders: [
      // Sondagem de `orders.price_table_id` (025) e das colunas de origem (014),
      // cada uma consumindo a resposta e uma de folga.
      { data: [{ id: 'sonda' }], error: null },
      { data: null, error: null },
      { data: [{ id: 'sonda' }], error: null },
      { data: null, error: null },
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

/** O que foi gravado na coluna `price_table_id` do pedido. */
function tabelaGravada(fake: ReturnType<typeof criarSupabaseFake>): unknown {
  const insercoes = fake.gravacoes.filter((g) => g.tabela === 'orders' && g.operacao === 'insert');
  return (insercoes.at(-1)?.valores as { price_table_id?: string } | undefined)?.price_table_id;
}

const PEDIDO = {
  customer_id: 'c1',
  submit: true,
  items: [{ product_id: 'p1', quantity: 2, unit_price: 999 }],
};

describe('cliente com tabela própria', () => {
  let app: FastifyInstance;
  let fake: ReturnType<typeof criarSupabaseFake>;

  beforeAll(async () => {
    vi.resetModules();
    ({ app, fake } = await subir(TABELA_DO_CLIENTE));
  });

  afterAll(async () => {
    await app?.close();
  });

  it('grava no pedido a tabela do CLIENTE, que é a que precificou', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: `Bearer ${TOKEN_REP}` },
      payload: PEDIDO,
    });

    expect(res.statusCode).toBe(201);
    expect(tabelaGravada(fake)).toBe(TABELA_DO_CLIENTE);
    expect(tabelaGravada(fake)).not.toBe(TABELA_DO_REP);
  });
});

describe('cliente sem tabela cadastrada', () => {
  let app: FastifyInstance;
  let fake: ReturnType<typeof criarSupabaseFake>;

  beforeAll(async () => {
    vi.resetModules();
    ({ app, fake } = await subir(null));
  });

  afterAll(async () => {
    await app?.close();
  });

  it('grava a do representante — a mesma que precificou o pedido', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: `Bearer ${TOKEN_REP}` },
      payload: PEDIDO,
    });

    expect(res.statusCode).toBe(201);
    expect(tabelaGravada(fake)).toBe(TABELA_DO_REP);
  });
});

describe('escolha de tabela vinda do corpo', () => {
  let app: FastifyInstance;
  let fake: ReturnType<typeof criarSupabaseFake>;

  beforeAll(async () => {
    vi.resetModules();
    ({ app, fake } = await subir(TABELA_DO_CLIENTE));
  });

  afterAll(async () => {
    await app?.close();
  });

  it('é ignorada: quem manda no preço é o cadastro, não o corpo do pedido', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: `Bearer ${TOKEN_REP}` },
      payload: { ...PEDIDO, price_table_id: 'tabela-de-outra-regiao' },
    });

    expect(res.statusCode).toBe(201);
    expect(tabelaGravada(fake)).toBe(TABELA_DO_CLIENTE);
  });
});
