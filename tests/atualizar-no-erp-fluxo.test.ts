import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { criarSupabaseFake } from './supabaseFake.js';

/**
 * "Atualizar no ERP" (046) — o FLUXO, com o serviço da foto simulado.
 *
 * Os testes do serviço (atualizar-no-erp.test.ts) provam que a foto é tirada
 * certo. Estes provam que ela é tirada NA HORA CERTA e que a rota só deixa
 * quem deve: a revisão adversarial de 14/09/2026 achou os dois buracos —
 * nenhum teste conferia que o lançamento fotografa, e o portão da rota não
 * tinha teste nenhum.
 *
 * Arquivo à parte porque `vi.doMock` do módulo da foto vale para o arquivo
 * inteiro, e os testes do serviço precisam do módulo de verdade.
 */

const EMPRESA = 'empresa-1';
const REP = 'rep-1';

// Cada chamada da foto guarda quantas gravações o banco já tinha naquele
// instante: é assim que se prova que a foto veio ANTES da edição.
const chamadas: Array<{ fn: string; args: unknown[]; gravacoesAntes: number }> = [];
let gravacoesDoFake: () => number = () => 0;

// O que as funções simuladas devolvem — cada teste pode trocar.
const PEDIR_OK = { ok: true, sincronia: { order_id: 'o1', pedido_em: '2026-09-15T10:00:00Z' } };
let respostaDoPedir: unknown = PEDIR_OK;
let respostaDaFoto: string = 'guardada';

function simularFoto() {
  const registrar = (fn: string, retorno: unknown) =>
    vi.fn(async (...args: unknown[]) => {
      chamadas.push({ fn, args, gravacoesAntes: gravacoesDoFake() });
      return retorno;
    });
  vi.doMock('../apps/api/src/modules/orders/erpSync.service.js', () => ({
    registrarNoErp: registrar('registrarNoErp', 'guardada'),
    garantirFotoDoErp: vi.fn(async (...args: unknown[]) => {
      chamadas.push({ fn: 'garantirFotoDoErp', args, gravacoesAntes: gravacoesDoFake() });
      return respostaDaFoto;
    }),
    atualizarNumeroNaFoto: registrar('atualizarNumeroNaFoto', undefined),
    lerSincronia: vi.fn(async () => null),
    pedirAtualizacao: vi.fn(async (...args: unknown[]) => {
      chamadas.push({ fn: 'pedirAtualizacao', args, gravacoesAntes: gravacoesDoFake() });
      return respostaDoPedir;
    }),
    confirmarAtualizacao: registrar('confirmarAtualizacao', {
      ok: true,
      sincronia: { order_id: 'o1', pedido_em: null },
    }),
  }));
  // O original da 044 também é acessório da edição; aqui não interessa.
  vi.doMock('../apps/api/src/modules/orders/pedidoOriginal.service.js', () => ({
    guardarOriginal: vi.fn(async () => 'ja_tinha'),
    lerOriginal: vi.fn(async () => null),
  }));
}

async function carregarServico(respostas: Record<string, unknown>) {
  const fake = criarSupabaseFake(respostas as never);
  gravacoesDoFake = () => fake.gravacoes.length;
  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
  simularFoto();
  const mod = await import('../apps/api/src/modules/orders/orders.service.js');
  return { ...mod, fake };
}

beforeEach(() => {
  vi.resetModules();
  chamadas.length = 0;
  respostaDoPedir = PEDIR_OK;
  respostaDaFoto = 'guardada';
});

