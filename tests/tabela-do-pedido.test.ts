import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { criarSupabaseFake } from './supabaseFake.js';

/**
 * O representante escolhe a tabela DO PEDIDO.
 *
 * Quem tem duas ou mais tabelas precisa separar, para o mesmo cliente, o pedido
 * de uma tabela do de outra — e o Control importa uma planilha por tabela, então
 * misturar não é opção. Antes disto o preço vinha sempre do cadastro do cliente
 * e não havia como desviar.
 *
 * O que estes testes trancam:
 *
 * • escolher vale — o preço sai pela tabela escolhida, não pela do cadastro;
 * • escolher tabela de fora do conjunto é 403, mesmo com token válido. A tela
 *   nem oferece a opção, então chegar lá é chamada direta à API;
 * • não escolher continua caindo na tabela do cliente. Obrigar a escolha em
 *   todo pedido puniria quem tem duas tabelas e usa sempre a do cadastro.
 */

const EMPRESA = 'empresa-1';
const SEGREDO = 'segredo-de-teste-nao-usar-em-producao'; // igual ao tests/setup.ts
const TABELA_DO_REP = 'tabela-01';
const TABELA_DO_CLIENTE = 'tabela-02';
const TABELA_ESCOLHIDA = 'tabela-03';
const TABELA_DE_OUTRO = 'tabela-de-outra-regiao';

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
 * A SIMONE de produção: três tabelas no conjunto, cliente cadastrado na 02.
 * `rep_price_tables` responde o conjunto dela; a tabela de outra região existe
 * na empresa mas não é dela — é o caso que precisa dar 403.
 */
async function subir() {
  const fake = criarSupabaseFake({
    customers: [
      { data: { price_table_id: TABELA_DO_CLIENTE }, error: null },
      { data: { id: 'c1', blocked: false }, error: null },
    ],
    users: { data: { price_table_id: TABELA_DO_REP }, error: null },
    price_tables: {
      data: [
        { id: TABELA_DO_REP, name: 'TABELA 01 - 2027' },
        { id: TABELA_DO_CLIENTE, name: 'TABELA 02 - 2027' },
        { id: TABELA_ESCOLHIDA, name: 'TABELA 03 - 2027' },
        { id: TABELA_DE_OUTRO, name: 'TABELA DE OUTRA REGIAO' },
      ],
      error: null,
    },
    rep_price_tables: {
      data: [
        { user_id: 'rep-1', price_table_id: TABELA_DO_REP },
        { user_id: 'rep-1', price_table_id: TABELA_DO_CLIENTE },
        { user_id: 'rep-1', price_table_id: TABELA_ESCOLHIDA },
      ],
      error: null,
    },
    product_prices: { data: [{ product_id: 'p1', price: 42 }], error: null },
    orders: [
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

/** Com qual tabela o servidor foi buscar o preço dos itens. */
function tabelaConsultada(fake: ReturnType<typeof criarSupabaseFake>): unknown {
  return fake.filtrosDe('product_prices', 'eq').find((f) => f.args[0] === 'price_table_id')?.args[1];
}

const pedido = (price_table_id?: string) => ({
  customer_id: 'c1',
  submit: true,
  ...(price_table_id ? { price_table_id } : {}),
  items: [{ product_id: 'p1', quantity: 2, unit_price: 999 }],
});

describe('representante escolhe a tabela do pedido', () => {
  let app: FastifyInstance;
  let fake: ReturnType<typeof criarSupabaseFake>;

  beforeAll(async () => {
    vi.resetModules();
    ({ app, fake } = await subir());
  });

  afterAll(async () => {
    await app?.close();
  });

  it('precifica pela tabela escolhida, não pela do cadastro do cliente', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: `Bearer ${TOKEN_REP}` },
      payload: pedido(TABELA_ESCOLHIDA),
    });

    expect(res.statusCode).toBe(201);
    expect(tabelaConsultada(fake)).toBe(TABELA_ESCOLHIDA);
    expect(tabelaConsultada(fake)).not.toBe(TABELA_DO_CLIENTE);
  });
});

describe('tabela de fora do conjunto', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.resetModules();
    ({ app } = await subir());
  });

  afterAll(async () => {
    await app?.close();
  });

  it('é recusada com 403, mesmo com token válido', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: `Bearer ${TOKEN_REP}` },
      payload: pedido(TABELA_DE_OUTRO),
    });

    expect(res.statusCode).toBe(403);
    // Sem dizer se a tabela existe: quem chegou aqui não passou pela tela.
    expect(res.json().error).not.toContain('OUTRA REGIAO');
  });
});

describe('pedido sem escolha', () => {
  let app: FastifyInstance;
  let fake: ReturnType<typeof criarSupabaseFake>;

  beforeAll(async () => {
    vi.resetModules();
    ({ app, fake } = await subir());
  });

  afterAll(async () => {
    await app?.close();
  });

  it('continua caindo na tabela do cliente — nada muda para quem não escolhe', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: `Bearer ${TOKEN_REP}` },
      payload: pedido(),
    });

    expect(res.statusCode).toBe(201);
    expect(tabelaConsultada(fake)).toBe(TABELA_DO_CLIENTE);
  });
});
