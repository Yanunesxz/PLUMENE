import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { criarSupabaseFake } from './supabaseFake.js';
import { podeCancelarPedido, MOTIVOS_DE_CANCELAMENTO_INICIAIS, ORDER_STATUS_LABELS } from '@csb/shared';

/**
 * Pedido CANCELADO com motivo (migração 053).
 *
 * Pedido da Larissa pelo Yan (30/09/2026): "qualquer pessoa pode cancelar,
 * mas quando chegar na Larissa ela é quem coloca"; aba Cancelados; motivos que
 * o admin cria, começando pelos quatro dele; observação opcional.
 */

const EMPRESA = 'empresa-1';
const SEGREDO = 'segredo-de-teste-nao-usar-em-producao'; // igual ao tests/setup.ts
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
function assinar(payload: Record<string, unknown>): string {
  const cabecalho = b64({ alg: 'HS256', typ: 'JWT' });
  const agora = Math.floor(Date.now() / 1000);
  const corpo = b64({ ...payload, iat: agora, exp: agora + 3600 });
  const assinatura = crypto.createHmac('sha256', SEGREDO).update(`${cabecalho}.${corpo}`).digest('base64url');
  return `${cabecalho}.${corpo}.${assinatura}`;
}
const base = { email: 'x@csb.com', company_id: EMPRESA, price_table_id: 'tabela-1' };
const TOKEN_FINANCEIRO = assinar({ ...base, sub: 'larissa', name: 'LARISSA', role: 'financeiro' });
const TOKEN_REP = assinar({ ...base, sub: 'rep-1', name: 'REINALDO', role: 'rep' });
const TOKEN_ADMIN = assinar({ ...base, sub: 'adm-1', name: 'YAN', role: 'admin' });

const MOTIVO_ID = '11111111-1111-4111-8111-111111111111';
const MOTIVO = { id: MOTIVO_ID, label: 'CLIENTE COM PARCELA VENCIDA', active: true };

async function subirApp(respostas: Record<string, unknown>) {
  const fake = criarSupabaseFake(respostas as never);
  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
  const { buildApp } = await import('../apps/api/src/app.js');
  const app = await buildApp();
  await app.ready();
  return { app, fake };
}

const cancelar = (token: string, payload: unknown = { reason_id: MOTIVO_ID }) => ({
  method: 'PATCH' as const,
  url: '/orders/o1/cancelar',
  headers: { authorization: `Bearer ${token}` },
  payload,
});

const pedido = (p: Record<string, unknown>) => ({
  data: { id: 'o1', rep_id: 'rep-1', status: 'sent_erp', invoiced: false, order_number: 14700, ...p },
  error: null,
});

beforeEach(() => {
  vi.resetModules();
});

describe('quem pode cancelar (a mesma regra na tela e na API)', () => {
  it('rep e gerente cancelam só ANTES de chegar ao financeiro', () => {
    expect(podeCancelarPedido({ status: 'draft', rep_id: 'r' }, 'rep', 'r')).toBe('ok');
    expect(podeCancelarPedido({ status: 'pending_rep', rep_id: 'r' }, 'rep', 'r')).toBe('ok');
    expect(podeCancelarPedido({ status: 'pending_approval', rep_id: 'r' }, 'rep', 'r')).toBe('com_o_financeiro');
    expect(podeCancelarPedido({ status: 'approved', rep_id: 'r' }, 'manager', 'g')).toBe('com_o_financeiro');
    expect(podeCancelarPedido({ status: 'pending_rep', rep_id: 'r' }, 'manager', 'g')).toBe('ok');
    expect(podeCancelarPedido({ status: 'draft', rep_id: 'outro' }, 'rep', 'r')).toBe('forbidden');
  });

  it('financeiro e admin cancelam até faturar, inclusive lançado no Control', () => {
    expect(podeCancelarPedido({ status: 'sent_erp', rep_id: 'r' }, 'financeiro', 'f')).toBe('ok');
    expect(podeCancelarPedido({ status: 'approved', rep_id: 'r' }, 'admin', 'a')).toBe('ok');
    expect(podeCancelarPedido({ status: 'sent_erp', rep_id: 'r', invoiced: true }, 'financeiro', 'f')).toBe('faturado');
    expect(podeCancelarPedido({ status: 'rejected', rep_id: 'r' }, 'admin', 'a')).toBe('ja_cancelado');
  });

  it('a venda interna cancela o próprio pedido até faturar', () => {
    expect(podeCancelarPedido({ status: 'approved', rep_id: 'si' }, 'rep', 'si', true)).toBe('ok');
    expect(podeCancelarPedido({ status: 'approved', rep_id: 'si', invoiced: true }, 'rep', 'si', true)).toBe('faturado');
  });

  it('nasce com os quatro motivos do Yan, e o status aparece como "Cancelado"', () => {
    expect(MOTIVOS_DE_CANCELAMENTO_INICIAIS).toEqual([
      'CLIENTE CANCELOU',
      'CLIENTE COM PROTESTO - REPRESENTANTE NÃO AUTORIZOU',
      'CLIENTE COM PARCELA VENCIDA',
      'PEDIDO EM DUPLICIDADE',
    ]);
    expect(ORDER_STATUS_LABELS.rejected).toBe('Cancelado');
  });
});