describe('o lançamento fotografa o que o Control passou a conhecer', () => {
  it('a Larissa lança com o número e a foto sai com quem lançou', async () => {
    const aprovado = { data: { status: 'approved', rep_id: REP }, error: null };
    const lancado = { data: { id: 'o1', status: 'sent_erp', rep_id: REP, erp_order_id: 'SX14627' }, error: null };
    const ninguem = { data: [], error: null };
    // Mesma fila do tests/pedidos.test.ts (o dublê adianta a resposta seguinte).
    const { updateOrderStatus } = await carregarServico({ orders: [aprovado, aprovado, ninguem, ninguem, lancado] });

    await updateOrderStatus('o1', EMPRESA, 'fin-1', { status: 'sent_erp', notes: '', erp_order_id: 'SX14627' }, 'financeiro');

    const foto = chamadas.find((c) => c.fn === 'registrarNoErp');
    expect(foto?.args).toEqual(['o1', EMPRESA, 'fin-1']);
  });

  it('aprovar (sem lançar) NÃO fotografa — o Control ainda não conhece o pedido', async () => {
    const naFila = { data: { status: 'pending_approval', rep_id: REP }, error: null };
    const decidido = { data: { id: 'o1', status: 'approved', rep_id: REP }, error: null };
    const { updateOrderStatus } = await carregarServico({ orders: [naFila, decidido] });

    await updateOrderStatus('o1', EMPRESA, 'fin-1', { status: 'approved', notes: '' }, 'financeiro');

    expect(chamadas.find((c) => c.fn === 'registrarNoErp')).toBeUndefined();
  });
});

describe('a edição de um pedido lançado fotografa ANTES de mexer', () => {
  it('a Simone troca a observação: a foto sai antes do update', async () => {
    const lancado = { id: 'o1', rep_id: REP, status: 'sent_erp', invoiced: false, notes: 'entregar sexta' };
    const { setOrderNotes, fake } = await carregarServico({
      orders: [
        { data: lancado, error: null },
        { data: { ...lancado, notes: 'entregar segunda' }, error: null },
      ],
    });

    const r = await setOrderNotes('o1', EMPRESA, REP, 'rep', 'entregar segunda', true);

    expect(r.ok).toBe(true);
    const foto = chamadas.find((c) => c.fn === 'garantirFotoDoErp');
    expect(foto).toBeDefined();
    expect((foto!.args[0] as { id: string; status: string }).status).toBe('sent_erp');
    // Nenhuma gravação tinha acontecido quando a foto foi pedida...
    expect(foto!.gravacoesAntes).toBe(0);
    // ...e a edição gravou depois dela.
    expect(fake.ultimaGravacao('orders', 'update')).toBeDefined();
  });

  it('a Simone troca o desconto: a foto sai antes de gravar', async () => {
    const lancado = { id: 'o1', rep_id: REP, status: 'sent_erp', invoiced: false };
    const { setOrderDiscount, fake } = await carregarServico({
      orders: { data: lancado, error: null },
      order_items: { data: [{ total: 100 }], error: null },
    });

    const r = await setOrderDiscount('o1', EMPRESA, REP, 'rep', { percent: 8 }, true);

    expect(r.ok).toBe(true);
    const foto = chamadas.find((c) => c.fn === 'garantirFotoDoErp');
    expect(foto?.gravacoesAntes).toBe(0);
    expect(fake.ultimaGravacao('orders', 'update')).toBeDefined();
  });

  it('a Simone tira a condição de pagamento: a foto sai antes de gravar', async () => {
    const lancado = { id: 'o1', rep_id: REP, status: 'sent_erp', invoiced: false };
    const { setOrderPayment, fake } = await carregarServico({ orders: { data: lancado, error: null } });

    const r = await setOrderPayment('o1', EMPRESA, REP, 'rep', null, true);

    expect(r.ok).toBe(true);
    expect(chamadas.find((c) => c.fn === 'garantirFotoDoErp')?.gravacoesAntes).toBe(0);
    expect(fake.ultimaGravacao('orders', 'update')).toBeDefined();
  });

  it('se a foto FALHA, a edição não passa — senão essa mudança sumiria do aviso para sempre', async () => {
    respostaDaFoto = 'falhou';
    const lancado = { id: 'o1', rep_id: REP, status: 'sent_erp', invoiced: false, notes: 'entregar sexta' };
    const { setOrderNotes, fake } = await carregarServico({ orders: { data: lancado, error: null } });

    const r = await setOrderNotes('o1', EMPRESA, REP, 'rep', 'entregar segunda', true);

    expect(r).toEqual({ ok: false, reason: 'sem_foto_do_erp' });
    expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();
  });

  it('tabela ausente não trava a edição — o app segue como antes da 046', async () => {
    respostaDaFoto = 'sem_tabela';
    const lancado = { id: 'o1', rep_id: REP, status: 'sent_erp', invoiced: false, notes: null };
    const { setOrderNotes } = await carregarServico({
      orders: [{ data: lancado, error: null }, { data: { ...lancado, notes: 'x' }, error: null }],
    });

    expect((await setOrderNotes('o1', EMPRESA, REP, 'rep', 'x', true)).ok).toBe(true);
  });

  it('representante comum não passa do portão — e aí nem foto nem edição', async () => {
    const lancado = { id: 'o1', rep_id: REP, status: 'sent_erp', invoiced: false, notes: null };
    const { setOrderNotes, fake } = await carregarServico({ orders: { data: lancado, error: null } });

    const r = await setOrderNotes('o1', EMPRESA, REP, 'rep', 'qualquer coisa', false);

    expect(r).toEqual({ ok: false, reason: 'tarde_demais' });
    expect(chamadas.find((c) => c.fn === 'garantirFotoDoErp')).toBeUndefined();
    expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();
  });
});

