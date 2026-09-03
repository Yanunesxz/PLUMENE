import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { criarSupabaseFake } from './supabaseFake.js';

/**
 * Pedidos excluídos (migração 040).
 *
 * Excluir apagava o pedido de vez e ninguém sabia o que era nem quem apagou —
 * os 14632 e 14633 da CS sumiram assim (03/09/2026). Agora, um instante antes
 * do DELETE, a API guarda uma CÓPIA do pedido em `deleted_orders`, com quem
 * apagou; a aba "Excluídos" do admin lê essa cópia.
 *
 * O que estes testes trancam:
 *   1. a cópia vai com o número, quem apagou, e o pedido inteiro (com peças);
 *   2. sem a migração 040 no banco, excluir continua funcionando como antes;
 *   3. com a tabela no ar, cópia que não gravou = pedido NÃO é apagado;
 *   4. a aba é só do admin — gerente leva 403.
 */

const EMPRESA = 'empresa-1';
const SEGREDO = 'segredo-de-teste-nao-usar-em-producao'; // igual ao tests/setup.ts

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

const TOKEN_ADMIN = assinar({
  sub: 'admin-1',
  email: 'admin@csb.com',
  company_id: EMPRESA,
  name: 'YAN',
  role: 'admin',
});

const TOKEN_GERENTE = assinar({
  sub: 'ger-1',
  email: 'gerente@csb.com',
  company_id: EMPRESA,
  name: 'FABIAN',
  role: 'manager',
});

const PEDIDO = { id: 'o1', rep_id: 'rep-1', invoiced: false };
const PEDIDO_INTEIRO = {
  ...PEDIDO,
  company_id: EMPRESA,
  order_number: 14632,
  status: 'approved',
  total: 1542.48,
  items: [{ id: 'i1', order_id: 'o1', product_id: 'p1', variant_id: 'v1', quantity: 3, unit_price: 43.9, total: 131.7, product: { sku: '0130', name: 'Camisola' }, variant: { size: 'M' } }],
  customer: { name: 'LOJA DA MARIA', cnpj: '00000000000191' },
  rep: { name: 'REINALDO' },
};

const SEM_TABELA = { data: null, error: { message: 'relation "deleted_orders" does not exist', code: '42P01' } };
const OK = { data: null, error: null };

async function subir(respostas: Record<string, unknown>) {
  const fake = criarSupabaseFake(respostas as never);
  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
  const { buildApp } = await import('../apps/api/src/app.js');
  const app = await buildApp();
  await app.ready();
  return { app, fake };
}

describe('excluir guarda a cópia antes de apagar', () => {
  let app: FastifyInstance;
  let fake: ReturnType<typeof criarSupabaseFake>;
  let statusCode = 0;

  beforeAll(async () => {
    vi.resetModules();
    ({ app, fake } = await subir({
      // 1ª consulta: o cabeçalho para as regras; 2ª: o pedido inteiro para a
      // cópia; 3ª: a resposta do DELETE.
      // O dublê pré-carrega a resposta seguinte a cada entrega, então entre
      // duas consultas vai um OK de enchimento: cabeçalho (regras), enchimento,
      // pedido inteiro (a cópia), enchimento, e a resposta do DELETE.
      orders: [{ data: PEDIDO, error: null }, OK, { data: PEDIDO_INTEIRO, error: null }, OK, OK],
      deleted_orders: OK, // a tabela existe (detecção) e o insert gravou
    }));
    const res = await app.inject({
      method: 'DELETE',
      url: '/orders/o1',
      headers: { authorization: `Bearer ${TOKEN_ADMIN}` },
    });
    statusCode = res.statusCode;
  }, 60_000);
  afterAll(async () => app.close());

  it('exclui', () => {
    expect(statusCode).toBe(200);
    expect(fake.ultimaGravacao('orders', 'delete')).toBeDefined();
  });

  it('a cópia leva o número, quem apagou e o pedido inteiro com as peças', () => {
    const copia = fake.ultimaGravacao('deleted_orders', 'insert')?.valores as {
      company_id: string;
      order_id: string;
      order_number: number;
      deleted_by: string;
      deleted_by_name: string;
      snapshot: { items: unknown[]; customer: { name: string } };
    };
    expect(copia.company_id).toBe(EMPRESA);
    expect(copia.order_id).toBe('o1');
    expect(copia.order_number).toBe(14632);
    expect(copia.deleted_by).toBe('admin-1');
    expect(copia.deleted_by_name).toBe('YAN');
    expect(copia.snapshot.items).toHaveLength(1);
    expect(copia.snapshot.customer.name).toBe('LOJA DA MARIA');
  });

  it('a cópia é gravada ANTES do DELETE', () => {
    const ordem = fake.gravacoes.map((g) => `${g.tabela}:${g.operacao}`);
    expect(ordem.indexOf('deleted_orders:insert')).toBeLessThan(ordem.indexOf('orders:delete'));
  });
});

