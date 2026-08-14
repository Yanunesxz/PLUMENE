import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { criarSupabaseFake } from './supabaseFake.js';

/**
 * Editar as peças de um pedido em aberto (PATCH /orders/:id/items).
 *
 * A loja monta o pedido dela, mas quem conhece o cliente é o representante:
 * na triagem ele tira a peça que sabe que não vende e põe a que o lojista
 * esqueceu. O gerente faz o mesmo ajuste na fila dele, antes de aprovar.
 *
 * O que estes testes trancam:
 *   1. o corpo NÃO leva preço — o servidor reprecifica pela tabela do pedido,
 *      inclusive a faixa maior do EG/48-54;
 *   2. o desconto do pedido continua valendo no total novo;
 *   3. representante não mexe em pedido dos outros, nem em pedido que já foi
 *      para a fábrica;
 *   4. a loja não edita nada — quem compra não altera o próprio pedido depois
 *      de mandar.
 */

const EMPRESA = 'empresa-1';
const SEGREDO = 'segredo-de-teste-nao-usar-em-producao'; // igual ao tests/setup.ts
const TABELA = 'tabela-1';

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
  price_table_id: TABELA,
});

const TOKEN_LOJA = assinar({
  sub: 'loja-1',
  email: 'loja@csb.com',
  company_id: EMPRESA,
  name: 'LOJA',
  role: 'store',
  customer_id: 'c1',
});

const PEDIDO_NA_TRIAGEM = {
  id: 'o1',
  rep_id: 'rep-1',
  customer_id: 'c1',
  status: 'pending_rep',
  invoiced: false,
  price_table_id: TABELA,
  discount_percent: 10,
  total: 100,
};

async function subir(respostas: Record<string, unknown>) {
  const fake = criarSupabaseFake(respostas as never);
  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
  const { buildApp } = await import('../apps/api/src/app.js');
  const app = await buildApp();
  await app.ready();
  return { app, fake };
}