describe('corrigir o número do Control leva o número novo para a foto', () => {
  it('a foto passa a apontar o número certo', async () => {
    const lancado = { data: { id: 'o1', status: 'sent_erp', invoiced: false, erp_order_id: 'CS17370' }, error: null };
    const { corrigirNumeroErp } = await carregarServico({
      orders: [lancado, { data: [], error: null }, { data: [], error: null }, { data: null, error: null }],
    });

    const r = await corrigirNumeroErp('o1', EMPRESA, 'cs 17379');

    expect(r).toEqual({ ok: true, erp_order_id: 'CS17379' });
    expect(chamadas.find((c) => c.fn === 'atualizarNumeroNaFoto')?.args).toEqual(['o1', EMPRESA, 'CS17379']);
  });
});

// ─── O portão da rota PATCH /orders/:id/erp-sync ─────────────────────────────

const SEGREDO = 'segredo-de-teste-nao-usar-em-producao'; // igual ao tests/setup.ts
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

function assinar(payload: Record<string, unknown>): string {
  const cabecalho = b64({ alg: 'HS256', typ: 'JWT' });
  const agora = Math.floor(Date.now() / 1000);
  const corpo = b64({ ...payload, iat: agora, exp: agora + 3600 });
  const assinatura = crypto.createHmac('sha256', SEGREDO).update(`${cabecalho}.${corpo}`).digest('base64url');
  return `${cabecalho}.${corpo}.${assinatura}`;
}

const token = (extra: Record<string, unknown>) =>
  assinar({ sub: REP, email: 'x@csb.com', company_id: EMPRESA, name: 'X', price_table_id: 't1', ...extra });

const aparelhosAvisados = vi.fn(async () => ({ financeiro: 2, admin: 1 }));

async function subirApp(respostas: Record<string, unknown>) {
  const fake = criarSupabaseFake(respostas as never);
  gravacoesDoFake = () => fake.gravacoes.length;
  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
  simularFoto();
  vi.doMock('../apps/api/src/modules/push/push.avisos.js', async (importar) => ({
    ...(await importar<Record<string, unknown>>()),
    avisarPedidoMudouNoErp: aparelhosAvisados,
  }));
  const { buildApp } = await import('../apps/api/src/app.js');
  const app = await buildApp();
  await app.ready();
  return app;
}

