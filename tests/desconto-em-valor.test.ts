import { describe, it, expect, vi, afterAll } from 'vitest';
import crypto from 'node:crypto';
import { criarSupabaseFake } from './supabaseFake.js';

/**
 * Desconto em REAIS.
 *
 * O representante negocia dos dois jeitos — "tiro 10%" e "tiro R$ 8,90". O que
 * fica GUARDADO é sempre o percentual, porque é o que o formulário do Control
 * entende (AB46 é a taxa, AB47 = AB45*AB46). Quem digita reais tem o percentual
 * derivado PELO SERVIDOR, com a soma dos itens que ele mesmo calculou.
 *
 * O que estes testes trancam:
 *   1. o valor pedido é o valor descontado — até o centavo (foi por isso que a
 *      migração 032 levou o percentual de 2 para 6 casas: R$ 8,90 sobre
 *      R$ 1.234,56 dá 0,720915…%, e em duas casas voltaria R$ 8,89);
 *   2. desconto maior que o pedido é recusado, não vira 100%;
 *   3. o total nunca é calculado sobre o total anterior — sempre sobre a soma
 *      das peças, senão trocar o desconto acumularia.
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

const TOKEN_REP = assinar({
  sub: 'rep-1',
  email: 'rep@csb.com',
  company_id: EMPRESA,
  name: 'SIMONE',
  role: 'rep',
});

const PEDIDO = {
  id: 'o1',
  rep_id: 'rep-1',
  customer_id: 'c1',
  status: 'pending_approval',
  invoiced: false,
  discount_percent: 0,
  total: 0,
};

/** Sobe a app com o pedido somando `bruto` em itens. */
async function subir(bruto: number) {
  vi.resetModules();
  const fake = criarSupabaseFake({
    orders: [
      { data: PEDIDO, error: null },
      { data: { id: 'o1' }, error: null },
    ],
    order_items: { data: [{ total: bruto }], error: null },
  } as never);
  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
  const { buildApp } = await import('../apps/api/src/app.js');
  const app = await buildApp();
  await app.ready();
  return { app, fake };
}

const gravado = (fake: ReturnType<typeof criarSupabaseFake>) =>
  fake.ultimaGravacao('orders', 'update')?.valores as { discount_percent: number; total: number };

describe('desconto digitado em reais', () => {
  afterAll(() => {
    vi.doUnmock('../apps/api/src/config/supabase.js');
  });

  it('R$ 8,90 num pedido de R$ 1.234,56 tira exatamente R$ 8,90', async () => {
    const { app, fake } = await subir(1234.56);
    const res = await app.inject({
      method: 'PATCH',
      url: '/orders/o1/desconto',
      headers: { authorization: `Bearer ${TOKEN_REP}` },
      payload: { desconto_valor: 8.9 },
    });
    expect(res.statusCode).toBe(200);
    const g = gravado(fake);
    // O que importa para o lojista: o total. 1234,56 − 8,90 = 1225,66
    expect(g.total).toBeCloseTo(1225.66, 2);
    expect(1234.56 - g.total).toBeCloseTo(8.9, 2);
    await app.close();
  });

  it('R$ 97,90 também fecha no centavo', async () => {
    const { app, fake } = await subir(4907.3); // o pedido do print do Control
    const res = await app.inject({
      method: 'PATCH',
      url: '/orders/o1/desconto',
      headers: { authorization: `Bearer ${TOKEN_REP}` },
      payload: { desconto_valor: 97.9 },
    });
    expect(res.statusCode).toBe(200);
    const g = gravado(fake);
    expect(g.total).toBeCloseTo(4809.4, 2);
    await app.close();
  });

  it('o percentual guardado tem casas suficientes para não perder centavo', async () => {
    const { app, fake } = await subir(1234.56);
    await app.inject({
      method: 'PATCH',
      url: '/orders/o1/desconto',
      headers: { authorization: `Bearer ${TOKEN_REP}` },
      payload: { desconto_valor: 8.9 },
    });
    const g = gravado(fake);
    // 8,90 / 1234,56 = 0,720915…%  — em duas casas (0,72%) daria R$ 8,89.
    expect(g.discount_percent).toBeGreaterThan(0.7209);
    expect(g.discount_percent).toBeLessThan(0.721);
    await app.close();
  });

  it('desconto maior que o pedido é recusado — não vira 100%', async () => {
    const { app } = await subir(100);
    const res = await app.inject({
      method: 'PATCH',
      url: '/orders/o1/desconto',
      headers: { authorization: `Bearer ${TOKEN_REP}` },
      payload: { desconto_valor: 150 },
    });
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it('desconto igual ao pedido zera o total, e isso é permitido', async () => {
    const { app, fake } = await subir(100);
    const res = await app.inject({
      method: 'PATCH',
      url: '/orders/o1/desconto',
      headers: { authorization: `Bearer ${TOKEN_REP}` },
      payload: { desconto_valor: 100 },
    });
    expect(res.statusCode).toBe(200);
    expect(gravado(fake).total).toBe(0);
    await app.close();
  });

  it('o percentual continua funcionando como antes', async () => {
    const { app, fake } = await subir(1000);
    const res = await app.inject({
      method: 'PATCH',
      url: '/orders/o1/desconto',
      headers: { authorization: `Bearer ${TOKEN_REP}` },
      payload: { desconto: 10 },
    });
    expect(res.statusCode).toBe(200);
    const g = gravado(fake);
    expect(g.discount_percent).toBe(10);
    expect(g.total).toBeCloseTo(900, 2);
    await app.close();
  });

  it('mandar os dois ao mesmo tempo é recusado — não se adivinha qual vale', async () => {
    const { app } = await subir(1000);
    const res = await app.inject({
      method: 'PATCH',
      url: '/orders/o1/desconto',
      headers: { authorization: `Bearer ${TOKEN_REP}` },
      payload: { desconto: 10, desconto_valor: 50 },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