describe('o representante ajusta as peças da triagem', () => {
  let app: FastifyInstance;
  let fake: ReturnType<typeof criarSupabaseFake>;
  let statusCode = 0;

  beforeAll(async () => {
    vi.resetModules();
    ({ app, fake } = await subir({
      orders: [
        { data: PEDIDO_NA_TRIAGEM, error: null },
        { data: { id: 'o1' }, error: null }, // update do total
        { data: { ...PEDIDO_NA_TRIAGEM, total: 218.25, items: [] }, error: null },
      ],
      product_prices: [
        // 1ª consulta: o detector da migração 026.
        { data: [{ price_larger: null }], error: null },
        { data: [{ product_id: 'p1', price: 41.9, price_larger: 52.9 }], error: null },
      ],
      product_variants: {
        data: [
          { id: 'v-gg', size: 'GG' },
          { id: 'v-48', size: '48' },
        ],
        error: null,
      },
      order_items: [
        { data: [{ id: 'i-velho', order_id: 'o1' }], error: null }, // itens antigos
        { data: null, error: null }, // delete
        { data: null, error: null }, // insert
      ],
    }));

    const res = await app.inject({
      method: 'PATCH',
      url: '/orders/o1/items',
      headers: { authorization: `Bearer ${TOKEN_REP}` },
      payload: {
        items: [
          { product_id: 'p1', variant_id: 'v-gg', quantity: 2 },
          { product_id: 'p1', variant_id: 'v-48', quantity: 3 },
        ],
      },
    });
    statusCode = res.statusCode;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('aceita a edição', () => {
    expect(statusCode).toBe(200);
  });

  it('reprecifica pela tabela — o GG no preço normal, o 48 na faixa maior', () => {
    const inseridos = (fake.ultimaGravacao('order_items', 'insert')?.valores ?? []) as Array<{
      variant_id: string;
      unit_price: number;
      total: number;
    }>;
    expect(inseridos.find((i) => i.variant_id === 'v-gg')?.unit_price).toBe(41.9);
    expect(inseridos.find((i) => i.variant_id === 'v-48')?.unit_price).toBe(52.9);
  });

  it('mantém o desconto do pedido no total novo', () => {
    // (2×41,90 + 3×52,90) = 242,50 · com 10% = 218,25
    const upd = fake.ultimaGravacao('orders', 'update')?.valores as { total: number };
    expect(upd.total).toBeCloseTo(218.25, 2);
  });

  it('lê o tamanho do banco, nunca do corpo da requisição', () => {
    const consultas = fake.filtrosDe('product_variants', 'in');
    expect(consultas.length).toBeGreaterThan(0);
    expect(consultas[0]?.args[1]).toEqual(['v-gg', 'v-48']);
  });
});

describe('quem não pode', () => {
  afterAll(() => {
    vi.doUnmock('../apps/api/src/config/supabase.js');
  });

  it('representante não mexe em pedido dos outros', async () => {
    vi.resetModules();
    const { app } = await subir({
      orders: { data: { ...PEDIDO_NA_TRIAGEM, rep_id: 'rep-2' }, error: null },
    });
    const res = await app.inject({
      method: 'PATCH',
      url: '/orders/o1/items',
      headers: { authorization: `Bearer ${TOKEN_REP}` },
      payload: { items: [{ product_id: 'p1', quantity: 1 }] },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('o representante ainda alterna o PRÓPRIO pedido na fila — até a fábrica decidir', async () => {
    // O pedido do rep nasce direto em pending_approval: se a fila fechasse a
    // mão dele, não haveria janela nenhuma para corrigir o que acabou de passar
    // (foi exatamente o que travou a Simone em 14/08/2026).
    vi.resetModules();
    const { app } = await subir({
      orders: [
        { data: { ...PEDIDO_NA_TRIAGEM, status: 'pending_approval' }, error: null },
        { data: { id: 'o1' }, error: null },
        { data: { ...PEDIDO_NA_TRIAGEM, status: 'pending_approval', items: [] }, error: null },
      ],
      product_prices: [
        { data: [{ price_larger: null }], error: null },
        { data: [{ product_id: 'p1', price: 41.9, price_larger: 52.9 }], error: null },
      ],
      product_variants: { data: [{ id: 'v-gg', size: 'GG' }], error: null },
      order_items: [
        { data: [], error: null },
        { data: null, error: null },
        { data: null, error: null },
      ],
    });
    const res = await app.inject({
      method: 'PATCH',
      url: '/orders/o1/items',
      headers: { authorization: `Bearer ${TOKEN_REP}` },
      payload: { items: [{ product_id: 'p1', variant_id: 'v-gg', quantity: 1 }] },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('depois que a fábrica DECIDE (aprovado), o representante não mexe mais', async () => {
    vi.resetModules();
    const { app } = await subir({
      orders: { data: { ...PEDIDO_NA_TRIAGEM, status: 'approved' }, error: null },
    });
    const res = await app.inject({
      method: 'PATCH',
      url: '/orders/o1/items',
      headers: { authorization: `Bearer ${TOKEN_REP}` },
      payload: { items: [{ product_id: 'p1', quantity: 1 }] },
    });
    expect(res.statusCode).toBe(409);
    await app.close();
  });

  it('a loja não edita o pedido depois de mandar', async () => {
    vi.resetModules();
    const { app } = await subir({ orders: { data: PEDIDO_NA_TRIAGEM, error: null } });
    const res = await app.inject({
      method: 'PATCH',
      url: '/orders/o1/items',
      headers: { authorization: `Bearer ${TOKEN_LOJA}` },
      payload: { items: [{ product_id: 'p1', quantity: 1 }] },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('pedido sem peça nenhuma é recusado — cancelar tem caminho próprio', async () => {
    vi.resetModules();
    const { app } = await subir({ orders: { data: PEDIDO_NA_TRIAGEM, error: null } });
    const res = await app.inject({
      method: 'PATCH',
      url: '/orders/o1/items',
      headers: { authorization: `Bearer ${TOKEN_REP}` },
      payload: { items: [] },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('peça sem preço na tabela derruba a edição inteira, com motivo', async () => {
    vi.resetModules();
    const { app } = await subir({
      orders: { data: PEDIDO_NA_TRIAGEM, error: null },
      product_prices: [
        { data: [{ price_larger: null }], error: null },
        { data: [], error: null },
      ],
      product_variants: { data: [], error: null },
    });
    const res = await app.inject({
      method: 'PATCH',
      url: '/orders/o1/items',
      headers: { authorization: `Bearer ${TOKEN_REP}` },
      payload: { items: [{ product_id: 'p-sem-preco', quantity: 1 }] },
    });
    expect(res.statusCode).toBe(422);
    await app.close();
  });
});

describe('o desconto entra na MONTAGEM do pedido', () => {
  // O pedido do representante nasce direto na fila do gerente — nunca passa por
  // um "antes de mandar". Se a % não entrar no create, ela não existe para ele.
  afterAll(() => {
    vi.doUnmock('../apps/api/src/config/supabase.js');
  });

  const criarComDesconto = async (token: string, extra: Record<string, unknown> = {}) => {
    vi.resetModules();
    const { app, fake } = await subir({
      customers: [
        { data: { price_table_id: TABELA }, error: null },
        { data: { id: 'c1', blocked: false }, error: null },
      ],
      users: { data: { price_table_id: TABELA }, error: null },
      product_prices: [
        { data: [{ price_larger: null }], error: null },
        { data: [{ product_id: 'p1', price: 41.9, price_larger: 52.9 }], error: null },
      ],
      product_variants: {
        data: [
          { id: 'v-gg', size: 'GG' },
          { id: 'v-48', size: '48' },
        ],
        error: null,
      },
      orders: [
        { data: { id: 'o1' }, error: null },
        { data: { id: 'o1', items: [] }, error: null },
      ],
      order_items: { data: [], error: null },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        customer_id: 'c1',
        submit: true,
        discount_percent: 10,
        items: [
          { product_id: 'p1', variant_id: 'v-gg', quantity: 2, unit_price: 1 },
          { product_id: 'p1', variant_id: 'v-48', quantity: 3, unit_price: 1 },
        ],
        ...extra,
      },
    });
    const gravado = fake.ultimaGravacao('orders', 'insert')?.valores as Record<string, unknown>;
    await app.close();
    return { status: res.statusCode, gravado };
  };

  it('o pedido do rep nasce com a % gravada e o total já descontado', async () => {
    const { status, gravado } = await criarComDesconto(TOKEN_REP);
    expect(status).toBe(201);
    // (2×41,90 + 3×52,90) = 242,50 · com 10% = 218,25
    expect(gravado['discount_percent']).toBe(10);
    expect(gravado['total']).toBeCloseTo(218.25, 2);
  });

  it('a % da loja é descartada — o desconto é a palavra do representante', async () => {
    const { status, gravado } = await criarComDesconto(TOKEN_LOJA);
    expect(status).toBe(201);
    expect(gravado['discount_percent']).toBeUndefined();
    expect(gravado['total']).toBeCloseTo(242.5, 2);
  });
});

describe('quem mexe no pedido — a regra do gerente', () => {
  // Revisão de 14/08/2026: "o gerente pode mudar o pedido do representante e
  // do cliente". Desconto, peças e condição de pagamento seguem o MESMO portão.
  const TOKEN_GERENTE = assinar({
    sub: 'ger-1',
    email: 'gerente@csb.com',
    company_id: EMPRESA,
    name: 'GERENTE',
    role: 'manager',
    permissions: ['aprovar_pedidos'],
  });

  afterAll(() => {
    vi.doUnmock('../apps/api/src/config/supabase.js');
  });

  it('a loja não dá desconto', async () => {
    vi.resetModules();
    const { app } = await subir({ orders: { data: PEDIDO_NA_TRIAGEM, error: null } });
    const res = await app.inject({
      method: 'PATCH',
      url: '/orders/o1/desconto',
      headers: { authorization: `Bearer ${TOKEN_LOJA}` },
      payload: { desconto: 10 },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('o gerente dá desconto no pedido que já está na fila dele', async () => {
    vi.resetModules();
    const { app, fake } = await subir({
      orders: [
        { data: { ...PEDIDO_NA_TRIAGEM, status: 'pending_approval' }, error: null },
        { data: { id: 'o1', total: 90, discount_percent: 10 }, error: null },
      ],
      order_items: { data: [{ total: 100 }], error: null },
    });
    const res = await app.inject({
      method: 'PATCH',
      url: '/orders/o1/desconto',
      headers: { authorization: `Bearer ${TOKEN_GERENTE}` },
      payload: { desconto: 10 },
    });
    expect(res.statusCode).toBe(200);
    const upd = fake.ultimaGravacao('orders', 'update')?.valores as { total: number };
    expect(upd.total).toBeCloseTo(90, 2);
    await app.close();
  });

  it('o gerente edita as peças até do pedido já aprovado, enquanto não vira nota', async () => {
    vi.resetModules();
    const { app, fake } = await subir({
      orders: [
        { data: { ...PEDIDO_NA_TRIAGEM, status: 'approved', discount_percent: 0 }, error: null },
        { data: { id: 'o1' }, error: null },
        { data: { ...PEDIDO_NA_TRIAGEM, status: 'approved', items: [] }, error: null },
      ],
      product_prices: [
        { data: [{ price_larger: null }], error: null },
        { data: [{ product_id: 'p1', price: 41.9, price_larger: 52.9 }], error: null },
      ],
      product_variants: { data: [{ id: 'v-gg', size: 'GG' }], error: null },
      order_items: [
        { data: [], error: null },
        { data: null, error: null },
        { data: null, error: null },
      ],
    });
    const res = await app.inject({
      method: 'PATCH',
      url: '/orders/o1/items',
      headers: { authorization: `Bearer ${TOKEN_GERENTE}` },
      payload: { items: [{ product_id: 'p1', variant_id: 'v-gg', quantity: 2 }] },
    });
    expect(res.statusCode).toBe(200);
    const inseridos = (fake.ultimaGravacao('order_items', 'insert')?.valores ?? []) as Array<{
      unit_price: number;
    }>;
    expect(inseridos[0]?.unit_price).toBe(41.9);
    await app.close();
  });

  it('o gerente troca a condição de pagamento do pedido na fila', async () => {
    vi.resetModules();
    const CONDICAO = '22222222-2222-4222-8222-222222222222';
    const { app, fake } = await subir({
      orders: [
        { data: { ...PEDIDO_NA_TRIAGEM, status: 'pending_approval' }, error: null },
        // detector da coluna payment_condition_id (028)
        { data: [{ payment_condition_id: null }], error: null },
        { data: { id: 'o1', payment_condition_id: CONDICAO }, error: null },
      ],
      payment_conditions: { data: { id: CONDICAO, active: true }, error: null },
    });
    const res = await app.inject({
      method: 'PATCH',
      url: '/orders/o1/pagamento',
      headers: { authorization: `Bearer ${TOKEN_GERENTE}` },
      payload: { payment_condition_id: CONDICAO },
    });
    expect(res.statusCode).toBe(200);
    const upd = fake.ultimaGravacao('orders', 'update')?.valores as {
      payment_condition_id: string | null;
    };
    expect(upd.payment_condition_id).toBe(CONDICAO);
    await app.close();
  });

  it('condição inválida é recusada com motivo — trocar não é a criação, onde ela é acessória', async () => {
    vi.resetModules();
    const { app } = await subir({
      orders: [
        { data: PEDIDO_NA_TRIAGEM, error: null },
        { data: [{ payment_condition_id: null }], error: null },
      ],
      payment_conditions: { data: null, error: null },
    });
    const res = await app.inject({
      method: 'PATCH',
      url: '/orders/o1/pagamento',
      headers: { authorization: `Bearer ${TOKEN_REP}` },
      payload: { payment_condition_id: '11111111-1111-4111-8111-111111111111' },
    });
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it('gerente SEM a tecla de aprovar não mexe em nada', async () => {
    vi.resetModules();
    const SEM_TECLA = assinar({
      sub: 'ger-2',
      email: 'g2@csb.com',
      company_id: EMPRESA,
      name: 'G2',
      role: 'manager',
      permissions: [],
    });
    const { app } = await subir({ orders: { data: PEDIDO_NA_TRIAGEM, error: null } });
    const res = await app.inject({
      method: 'PATCH',
      url: '/orders/o1/desconto',
      headers: { authorization: `Bearer ${SEM_TECLA}` },
      payload: { desconto: 10 },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
