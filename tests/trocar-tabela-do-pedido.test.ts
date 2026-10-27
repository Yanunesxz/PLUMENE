import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { criarSupabaseFake, type Responder, type RespostaTabela } from './supabaseFake.js';
import { podeTrocarTabelaDoPedido, pedidoJaLancadoNoControl } from '@csb/shared';

/**
 * TROCAR A TABELA DE PREÇO DO PEDIDO já feito (Yan, 27/10/2026): "pode ser, e
 * cria pra vendedora interna também, mas até lançar pro financeiro; não pra
 * todos os reps, só pra vendedora interna."
 *
 * Trancado aqui: quem pode e até quando (shared e rota), a prévia que não
 * grava, o repreço dos itens pela tabela nova, e que nada muda quando falta
 * preço ou a tabela foi desligada no Control.
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
const TOKEN = {
  financeiro: assinar({ ...base, sub: 'larissa', name: 'LARISSA', role: 'financeiro' }),
  admin: assinar({ ...base, sub: 'adm-1', name: 'YAN', role: 'admin' }),
  rep: assinar({ ...base, sub: 'rep-1', name: 'REINALDO', role: 'rep' }),
  vendaInterna: assinar({ ...base, sub: 'rep-1', name: 'SIMONE', role: 'rep', venda_interna: true }),
  vendaInternaOutra: assinar({ ...base, sub: 'rep-9', name: 'OUTRA', role: 'rep', venda_interna: true }),
  gerente: assinar({ ...base, sub: 'ger-1', name: 'WESLEY', role: 'manager', permissions: null }),
  loja: assinar({ ...base, sub: 'loja-1', name: 'LOJA', role: 'store', customer_id: 'c1' }),
};

const NOVA = '11111111-1111-4111-8111-111111111111';
const VELHA = '22222222-2222-4222-8222-222222222222';

const PEDIDO = {
  id: 'o1',
  company_id: EMPRESA,
  rep_id: 'rep-1',
  customer_id: 'c1',
  status: 'approved',
  invoiced: false,
  erp_order_id: null,
  erp_requested_at: null,
  price_table_id: VELHA,
  discount_percent: 0,
  order_number: 14700,
  total: 40,
  items: [{ id: 'i1', order_id: 'o1', product_id: 'p1', variant_id: 'v1', quantity: 2, unit_price: 20, total: 40 }],
};

const SONDA: RespostaTabela = { data: [], error: null };

interface Opcoes {
  pedido?: Record<string, unknown>;
  tabela?: Record<string, unknown> | null;
  precos?: unknown[];
}

function banco(o: Opcoes = {}): Record<string, Responder> {
  const pedido = { ...PEDIDO, ...(o.pedido ?? {}) };
  const tabela = o.tabela === undefined ? { id: NOVA, company_id: EMPRESA, name: 'TABELA 02 - 2027', active: true } : o.tabela;
  const precos = o.precos ?? [{ product_id: 'p1', price: 30, price_larger: null }];
  const colunaDe = (c: { filtros: Array<{ metodo: string; args: unknown[] }> }) =>
    c.filtros.find((f) => f.metodo === 'select')?.args[0];
  return {
    orders: (c) => {
      if (c.operacao === 'update') return { data: { id: 'o1' }, error: null };
      if (colunaDe(c) === 'price_table_id') return SONDA;
      return { data: pedido, error: null };
    },
    price_tables: (c) => (c.operacao === 'select' ? { data: tabela ? [tabela] : [], error: null } : SONDA),
    product_prices: (c) => (colunaDe(c) === 'price_larger' ? SONDA : { data: precos, error: null }),
    product_variants: () => ({ data: [{ id: 'v1', size: 'M' }], error: null }),
    order_items: (c) => (c.operacao === 'select' ? { data: pedido.items, error: null } : { data: null, error: null }),
  };
}

async function subirApp(respostas: Record<string, Responder>) {
  const fake = criarSupabaseFake(respostas as never);
  const aviso = vi.fn();
  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
  vi.doMock('../apps/api/src/modules/orders/pedidoOriginal.service.js', () => ({
    guardarOriginal: vi.fn(async () => 'ja_tinha'),
    lerOriginal: vi.fn(async () => null),
  }));
  vi.doMock('../apps/api/src/modules/orders/erpSync.service.js', async (importar) => ({
    ...(await importar<Record<string, unknown>>()),
    garantirFotoDoErp: vi.fn(async () => 'guardada'),
  }));
  vi.doMock('../apps/api/src/modules/push/push.avisos.js', async (importar) => ({
    ...(await importar<Record<string, unknown>>()),
    avisarTabelaTrocadaAoRep: aviso,
  }));
  const { buildApp } = await import('../apps/api/src/app.js');
  const app = await buildApp();
  await app.ready();
  return { app, fake, aviso };
}

const trocar = (token: string, payload: unknown = { price_table_id: NOVA }) => ({
  method: 'PATCH' as const,
  url: '/orders/o1/tabela',
  headers: { authorization: `Bearer ${token}` },
  payload,
});

beforeEach(() => {
  vi.resetModules();
});

// ─── A regra (shared) ────────────────────────────────────────────────────────

describe('quem troca a tabela do pedido e até quando (Yan, 27/10/2026)', () => {
  const p = { status: 'approved' as const, invoiced: false, rep_id: 'rep-1', erp_order_id: null, erp_requested_at: null };

  it('financeiro e admin trocam até faturar — mesmo com o pedido já no Control', () => {
    for (const papel of ['financeiro', 'admin'] as const) {
      expect(podeTrocarTabelaDoPedido(p, papel, 'x', false)).toBe('ok');
      expect(podeTrocarTabelaDoPedido({ ...p, status: 'sent_erp', erp_order_id: 'CS1' }, papel, 'x', false)).toBe('ok');
      expect(podeTrocarTabelaDoPedido({ ...p, invoiced: true }, papel, 'x', false)).toBe('faturado');
    }
  });

  it('a venda interna troca no PRÓPRIO pedido, até o financeiro lançar', () => {
    expect(podeTrocarTabelaDoPedido(p, 'rep', 'rep-1', true)).toBe('ok');
    expect(podeTrocarTabelaDoPedido({ ...p, status: 'draft' }, 'rep', 'rep-1', true)).toBe('ok');
    expect(podeTrocarTabelaDoPedido({ ...p, status: 'sent_erp' }, 'rep', 'rep-1', true)).toBe('ja_lancado');
    expect(podeTrocarTabelaDoPedido({ ...p, erp_order_id: 'CS1' }, 'rep', 'rep-1', true)).toBe('ja_lancado');
    expect(podeTrocarTabelaDoPedido({ ...p, erp_requested_at: '2026-10-27T10:00:00Z' }, 'rep', 'rep-1', true)).toBe('ja_lancado');
  });

  it('a venda interna não troca o pedido de OUTRA pessoa', () => {
    expect(podeTrocarTabelaDoPedido(p, 'rep', 'rep-9', true)).toBe('forbidden');
  });

  it('o representante comum NÃO troca — nem no próprio pedido', () => {
    expect(podeTrocarTabelaDoPedido(p, 'rep', 'rep-1', false)).toBe('forbidden');
    expect(podeTrocarTabelaDoPedido(p, 'rep', 'rep-1', undefined)).toBe('forbidden');
  });

  it('gerente, relacionamento, visualizador e loja não trocam', () => {
    for (const papel of ['manager', 'relacionamento', 'visualizador', 'store'] as const) {
      expect(podeTrocarTabelaDoPedido(p, papel, 'rep-1', false)).toBe('forbidden');
    }
  });

  it('cancelado e faturado não trocam, para ninguém', () => {
    expect(podeTrocarTabelaDoPedido({ ...p, status: 'rejected' }, 'admin', 'x', false)).toBe('cancelado');
    expect(podeTrocarTabelaDoPedido({ ...p, invoiced: true }, 'rep', 'rep-1', true)).toBe('faturado');
  });

  it('"já no Control" = lançado, com número ou pedido ao Control', () => {
    expect(pedidoJaLancadoNoControl(p)).toBe(false);
    expect(pedidoJaLancadoNoControl({ ...p, status: 'sent_erp' })).toBe(true);
    expect(pedidoJaLancadoNoControl({ ...p, erp_order_id: 'CS1' })).toBe(true);
    expect(pedidoJaLancadoNoControl({ ...p, erp_requested_at: '2026-10-27T10:00:00Z' })).toBe(true);
  });
});

// ─── A rota ──────────────────────────────────────────────────────────────────

describe('PATCH /orders/:id/tabela', { timeout: 20_000 }, () => {
  it('a prévia (simular) calcula o total novo e NÃO grava nada', async () => {
    const { app, fake } = await subirApp(banco());
    const res = await app.inject(trocar(TOKEN.financeiro, { price_table_id: NOVA, simular: true }));
    await app.close();
    expect(res.statusCode).toBe(200);
    const meta = (res.json() as { meta: Record<string, unknown> }).meta;
    expect(meta).toMatchObject({ total_antes: 40, total_depois: 60, mudou: false, tabela_antes: VELHA, tabela_depois: NOVA });
    expect(fake.gravacoes).toEqual([]);
  });

  it('o financeiro troca: grava a tabela e o total, e reprecifica os itens pela tabela nova', async () => {
    const { app, fake, aviso } = await subirApp(banco());
    const res = await app.inject(trocar(TOKEN.financeiro));
    await app.close();
    expect(res.statusCode).toBe(200);
    const upd = fake.gravacoes.find((g) => g.tabela === 'orders' && g.operacao === 'update');
    expect(upd?.valores).toMatchObject({ price_table_id: NOVA, total: 60 });
    const ins = fake.gravacoes.find((g) => g.tabela === 'order_items' && g.operacao === 'insert');
    expect(ins?.valores).toEqual([
      { order_id: 'o1', product_id: 'p1', variant_id: 'v1', quantity: 2, unit_price: 30, total: 60 },
    ]);
    // O pedido só troca se continua trocável (corrida com o faturamento).
    expect(fake.filtrosDe('orders', 'or').some((f) => String(f.args[0]).includes('invoiced'))).toBe(true);
    // O dono é avisado (o aviso é espião; o envio em si é do push).
    expect(aviso).toHaveBeenCalledTimes(1);
  });

  it('o desconto do pedido continua valendo no total novo', async () => {
    const { app, fake } = await subirApp(banco({ pedido: { discount_percent: 10 } }));
    const res = await app.inject(trocar(TOKEN.admin));
    await app.close();
    expect(res.statusCode).toBe(200);
    const upd = fake.gravacoes.find((g) => g.tabela === 'orders' && g.operacao === 'update');
    expect(upd?.valores).toMatchObject({ total: 54 }); // 60 × 0,9
  });

  it('a venda interna troca no próprio pedido, sem aviso a ela mesma', async () => {
    const { app, fake, aviso } = await subirApp(banco());
    const res = await app.inject(trocar(TOKEN.vendaInterna));
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(fake.gravacoes.some((g) => g.tabela === 'orders' && g.operacao === 'update')).toBe(true);
    expect(aviso).not.toHaveBeenCalled();
  });

  it('a venda interna, depois que o financeiro lançou: 409 JA_LANCADO, nada gravado', async () => {
    const { app, fake } = await subirApp(banco({ pedido: { status: 'sent_erp', erp_order_id: 'CS17565' } }));
    const res = await app.inject(trocar(TOKEN.vendaInterna));
    await app.close();
    expect(res.statusCode).toBe(409);
    expect((res.json() as { code: string }).code).toBe('JA_LANCADO');
    expect(fake.gravacoes).toEqual([]);
  });

  it('o financeiro troca mesmo com o pedido já lançado — e a resposta avisa que o Control também precisa', async () => {
    const { app } = await subirApp(banco({ pedido: { status: 'sent_erp', erp_order_id: 'CS17565' } }));
    const res = await app.inject(trocar(TOKEN.financeiro));
    await app.close();
    expect(res.statusCode).toBe(200);
    expect((res.json() as { meta: { ja_no_control: boolean } }).meta.ja_no_control).toBe(true);
  });

  it('representante comum, gerente, loja e venda interna de OUTRO pedido: 403', async () => {
    for (const t of [TOKEN.rep, TOKEN.gerente, TOKEN.loja, TOKEN.vendaInternaOutra]) {
      vi.resetModules();
      const { app, fake } = await subirApp(banco());
      const res = await app.inject(trocar(t));
      await app.close();
      expect(res.statusCode).toBe(403);
      expect(fake.gravacoes).toEqual([]);
    }
  });

  it('pedido faturado e pedido cancelado: 409, nada gravado', async () => {
    for (const [pedido, code] of [
      [{ invoiced: true }, 'PEDIDO_FATURADO'],
      [{ status: 'rejected' }, 'PEDIDO_CANCELADO'],
    ] as const) {
      vi.resetModules();
      const { app, fake } = await subirApp(banco({ pedido }));
      const res = await app.inject(trocar(TOKEN.admin));
      await app.close();
      expect(res.statusCode).toBe(409);
      expect((res.json() as { code: string }).code).toBe(code);
      expect(fake.gravacoes).toEqual([]);
    }
  });

  it('peça sem preço na tabela nova: 409 e NADA muda', async () => {
    const { app, fake } = await subirApp(banco({ precos: [] }));
    const res = await app.inject(trocar(TOKEN.financeiro));
    await app.close();
    expect(res.statusCode).toBe(409);
    expect((res.json() as { code: string }).code).toBe('PRECO_NAO_ENCONTRADO');
    expect(fake.gravacoes).toEqual([]);
  });

  it('tabela desligada no Control não se escolhe; tabela de outra empresa não existe', async () => {
    let r = await subirApp(banco({ tabela: { id: NOVA, company_id: EMPRESA, name: 'X', active: false } }));
    let res = await r.app.inject(trocar(TOKEN.admin));
    await r.app.close();
    expect(res.statusCode).toBe(409);
    expect((res.json() as { code: string }).code).toBe('TABELA_INATIVA');

    vi.resetModules();
    r = await subirApp(banco({ tabela: null }));
    res = await r.app.inject(trocar(TOKEN.admin));
    await r.app.close();
    expect(res.statusCode).toBe(404);
    expect((res.json() as { code: string }).code).toBe('TABELA_NAO_ENCONTRADA');
  });

  it('a mesma tabela (duplo toque): 200, nada gravado, mudou=false', async () => {
    const { app, fake } = await subirApp(banco({ pedido: { price_table_id: NOVA } }));
    const res = await app.inject(trocar(TOKEN.admin));
    await app.close();
    expect(res.statusCode).toBe(200);
    expect((res.json() as { meta: { mudou: boolean } }).meta.mudou).toBe(false);
    expect(fake.gravacoes).toEqual([]);
  });
});

describe('GET /orders/tabelas-para-trocar', { timeout: 20_000 }, () => {
  const ler = (token: string) => ({
    method: 'GET' as const,
    url: '/orders/tabelas-para-trocar',
    headers: { authorization: `Bearer ${token}` },
  });

  it('financeiro, admin e venda interna leem; o representante comum não', async () => {
    for (const [t, status] of [
      [TOKEN.financeiro, 200],
      [TOKEN.admin, 200],
      [TOKEN.vendaInterna, 200],
      [TOKEN.rep, 403],
      [TOKEN.gerente, 403],
      [TOKEN.loja, 403],
    ] as const) {
      vi.resetModules();
      const { app } = await subirApp(banco());
      const res = await app.inject(ler(t));
      await app.close();
      expect(res.statusCode).toBe(status);
    }
  });
});
