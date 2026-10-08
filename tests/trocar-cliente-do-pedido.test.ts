import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { criarSupabaseFake, type ConsultaFeita } from './supabaseFake.js';
import { podeTrocarClienteDoPedido } from '@csb/shared';

/**
 * Trocar o CLIENTE do pedido (Yan, 08/10/2026): o representante mandou o
 * pedido na loja errada. Larissa (financeiro) e admin trocam até faturar; o
 * rep troca depois de salvar, mas "se ele enviar para a fábrica trava".
 * Muda só o customer_id do pedido — o cadastro de ninguém.
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
const TOKEN_GERENTE = assinar({ ...base, sub: 'ger-1', name: 'FABIAN', role: 'manager' });

const CLIENTE_ERRADO = '22222222-2222-4222-8222-222222222222';
const CLIENTE_CERTO = '33333333-3333-4333-8333-333333333333';

const PEDIDO = {
  id: 'o1',
  rep_id: 'rep-1',
  status: 'sent_erp',
  invoiced: false,
  order_number: 14800,
  customer_id: CLIENTE_ERRADO,
  price_table_id: 'tabela-1',
  erp_order_id: null,
};

async function subirApp(pedido: Record<string, unknown>, cliente: Record<string, unknown> | null) {
  const fake = criarSupabaseFake({
    // A leitura devolve o pedido como está; o UPDATE, o pedido já trocado.
    orders: (c: ConsultaFeita) =>
      c.operacao === 'update'
        ? { data: { ...PEDIDO, ...pedido, ...(c.valores as object) }, error: null }
        : { data: { ...PEDIDO, ...pedido }, error: null },
    customers: { data: cliente, error: null },
  } as never);
  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
  const { buildApp } = await import('../apps/api/src/app.js');
  const app = await buildApp();
  await app.ready();
  return { app, fake };
}

const trocar = (token: string, customer_id = CLIENTE_CERTO) => ({
  method: 'PATCH' as const,
  url: '/orders/o1/cliente',
  headers: { authorization: `Bearer ${token}` },
  payload: { customer_id },
});

const CERTO = { id: CLIENTE_CERTO, price_table_id: 'tabela-1', name: 'LOJA CERTA LTDA', trade_name: null };

beforeEach(() => {
  vi.resetModules();
});

describe('quem troca o cliente (a mesma regra na tela e na API)', () => {
  it('o rep troca depois de salvar; enviou para a fábrica, trava', () => {
    expect(podeTrocarClienteDoPedido({ status: 'draft', rep_id: 'r' }, 'rep', 'r')).toBe('ok');
    expect(podeTrocarClienteDoPedido({ status: 'pending_rep', rep_id: 'r' }, 'rep', 'r')).toBe('ok');
    expect(podeTrocarClienteDoPedido({ status: 'pending_approval', rep_id: 'r' }, 'rep', 'r')).toBe('ja_enviado');
    expect(podeTrocarClienteDoPedido({ status: 'approved', rep_id: 'r' }, 'rep', 'r')).toBe('ja_enviado');
    expect(podeTrocarClienteDoPedido({ status: 'draft', rep_id: 'outro' }, 'rep', 'r')).toBe('forbidden');
  });

  it('financeiro e admin trocam até faturar; gerente e loja não trocam', () => {
    expect(podeTrocarClienteDoPedido({ status: 'sent_erp', rep_id: 'r' }, 'financeiro', 'f')).toBe('ok');
    expect(podeTrocarClienteDoPedido({ status: 'pending_approval', rep_id: 'r' }, 'admin', 'a')).toBe('ok');
    expect(podeTrocarClienteDoPedido({ status: 'sent_erp', rep_id: 'r', invoiced: true }, 'financeiro', 'f')).toBe('faturado');
    expect(podeTrocarClienteDoPedido({ status: 'rejected', rep_id: 'r' }, 'admin', 'a')).toBe('cancelado');
    expect(podeTrocarClienteDoPedido({ status: 'draft', rep_id: 'r' }, 'manager', 'g')).toBe('forbidden');
    expect(podeTrocarClienteDoPedido({ status: 'draft', rep_id: 'r' }, 'store', 's')).toBe('forbidden');
  });
});

// Sobe o app inteiro: a primeira requisição passa dos 5 s padrão sob carga.
describe('PATCH /orders/:id/cliente', { timeout: 20_000 }, () => {
  it('a Larissa troca o cliente de um pedido já lançado: grava só o customer_id e avisa do Control', async () => {
    const { app, fake } = await subirApp({ erp_order_id: 'CS17400' }, CERTO);
    const res = await app.inject(trocar(TOKEN_FINANCEIRO));
    await app.close();

    expect(res.statusCode).toBe(200);
    const gravado = fake.ultimaGravacao('orders', 'update')?.valores as Record<string, unknown>;
    expect(Object.keys(gravado).sort()).toEqual(['customer_id', 'updated_at']);
    expect(gravado.customer_id).toBe(CLIENTE_CERTO);
    // O cadastro dos clientes não é tocado.
    expect(fake.ultimaGravacao('customers')).toBeUndefined();
    const corpo = res.json() as { data: { customer_id: string }; meta: { ja_no_control: boolean; tabela_diferente: boolean } };
    expect(corpo.data.customer_id).toBe(CLIENTE_CERTO);
    expect(corpo.meta).toEqual({ ja_no_control: true, tabela_diferente: false });
  });

  it('cliente novo de outra tabela: troca, mantém a tabela e os preços do pedido, e avisa', async () => {
    const { app, fake } = await subirApp({}, { ...CERTO, price_table_id: 'tabela-3' });
    const res = await app.inject(trocar(TOKEN_FINANCEIRO));
    await app.close();

    expect(res.statusCode).toBe(200);
    const gravado = fake.ultimaGravacao('orders', 'update')?.valores as Record<string, unknown>;
    expect(gravado).not.toHaveProperty('price_table_id');
    expect((res.json() as { meta: { tabela_diferente: boolean } }).meta.tabela_diferente).toBe(true);
  });

  it('o rep troca o próprio rascunho, só para cliente da carteira dele, e a gravação exige ainda rascunho', async () => {
    const { app, fake } = await subirApp({ status: 'draft' }, CERTO);
    const res = await app.inject(trocar(TOKEN_REP));
    await app.close();

    expect(res.statusCode).toBe(200);
    // A carteira: a consulta do cliente filtra pelo dono.
    expect(fake.filtrosDe('customers', 'eq').some((f) => f.args[0] === 'rep_id' && f.args[1] === 'rep-1')).toBe(true);
    // E o UPDATE só pega pedido que continua antes da fábrica.
    expect(
      fake.filtrosDe('orders', 'in').some((f) => f.args[0] === 'status' && JSON.stringify(f.args[1]) === '["draft","pending_rep"]'),
    ).toBe(true);
  });

  it('o rep não troca depois de enviar para a fábrica — 409, nada gravado', async () => {
    const { app, fake } = await subirApp({ status: 'pending_approval' }, CERTO);
    const res = await app.inject(trocar(TOKEN_REP));
    await app.close();

    expect(res.statusCode).toBe(409);
    expect((res.json() as { code: string }).code).toBe('JA_ENVIADO');
    expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();
  });

  it('cliente fora da carteira do rep — 404, nada gravado', async () => {
    const { app, fake } = await subirApp({ status: 'draft' }, null);
    const res = await app.inject(trocar(TOKEN_REP));
    await app.close();

    expect(res.statusCode).toBe(404);
    expect((res.json() as { code: string }).code).toBe('CLIENTE_NAO_ENCONTRADO');
    expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();
  });

  it('pedido faturado não troca — 409, nada gravado', async () => {
    const { app, fake } = await subirApp({ invoiced: true }, CERTO);
    const res = await app.inject(trocar(TOKEN_FINANCEIRO));
    await app.close();

    expect(res.statusCode).toBe(409);
    expect((res.json() as { code: string }).code).toBe('PEDIDO_FATURADO');
    expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();
  });

  it('o gerente não troca — 403 já na rota', async () => {
    const { app, fake } = await subirApp({ status: 'draft' }, CERTO);
    const res = await app.inject(trocar(TOKEN_GERENTE));
    await app.close();

    expect(res.statusCode).toBe(403);
    expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();
  });
});