async function patch(app: Awaited<ReturnType<typeof subirApp>>, tk: string, payload: unknown) {
  const res = await app.inject({
    method: 'PATCH',
    url: '/orders/o1/erp-sync',
    headers: { authorization: `Bearer ${tk}` },
    payload: payload as Record<string, unknown>,
  });
  await app.close();
  return res;
}

// Sobe o app inteiro por teste: a primeira requisição é lenta sob carga.
describe('PATCH /orders/:id/erp-sync — quem pode', { timeout: 20_000 }, () => {
  it('representante comum não pede: pedido lançado não muda pela mão dele', async () => {
    const app = await subirApp({ orders: { data: { rep_id: REP, invoiced: false }, error: null } });
    const res = await patch(app, token({ role: 'rep' }), { acao: 'pedir' });
    expect(res.statusCode).toBe(403);
    expect(chamadas.find((c) => c.fn === 'pedirAtualizacao')).toBeUndefined();
  });

  it('venda interna não pede no pedido de OUTRA pessoa', async () => {
    const app = await subirApp({ orders: { data: { rep_id: 'rep-2', invoiced: false }, error: null } });
    const res = await patch(app, token({ role: 'rep', venda_interna: true }), { acao: 'pedir' });
    expect(res.statusCode).toBe(403);
  });

  it('pedido já faturado: o pedido de atualização é recusado, inclusive para o escritório', async () => {
    respostaDoPedir = { ok: false, motivo: 'ja_faturado' };
    const app = await subirApp({});
    const res = await patch(app, token({ role: 'financeiro' }), { acao: 'pedir' });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { code: string }).code).toBe('JA_FATURADO');
  });

  it('a venda interna dona pede, e a resposta diz em quantos aparelhos o aviso chegou', async () => {
    const app = await subirApp({
      orders: [
        { data: { rep_id: REP, invoiced: false }, error: null },
        { data: { id: 'o1', order_number: 14627, erp_order_id: 'CS17379' }, error: null },
      ],
    });
    const res = await patch(app, token({ role: 'rep', venda_interna: true }), {
      acao: 'pedir',
      observacao: 'tirei 6 da 0124',
    });
    expect(res.statusCode).toBe(200);
    const corpo = res.json() as { data: { order_id: string }; avisados: unknown; aparelhos: number };
    // `data` continua sendo a sincronia: o app antigo aberto no celular lê direto.
    expect(corpo.data.order_id).toBe('o1');
    expect(corpo.avisados).toEqual({ financeiro: 2, admin: 1 });
    expect(corpo.aparelhos).toBe(3);
    expect(chamadas.find((c) => c.fn === 'pedirAtualizacao')?.args).toEqual(['o1', EMPRESA, REP, 'tirei 6 da 0124']);
  });

  it('só financeiro e admin confirmam — a venda interna não', async () => {
    const app = await subirApp({});
    // Com a assinatura, para o teste bater no portão de papel e não na validação do corpo.
    const res = await patch(app, token({ role: 'rep', venda_interna: true }), { acao: 'confirmar', assinatura: '1-abcdef01' });
    expect(res.statusCode).toBe(403);
    expect(chamadas.find((c) => c.fn === 'confirmarAtualizacao')).toBeUndefined();
  });

  it('confirmar SEM a assinatura é recusado — o app antigo engoliria a segunda edição', async () => {
    const app = await subirApp({});
    const res = await patch(app, token({ role: 'financeiro' }), { acao: 'confirmar' });
    expect(res.statusCode).toBe(400);
    expect(chamadas.find((c) => c.fn === 'confirmarAtualizacao')).toBeUndefined();
  });

  it('o financeiro confirma levando a assinatura do que viu', async () => {
    const app = await subirApp({});
    const res = await patch(app, token({ role: 'financeiro' }), { acao: 'confirmar', assinatura: '1-abcdef01' });
    expect(res.statusCode).toBe(200);
    expect(chamadas.find((c) => c.fn === 'confirmarAtualizacao')?.args).toEqual(['o1', EMPRESA, REP, '1-abcdef01']);
  });
});
