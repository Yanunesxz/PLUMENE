import { describe, it, expect, vi, afterAll } from 'vitest';
import crypto from 'node:crypto';
import { criarSupabaseFake } from './supabaseFake.js';

/**
 * A área "Enviar pra fábrica" — o pedido do representante NÃO vai direto.
 *
 * Regra do Yan (14/08/2026): a Simone passa o pedido, ele fica salvo como
 * rascunho na área "Enviar pra fábrica", ela confere e altera com calma, e só
 * quando ELA mandar é que o pedido entra na fila do gerente.
 *
 * O que estes testes trancam:
 *   1. o pedido salvo nasce rascunho (submit: false) — inclusive vindo da fila
 *      offline, que antes forçava o envio;
 *   2. o próprio representante move o rascunho para a fila quando quiser;
 *   3. o pedido da LOJA não muda: cai na triagem do representante, como sempre.
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

async function subir(respostas: Record<string, unknown>) {
  const fake = criarSupabaseFake(respostas as never);
  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
  const { buildApp } = await import('../apps/api/src/app.js');
  const app = await buildApp();
  await app.ready();
  return { app, fake };
}

const RESPOSTAS_DO_CREATE = {
  customers: [
    { data: { price_table_id: TABELA }, error: null },
    { data: { id: 'c1', blocked: false }, error: null },
  ],
  product_prices: [
    { data: [{ price_larger: null }], error: null },
    { data: [{ product_id: 'p1', price: 41.9, price_larger: null }], error: null },
  ],
  product_variants: { data: [{ id: 'v-m', size: 'M' }], error: null },
  orders: [
    { data: { id: 'o1' }, error: null },
    { data: { id: 'o1', items: [] }, error: null },
  ],
  order_items: { data: [], error: null },
};

describe('o pedido salvo não vai direto para a fábrica', () => {
  afterAll(() => {
    vi.doUnmock('../apps/api/src/config/supabase.js');
  });

  it('sem o "enviar", o pedido do rep nasce rascunho', async () => {
    vi.resetModules();
    const { app, fake } = await subir(RESPOSTAS_DO_CREATE);
    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: `Bearer ${TOKEN_REP}` },
      payload: {
        customer_id: 'c1',
        submit: false,
        items: [{ product_id: 'p1', variant_id: 'v-m', quantity: 2, unit_price: 1 }],
      },
    });
    expect(res.statusCode).toBe(201);
    const gravado = fake.ultimaGravacao('orders', 'insert')?.valores as { status: string };
    expect(gravado.status).toBe('draft');
    await app.close();
  });

  it('o rep move o próprio rascunho para a fila quando conferir', async () => {
    vi.resetModules();
    const { app, fake } = await subir({
      orders: [
        { data: { status: 'draft', rep_id: 'rep-1' }, error: null },
        { data: { id: 'o1', status: 'pending_approval' }, error: null },
      ],
    });
    const res = await app.inject({
      method: 'PATCH',
      url: '/orders/o1/status',
      headers: { authorization: `Bearer ${TOKEN_REP}` },
      payload: { status: 'pending_approval' },
    });
    expect(res.statusCode).toBe(200);
    const upd = fake.ultimaGravacao('orders', 'update')?.valores as { status: string };
    expect(upd.status).toBe('pending_approval');
    await app.close();
  });

  it('a fila offline também vira rascunho — antes ela forçava o envio', async () => {
    vi.resetModules();
    const fake = criarSupabaseFake({
      ...RESPOSTAS_DO_CREATE,
      customers: { data: { id: 'c1', blocked: false }, error: null },
      orders: [
        { data: null, error: null }, // pedidoDoLocalId: nada com esse local_id
        { data: { id: 'o1' }, error: null },
        { data: { id: 'o1', items: [] }, error: null },
      ],
    } as never);
    vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
    const { processSyncQueue } = await import('../apps/api/src/modules/sync/sync.service.js');

    const resultado = await processSyncQueue(EMPRESA, 'rep-1', TABELA, [
      {
        local_id: 'local-1',
        customer_id: 'c1',
        items: [{ product_id: 'p1', variant_id: 'v-m', quantity: 1, unit_price: 1 }],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);

    expect(resultado.synced).toBe(1);
    const gravado = fake.ultimaGravacao('orders', 'insert')?.valores as { status: string };
    expect(gravado.status).toBe('draft');
  });

  it('o pedido da loja segue caindo na triagem do representante', async () => {
    vi.resetModules();
    const TOKEN_LOJA = assinar({
      sub: 'loja-1',
      email: 'loja@csb.com',
      company_id: EMPRESA,
      name: 'LOJA',
      role: 'store',
      customer_id: 'c1',
      rep_id: 'rep-1',
    });
    const { app, fake } = await subir(RESPOSTAS_DO_CREATE);
    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: `Bearer ${TOKEN_LOJA}` },
      payload: {
        submit: false,
        items: [{ product_id: 'p1', variant_id: 'v-m', quantity: 1, unit_price: 1 }],
      },
    });
    expect(res.statusCode).toBe(201);
    const gravado = fake.ultimaGravacao('orders', 'insert')?.valores as { status: string };
    expect(gravado.status).toBe('pending_rep');
    await app.close();
  });
});
