import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { faixaDoTamanho, precoDoTamanho } from '@csb/shared';
import { criarSupabaseFake } from './supabaseFake.js';

/**
 * O preço da FAIXA MAIOR (EG / XG / 48-54).
 *
 * A tabela oficial da fábrica sempre listou cada referência em duas linhas —
 * "P AO GG R$ 41,90" e "48 AO 54 R$ 52,90" — mas o sistema só guardava a
 * primeira. Resultado: 138 das 193 referências ativas vendiam o corpo maior
 * pelo preço do normal, de R$ 2 a R$ 10 a menos por peça.
 *
 * O que estes testes trancam:
 *   1. quem é faixa maior e quem não é;
 *   2. que o tamanho normal NUNCA paga o preço maior;
 *   3. que o servidor decide o preço pelo tamanho gravado no banco, e não pelo
 *      que o aparelho mandou — senão bastaria adulterar o pedido para levar EG
 *      pelo preço do M.
 */

describe('quem é faixa maior', () => {
  it('reconhece as letras do cadastro e as do Control como a mesma faixa', () => {
    for (const t of ['EG', 'EGG', 'EGGG', 'XG', 'XG2', 'XG3', 'XG4']) {
      expect(faixaDoTamanho(t)).toBe('maior');
    }
  });

  it('reconhece a grade plus 48-54 das quatro referências que a têm', () => {
    for (const t of ['48', '50', '52', '54']) {
      expect(faixaDoTamanho(t)).toBe('maior');
    }
  });

  it('não confunde a grade adulta normal com a faixa maior', () => {
    for (const t of ['PP', 'P', 'M', 'G', 'GG']) {
      expect(faixaDoTamanho(t)).toBe('normal');
    }
  });

  it('deixa infantil e juvenil de fora — no PDF eles têm preço único', () => {
    for (const t of ['2', '4', '6', '8', '10', '12', '14', '16']) {
      expect(faixaDoTamanho(t)).toBe('normal');
    }
  });

  it('trata o zero à esquerda da fábrica como número ("08" é o 8, não uma letra)', () => {
    expect(faixaDoTamanho('08')).toBe('normal');
    expect(faixaDoTamanho(' eg ')).toBe('maior');
  });

  it('tamanho ausente cai na faixa normal, nunca na maior', () => {
    expect(faixaDoTamanho(null)).toBe('normal');
    expect(faixaDoTamanho(undefined)).toBe('normal');
    expect(faixaDoTamanho('')).toBe('normal');
  });
});

describe('o preço de um tamanho', () => {
  it('cobra a faixa maior no EG', () => {
    expect(precoDoTamanho('EG', 41.9, 52.9)).toBe(52.9);
  });

  it('cobra a faixa normal no G', () => {
    expect(precoDoTamanho('G', 41.9, 52.9)).toBe(41.9);
  });

  it('cai para o preço normal quando a peça não tem faixa maior cadastrada', () => {
    // As 55 referências infantis/juvenis do PDF, e todo o catálogo enquanto a
    // migração 026 não roda.
    expect(precoDoTamanho('EG', 41.9, null)).toBe(41.9);
  });

  it('NUNCA cobra o preço maior de um tamanho normal', () => {
    expect(precoDoTamanho('M', 41.9, 52.9)).toBe(41.9);
    expect(precoDoTamanho(null, 41.9, 52.9)).toBe(41.9);
  });

  it('devolve null quando o produto não tem preço na tabela', () => {
    expect(precoDoTamanho('EG', null, null)).toBeNull();
  });
});

// ─── O pedido gravado ────────────────────────────────────────────────────────

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

async function subir() {
  const fake = criarSupabaseFake({
    customers: [
      { data: { price_table_id: TABELA }, error: null },
      { data: { id: 'c1', blocked: false }, error: null },
    ],
    users: { data: { price_table_id: TABELA }, error: null },
    product_prices: [
      // 1ª consulta: o detector da migração 026 perguntando se a coluna existe.
      { data: [{ price_larger: null }], error: null },
      // 2ª: os preços de verdade — as duas faixas do 0706 na tabela oficial.
      { data: [{ product_id: 'p1', price: 41.9, price_larger: 52.9 }], error: null },
    ],
    // O tamanho de cada variante vem DAQUI, nunca do corpo da requisição.
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
  } as never);

  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
  const { buildApp } = await import('../apps/api/src/app.js');
  const app = await buildApp();
  await app.ready();
  return { app, fake };
}

describe('o pedido grava o preço da faixa certa', () => {
  let app: FastifyInstance;
  let fake: ReturnType<typeof criarSupabaseFake>;

  beforeAll(async () => {
    vi.resetModules();
    ({ app, fake } = await subir());

    await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: `Bearer ${TOKEN_REP}` },
      payload: {
        customer_id: 'c1',
        submit: true,
        items: [
          // O aparelho manda 1 real nos dois, de propósito: o servidor tem de
          // ignorar e refazer a conta pela tabela.
          { product_id: 'p1', variant_id: 'v-gg', quantity: 2, unit_price: 1 },
          { product_id: 'p1', variant_id: 'v-48', quantity: 3, unit_price: 1 },
        ],
      },
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  const itens = () =>
    (fake.ultimaGravacao('order_items', 'insert')?.valores ?? []) as Array<{
      variant_id: string;
      unit_price: number;
      total: number;
    }>;

  it('cobra o preço normal no GG', () => {
    const gg = itens().find((i) => i.variant_id === 'v-gg');
    expect(gg?.unit_price).toBe(41.9);
    expect(gg?.total).toBeCloseTo(83.8, 2);
  });

  it('cobra o preço da faixa maior no 48 — o defeito que motivou a mudança', () => {
    const plus = itens().find((i) => i.variant_id === 'v-48');
    expect(plus?.unit_price).toBe(52.9);
    expect(plus?.total).toBeCloseTo(158.7, 2);
  });

  it('ignora o unit_price que veio do aparelho', () => {
    expect(itens().every((i) => i.unit_price !== 1)).toBe(true);
  });

  it('lê o tamanho do banco, e não do pedido — senão dava para escolher o preço', () => {
    const consultou = fake.filtrosDe('product_variants', 'in');
    expect(consultou.length).toBeGreaterThan(0);
    expect(consultou[0]?.args[1]).toEqual(['v-gg', 'v-48']);
  });
});