// Sobe o app inteiro: a primeira requisição passa dos 5 s padrão sob carga.
describe('PATCH /orders/:id/cancelar', { timeout: 20_000 }, () => {
  it('a Larissa cancela pedido já lançado: vai a rejected com motivo, observação, quem e quando', async () => {
    const { app, fake } = await subirApp({ orders: pedido({}), order_cancel_reasons: { data: MOTIVO, error: null } });
    const res = await app.inject(
      cancelar(TOKEN_FINANCEIRO, { reason_id: MOTIVO_ID, note: 'Cliente com 2 parcelas em aberto' }),
    );
    await app.close();

    expect(res.statusCode).toBe(200);
    const gravado = fake.ultimaGravacao('orders', 'update')?.valores as Record<string, unknown>;
    expect(gravado).toMatchObject({
      status: 'rejected',
      cancel_reason_id: MOTIVO_ID,
      cancel_reason_label: 'CLIENTE COM PARCELA VENCIDA',
      cancel_note: 'Cliente com 2 parcelas em aberto',
      cancelled_by: 'larissa',
    });
    expect(typeof gravado.cancelled_at).toBe('string');
    expect(typeof gravado.updated_at).toBe('string');
  });

  it('o representante não cancela pedido que já chegou ao financeiro — 409, nada gravado', async () => {
    const { app, fake } = await subirApp({
      orders: pedido({ status: 'pending_approval' }),
      order_cancel_reasons: { data: MOTIVO, error: null },
    });
    const res = await app.inject(cancelar(TOKEN_REP));
    await app.close();

    expect(res.statusCode).toBe(409);
    expect((res.json() as { code: string }).code).toBe('COM_O_FINANCEIRO');
    expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();
  });

  it('pedido faturado não cancela — 409, nada gravado', async () => {
    const { app, fake } = await subirApp({
      orders: pedido({ invoiced: true }),
      order_cancel_reasons: { data: MOTIVO, error: null },
    });
    const res = await app.inject(cancelar(TOKEN_FINANCEIRO));
    await app.close();

    expect(res.statusCode).toBe(409);
    expect((res.json() as { code: string }).code).toBe('PEDIDO_FATURADO');
    expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();
  });

  it('motivo desativado pelo admin é recusado — 422', async () => {
    const { app, fake } = await subirApp({
      orders: pedido({}),
      order_cancel_reasons: { data: { ...MOTIVO, active: false }, error: null },
    });
    const res = await app.inject(cancelar(TOKEN_FINANCEIRO));
    await app.close();

    expect(res.statusCode).toBe(422);
    expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();
  });

  it('sem motivo nenhum no corpo é recusado — 400', async () => {
    const { app } = await subirApp({ orders: pedido({}), order_cancel_reasons: { data: MOTIVO, error: null } });
    const res = await app.inject(cancelar(TOKEN_FINANCEIRO, { note: 'sem motivo' }));
    await app.close();

    expect(res.statusCode).toBe(400);
  });
});

describe('motivos de cancelamento: só o admin mexe', { timeout: 20_000 }, () => {
  it('o representante não cria motivo — 403', async () => {
    const { app, fake } = await subirApp({ order_cancel_reasons: { data: MOTIVO, error: null } });
    const res = await app.inject({
      method: 'POST',
      url: '/orders/motivos-de-cancelamento',
      headers: { authorization: `Bearer ${TOKEN_REP}` },
      payload: { label: 'qualquer' },
    });
    await app.close();

    expect(res.statusCode).toBe(403);
    expect(fake.ultimaGravacao('order_cancel_reasons', 'insert')).toBeUndefined();
  });

  it('o admin cria — o texto vai em maiúsculas, sem espaço sobrando', async () => {
    const { app, fake } = await subirApp({
      order_cancel_reasons: [
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
        { data: [{ sort_order: 4 }], error: null },
        { data: { id: 'novo', label: 'CLIENTE SEM LIMITE', active: true, sort_order: 5 }, error: null },
      ],
    });
    const res = await app.inject({
      method: 'POST',
      url: '/orders/motivos-de-cancelamento',
      headers: { authorization: `Bearer ${TOKEN_ADMIN}` },
      payload: { label: '  cliente   sem limite ' },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(fake.ultimaGravacao('order_cancel_reasons', 'insert')?.valores).toMatchObject({
      company_id: EMPRESA,
      label: 'CLIENTE SEM LIMITE',
    });
  });
});