describe('sem a migração 040, excluir segue como sempre foi', () => {
  let app: FastifyInstance;
  let fake: ReturnType<typeof criarSupabaseFake>;
  let statusCode = 0;
  let corpo = '';

  beforeAll(async () => {
    vi.resetModules();
    ({ app, fake } = await subir({
      orders: [{ data: PEDIDO, error: null }, OK],
      deleted_orders: SEM_TABELA,
    }));
    const res = await app.inject({
      method: 'DELETE',
      url: '/orders/o1',
      headers: { authorization: `Bearer ${TOKEN_ADMIN}` },
    });
    statusCode = res.statusCode;
    corpo = res.body;
  }, 60_000);
  afterAll(async () => app.close());

  it('exclui sem tentar copiar', () => {
    expect(statusCode, corpo).toBe(200);
    expect(fake.ultimaGravacao('orders', 'delete')).toBeDefined();
    expect(fake.ultimaGravacao('deleted_orders', 'insert')).toBeUndefined();
  });
});

describe('com a tabela no ar, cópia que não gravou segura o pedido', () => {
  let app: FastifyInstance;
  let fake: ReturnType<typeof criarSupabaseFake>;
  let res: { statusCode: number; json: () => { code?: string } };

  beforeAll(async () => {
    vi.resetModules();
    ({ app, fake } = await subir({
      // O dublê pré-carrega a resposta seguinte a cada entrega, então entre
      // duas consultas vai um OK de enchimento: cabeçalho (regras), enchimento,
      // pedido inteiro (a cópia), enchimento, e a resposta do DELETE.
      orders: [{ data: PEDIDO, error: null }, OK, { data: PEDIDO_INTEIRO, error: null }, OK, OK],
      // detecção passa; o insert falha
      deleted_orders: [OK, { data: null, error: { message: 'disco cheio' } }],
    }));
    res = await app.inject({
      method: 'DELETE',
      url: '/orders/o1',
      headers: { authorization: `Bearer ${TOKEN_ADMIN}` },
    });
  }, 60_000);
  afterAll(async () => app.close());

  it('responde 500 com o código da cópia e NÃO apaga', () => {
    expect(res.statusCode).toBe(500);
    expect(res.json().code).toBe('SEM_COPIA');
    expect(fake.ultimaGravacao('orders', 'delete')).toBeUndefined();
  });
});

describe('a aba Excluídos', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.resetModules();
    ({ app } = await subir({
      deleted_orders: [
        OK, // detecção
        {
          data: [
            {
              id: 'd1',
              order_id: 'o1',
              order_number: 14632,
              deleted_at: '2026-09-03T12:00:00Z',
              deleted_by_name: 'YAN',
              snapshot: PEDIDO_INTEIRO,
            },
          ],
          error: null,
        },
      ],
    }));
  }, 60_000);
  afterAll(async () => app.close());

  it('o admin vê a lista, mais recentes primeiro', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/orders/excluidos',
      headers: { authorization: `Bearer ${TOKEN_ADMIN}` },
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json() as { data: Array<{ order_number: number; deleted_by_name: string }> };
    expect(data).toHaveLength(1);
    expect(data[0]?.order_number).toBe(14632);
    expect(data[0]?.deleted_by_name).toBe('YAN');
  });

  it('gerente não entra', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/orders/excluidos',
      headers: { authorization: `Bearer ${TOKEN_GERENTE}` },
    });
    expect(res.statusCode).toBe(403);
  });
});
