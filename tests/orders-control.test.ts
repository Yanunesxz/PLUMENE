import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import { criarSupabaseFake, type RespostaTabela } from './supabaseFake.js';

/**
 * A integração com o Control, fase 0, do lado das TELAS (frente [O]).
 *
 * Um fluxo tem um escritor só. Quando a empresa liga o canal na API (048), a
 * tela deixa de lançar o número e de carimbar o faturado de pedido que já está
 * no Control; o que continua pela tela passa a deixar rastro (origem do número
 * e evento). E o que já está no Control não some do app por um "excluir".
 *
 * As sondas de coluna vão por `vi.doMock` do detectarColuna: assim a fila do
 * dublê só tem as consultas de verdade, e cada teste diz o que "não existe".
 */

const EMPRESA = 'empresa-1';
const REP = 'rep-1';
const NUMERO = 'ZZ0000001';
const SEGREDO = 'segredo-de-teste-nao-usar-em-producao'; // igual ao tests/setup.ts
const VAZIO: RespostaTabela = { data: null, error: null };

type Fake = ReturnType<typeof criarSupabaseFake>;

function mockDeteccao(ausentes: string[]) {
  const ausente = (tabela: string, coluna?: string) =>
    ausentes.includes(tabela) || (coluna != null && ausentes.includes(`${tabela}.${coluna}`));
  vi.doMock('../apps/api/src/lib/detectarColuna.js', () => ({
    detectar: async (t: string, c?: string) => !ausente(t, c),
    detectarComCerteza: async (t: string, c?: string) => (ausente(t, c) ? 'nao_existe' : 'existe'),
    detectarOuFalhar: async (t: string, c?: string) => !ausente(t, c),
    esquecerDeteccoes: () => {},
  }));
}

/** O que costuma atrapalhar a fila de `orders` e não é assunto destes testes. */
const FORA_DO_ASSUNTO = ['order_erp_sync', 'order_originals'];

function prepararFake(respostas: Record<string, unknown>, ausentes: string[] = FORA_DO_ASSUNTO): Fake {
  const fake = criarSupabaseFake(respostas as never);
  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
  mockDeteccao(ausentes);
  return fake;
}

async function servicoDePedidos(respostas: Record<string, unknown>, ausentes?: string[]) {
  const fake = prepararFake(respostas, ausentes);
  const mod = await import('../apps/api/src/modules/orders/orders.service.js');
  return { ...mod, fake };
}

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
function assinar(payload: Record<string, unknown>): string {
  const cabecalho = b64({ alg: 'HS256', typ: 'JWT' });
  const agora = Math.floor(Date.now() / 1000);
  const corpo = b64({ ...payload, iat: agora, exp: agora + 3600 });
  const assinatura = crypto.createHmac('sha256', SEGREDO).update(`${cabecalho}.${corpo}`).digest('base64url');
  return `${cabecalho}.${corpo}.${assinatura}`;
}
const base = { email: 'teste@teste.invalid', company_id: EMPRESA, price_table_id: null };
const TOKEN_ADMIN = assinar({ ...base, sub: 'adm-1', name: 'Admin Teste', role: 'admin' });
const TOKEN_FINANCEIRO = assinar({ ...base, sub: 'fin-1', name: 'Financeiro Teste', role: 'financeiro' });
const TOKEN_GERENTE = assinar({ ...base, sub: 'ger-1', name: 'Gerente Teste', role: 'manager', permissions: null });

async function subirApp(respostas: Record<string, unknown>, ausentes?: string[]) {
  const fake = prepararFake(respostas, ausentes);
  const avisarFaturadoAoRep = vi.fn();
  vi.doMock('../apps/api/src/modules/push/push.avisos.js', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    avisarFaturadoAoRep,
  }));
  const { buildApp } = await import('../apps/api/src/app.js');
  const app = await buildApp();
  await app.ready();
  return { app, fake, avisarFaturadoAoRep };
}

const CANAIS_API = {
  data: {
    canal_pedido_erp: 'api',
    canal_faturamento: 'api',
    canal_cadastro: 'carga',
    canal_retrato: 'carga',
    canal_catalogo: 'carga',
  },
  error: null,
};

function valores(fake: Fake, tabela: string, operacao: 'insert' | 'update') {
  return fake.ultimaGravacao(tabela, operacao)?.valores as Record<string, unknown> | undefined;
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock('../apps/api/src/config/supabase.js');
  vi.doUnmock('../apps/api/src/lib/detectarColuna.js');
  vi.doUnmock('../apps/api/src/modules/push/push.avisos.js');
  vi.restoreAllMocks();
});

// ─── Excluir ─────────────────────────────────────────────────────────────────

describe('excluir pedido que já está no Control', () => {
  const COM_NUMERO = { data: { id: 'o1', rep_id: REP, invoiced: false, erp_order_id: NUMERO }, error: null };

  it('é recusado para todos, sem cópia e sem DELETE', async () => {
    const { deleteOrder, fake } = await servicoDePedidos({ orders: COM_NUMERO });

    const r = await deleteOrder('o1', EMPRESA, 'adm-1', 'admin', 'Admin Teste');

    expect(r).toEqual({ ok: false, reason: 'tem_numero_erp' });
    expect(fake.ultimaGravacao('orders', 'delete')).toBeUndefined();
    expect(fake.ultimaGravacao('deleted_orders', 'insert')).toBeUndefined();
    expect(fake.filtrosDe('orders', 'select')[0]?.args[0]).toContain('erp_order_id');
  });

  it('pedido sem número continua sendo excluído como antes', async () => {
    const { deleteOrder, fake } = await servicoDePedidos(
      { orders: { data: { id: 'o1', rep_id: REP, invoiced: false, erp_order_id: null }, error: null } },
      [...FORA_DO_ASSUNTO, 'deleted_orders'],
    );

    expect(await deleteOrder('o1', EMPRESA, 'adm-1', 'admin')).toEqual({ ok: true });
    expect(fake.ultimaGravacao('orders', 'delete')).toBeDefined();
  });

  it('a rota responde 409 ORDER_HAS_ERP_NUMBER com a mensagem para a tela', async () => {
    const { app } = await subirApp({ orders: COM_NUMERO });
    try {
      const res = await app.inject({
        method: 'DELETE',
        url: '/orders/o1',
        headers: { authorization: `Bearer ${TOKEN_ADMIN}` },
      });
      expect(res.statusCode).toBe(409);
      const corpo = res.json() as { code: string; error: string };
      expect(corpo.code).toBe('ORDER_HAS_ERP_NUMBER');
      expect(corpo.error).toMatch(/Control/);
    } finally {
      await app.close();
    }
  }, 60_000);
});

// ─── Lançar no ERP pela tela ─────────────────────────────────────────────────

describe('lançar no ERP pela tela', () => {
  const aprovado = { data: { status: 'approved', rep_id: REP, erp_order_id: null }, error: null };
  const lancado = {
    data: { id: 'o1', order_number: 1, status: 'sent_erp', rep_id: REP, erp_order_id: NUMERO },
    error: null,
  };
  const ninguem = { data: [], error: null };

  it('com o canal de pedidos na API é recusado (CANAL_API) e nada é gravado', async () => {
    const { updateOrderStatus, fake } = await servicoDePedidos({ orders: aprovado, companies: CANAIS_API });

    await expect(
      updateOrderStatus('o1', EMPRESA, 'fin-1', { status: 'sent_erp', notes: '', erp_order_id: NUMERO }, 'financeiro'),
    ).rejects.toThrow('CANAL_API');
    expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();
    expect(fake.ultimaGravacao('order_erp_events', 'insert')).toBeUndefined();
  });

  it('banco sem resposta sobre o canal recusa com CANAL_INDISPONIVEL — nada é gravado', async () => {
    // `fetch failed` chega com code vazio: não é "coluna não existe", é "não
    // sei". O canal fecha, mas com desfecho próprio (503 na rota), nunca 500 mudo.
    const { updateOrderStatus, fake } = await servicoDePedidos({
      orders: aprovado,
      companies: { data: null, error: { message: 'fetch failed', code: '' } },
    });

    await expect(
      updateOrderStatus('o1', EMPRESA, 'fin-1', { status: 'sent_erp', notes: '', erp_order_id: NUMERO }, 'financeiro'),
    ).rejects.toThrow('CANAL_INDISPONIVEL');
    expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();
  });

  it('a rota traduz o CANAL_INDISPONIVEL em 503 com a mensagem para a tela', async () => {
    const { app, fake } = await subirApp({
      orders: aprovado,
      companies: { data: null, error: { message: 'fetch failed', code: '' } },
    });
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: '/orders/o1/status',
        headers: { authorization: `Bearer ${TOKEN_FINANCEIRO}` },
        payload: { status: 'sent_erp', erp_order_id: NUMERO },
      });
      expect(res.statusCode).toBe(503);
      const corpo = res.json() as { code: string; error: string };
      expect(corpo.code).toBe('CANAL_INDISPONIVEL');
      expect(corpo.error).toMatch(/Nada foi alterado/);
      expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();
    } finally {
      await app.close();
    }
  }, 60_000);

  it('com o canal manual grava a origem "lancamento", quem lançou, e o evento numero_gravado', async () => {
    const { updateOrderStatus, fake } = await servicoDePedidos({
      orders: [aprovado, VAZIO, ninguem, VAZIO, lancado],
    });

    await updateOrderStatus(
      'o1',
      EMPRESA,
      'fin-1',
      { status: 'sent_erp', notes: '', erp_order_id: NUMERO },
      'financeiro',
      false,
      'Financeiro Teste',
    );

    const gravado = valores(fake, 'orders', 'update')!;
    expect(gravado['erp_order_id']).toBe(NUMERO);
    expect(gravado['erp_order_source']).toBe('lancamento');
    expect(gravado['erp_order_set_by']).toBe('fin-1');
    expect(gravado['erp_order_set_at']).toBe(gravado['updated_at']);

    const evento = valores(fake, 'order_erp_events', 'insert')!;
    expect(evento).toMatchObject({
      company_id: EMPRESA,
      order_id: 'o1',
      order_number: 1,
      tipo: 'numero_gravado',
      origem: 'tela',
      por: 'fin-1',
      por_nome: 'Financeiro Teste',
      antes: { erp_order_id: null, status: 'approved' },
      depois: { erp_order_id: NUMERO, status: 'sent_erp' },
    });
  });

  it('sem a 048 o update fica igual ao de hoje e não há evento', async () => {
    const { updateOrderStatus, fake } = await servicoDePedidos(
      { orders: [aprovado, VAZIO, ninguem, VAZIO, lancado] },
      [...FORA_DO_ASSUNTO, 'orders.erp_order_source', 'order_erp_events', 'companies.canal_pedido_erp'],
    );

    await updateOrderStatus('o1', EMPRESA, 'fin-1', { status: 'sent_erp', notes: '', erp_order_id: NUMERO }, 'financeiro');

    const gravado = valores(fake, 'orders', 'update')!;
    expect(gravado['erp_order_id']).toBe(NUMERO);
    expect(Object.keys(gravado)).not.toContain('erp_order_source');
    expect(Object.keys(gravado)).not.toContain('erp_order_set_by');
    expect(fake.ultimaGravacao('order_erp_events', 'insert')).toBeUndefined();
  });

  it('a rota responde 409 CANAL_API com a mensagem para a tela', async () => {
    const { app, fake } = await subirApp({ orders: aprovado, companies: CANAIS_API });
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: '/orders/o1/status',
        headers: { authorization: `Bearer ${TOKEN_FINANCEIRO}` },
        payload: { status: 'sent_erp', erp_order_id: NUMERO },
      });
      expect(res.statusCode).toBe(409);
      const corpo = res.json() as { code: string; error: string };
      expect(corpo.code).toBe('CANAL_API');
      expect(corpo.error).toMatch(/API/);
      expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();
    } finally {
      await app.close();
    }
  }, 60_000);
});

// ─── Solicitar ao Control (049) ──────────────────────────────────────────────

describe('solicitar o lançamento ao Control (canal na API, 049)', () => {
  const SOLICITADO_EM = '2026-09-16T13:00:00.000Z';
  const aprovado = (extra: Record<string, unknown> = {}) => ({
    data: {
      id: 'o1',
      order_number: 5,
      status: 'approved',
      rep_id: REP,
      invoiced: false,
      erp_order_id: null,
      erp_requested_at: null,
      ...extra,
    },
    error: null,
  });
  const GRAVOU = { data: [{ id: 'o1' }], error: null };
  const NINGUEM = { data: [], error: null };
  const QUEM = { id: 'fin-1', nome: 'Financeiro Teste' };

  it('grava erp_requested_at/by com o mesmo updated_at, só se o pedido continua aprovado, sem número e não solicitado — e deixa o evento', async () => {
    const { solicitarLancamentoNoErp, fake } = await servicoDePedidos({
      orders: [aprovado(), VAZIO, GRAVOU],
      companies: CANAIS_API,
    });

    const r = await solicitarLancamentoNoErp('o1', EMPRESA, QUEM);

    expect(r.ok).toBe(true);
    expect(r.ok && r.ja_solicitado).toBe(false);
    const gravado = valores(fake, 'orders', 'update')!;
    expect(typeof gravado['erp_requested_at']).toBe('string');
    expect(gravado['erp_requested_by']).toBe('fin-1');
    expect(gravado['updated_at']).toBe(gravado['erp_requested_at']);
    expect(r.ok && r.solicitado_em).toBe(gravado['erp_requested_at']);
    // Status NUNCA muda aqui: o pedido vira sent_erp quando o Control confirmar.
    expect(Object.keys(gravado)).not.toContain('status');
    expect(Object.keys(gravado)).not.toContain('erp_order_id');

    const eqs = fake.filtrosDe('orders', 'eq').map((f) => f.args);
    expect(eqs).toContainEqual(['company_id', EMPRESA]);
    expect(eqs).toContainEqual(['status', 'approved']);
    const iss = fake.filtrosDe('orders', 'is').map((f) => f.args);
    expect(iss).toContainEqual(['erp_order_id', null]);
    expect(iss).toContainEqual(['erp_requested_at', null]);
    expect(fake.filtrosDe('orders', 'or').map((f) => f.args)).toEqual([['invoiced.is.null,invoiced.eq.false']]);

    expect(valores(fake, 'order_erp_events', 'insert')).toMatchObject({
      company_id: EMPRESA,
      order_id: 'o1',
      order_number: 5,
      tipo: 'solicitado_ao_erp',
      origem: 'tela',
      por: 'fin-1',
      por_nome: 'Financeiro Teste',
      depois: { erp_order_id: null, status: 'approved' },
    });
  });

  it('já solicitado: responde ok com o momento de antes, sem gravar e sem evento (idempotente)', async () => {
    const { solicitarLancamentoNoErp, fake } = await servicoDePedidos({
      orders: aprovado({ erp_requested_at: SOLICITADO_EM }),
      companies: CANAIS_API,
    });

    expect(await solicitarLancamentoNoErp('o1', EMPRESA, QUEM)).toEqual({
      ok: true,
      solicitado_em: SOLICITADO_EM,
      ja_solicitado: true,
    });
    expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();
    expect(fake.ultimaGravacao('order_erp_events', 'insert')).toBeUndefined();
  });

  it.each([
    ['já tem número', { erp_order_id: NUMERO, status: 'sent_erp' }, { reason: 'ja_lancado', erp_order_id: NUMERO }],
    ['já faturado', { invoiced: true }, { reason: 'ja_faturado' }],
    ['ainda na fila', { status: 'pending_approval' }, { reason: 'nao_aprovado' }],
    ['recusado', { status: 'rejected' }, { reason: 'nao_aprovado' }],
  ])('pedido %s é recusado antes do canal e nada é gravado', async (_nome, extra, esperado) => {
    const { solicitarLancamentoNoErp, fake } = await servicoDePedidos({
      orders: aprovado(extra),
      companies: CANAIS_API,
    });

    expect(await solicitarLancamentoNoErp('o1', EMPRESA, QUEM)).toEqual({ ok: false, ...esperado });
    expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();
    expect(fake.filtrosDe('companies')).toHaveLength(0);
  });

  it('pedido que não existe (ou de outra empresa) é not_found; falha de banco na leitura é erro, não 404', async () => {
    const semPedido = await servicoDePedidos({ orders: VAZIO, companies: CANAIS_API });
    expect(await semPedido.solicitarLancamentoNoErp('o1', EMPRESA, QUEM)).toEqual({ ok: false, reason: 'not_found' });

    vi.resetModules();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const caiu = await servicoDePedidos({
      orders: { data: null, error: { message: 'fetch failed', code: '' } },
      companies: CANAIS_API,
    });
    expect(await caiu.solicitarLancamentoNoErp('o1', EMPRESA, QUEM)).toEqual({ ok: false, reason: 'erro' });
    expect(caiu.fake.ultimaGravacao('orders', 'update')).toBeUndefined();
  });

  it('com o canal manual é canal_manual: aí o caminho é digitar o número, como hoje', async () => {
    // Sem linha em `companies`: valem os padrões (manual).
    const { solicitarLancamentoNoErp, fake } = await servicoDePedidos({ orders: aprovado() });

    expect(await solicitarLancamentoNoErp('o1', EMPRESA, QUEM)).toEqual({ ok: false, reason: 'canal_manual' });
    expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();
  });

  it('banco sem resposta sobre o canal é canal_indisponivel — nada gravado', async () => {
    const { solicitarLancamentoNoErp, fake } = await servicoDePedidos({
      orders: aprovado(),
      companies: { data: null, error: { message: 'fetch failed', code: '' } },
    });

    expect(await solicitarLancamentoNoErp('o1', EMPRESA, QUEM)).toEqual({ ok: false, reason: 'canal_indisponivel' });
    expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();
  });

  it('sem a 049 (coluna ausente) é sem_migracao; sonda sem resposta é "tente de novo", nunca "migração pendente"', async () => {
    const semColuna = await servicoDePedidos(
      { orders: aprovado(), companies: CANAIS_API },
      [...FORA_DO_ASSUNTO, 'orders.erp_requested_at'],
    );
    expect(await semColuna.solicitarLancamentoNoErp('o1', EMPRESA, QUEM)).toEqual({ ok: false, reason: 'sem_migracao' });
    expect(semColuna.fake.ultimaGravacao('orders', 'update')).toBeUndefined();

    vi.resetModules();
    const fake = criarSupabaseFake({ orders: aprovado(), companies: CANAIS_API } as never);
    vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
    vi.doMock('../apps/api/src/lib/detectarColuna.js', () => ({
      detectar: async () => true,
      detectarOuFalhar: async () => true,
      detectarComCerteza: async (t: string, c?: string) =>
        t === 'orders' && c === 'erp_requested_at' ? 'nao_sei' : 'existe',
      esquecerDeteccoes: () => {},
    }));
    const { solicitarLancamentoNoErp } = await import('../apps/api/src/modules/orders/orders.service.js');
    expect(await solicitarLancamentoNoErp('o1', EMPRESA, QUEM)).toEqual({ ok: false, reason: 'canal_indisponivel' });
    expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();
  });

  it('corrida: ninguém afetado porque outro clique solicitou no meio → ok já solicitado; porque o Control confirmou → já lançado', async () => {
    const outroClique = await servicoDePedidos({
      orders: [aprovado(), VAZIO, NINGUEM, VAZIO, aprovado({ erp_requested_at: SOLICITADO_EM })],
      companies: CANAIS_API,
    });
    expect(await outroClique.solicitarLancamentoNoErp('o1', EMPRESA, QUEM)).toEqual({
      ok: true,
      solicitado_em: SOLICITADO_EM,
      ja_solicitado: true,
    });
    // Este clique não gravou: não deixa evento.
    expect(outroClique.fake.ultimaGravacao('order_erp_events', 'insert')).toBeUndefined();

    vi.resetModules();
    const faturouNoMeio = await servicoDePedidos({
      orders: [aprovado(), VAZIO, NINGUEM, VAZIO, aprovado({ invoiced: true })],
      companies: CANAIS_API,
    });
    expect(await faturouNoMeio.solicitarLancamentoNoErp('o1', EMPRESA, QUEM)).toEqual({ ok: false, reason: 'ja_faturado' });
    expect(faturouNoMeio.fake.ultimaGravacao('order_erp_events', 'insert')).toBeUndefined();

    vi.resetModules();
    const confirmou = await servicoDePedidos({
      orders: [aprovado(), VAZIO, NINGUEM, VAZIO, aprovado({ erp_order_id: NUMERO, status: 'sent_erp' })],
      companies: CANAIS_API,
    });
    expect(await confirmou.solicitarLancamentoNoErp('o1', EMPRESA, QUEM)).toEqual({
      ok: false,
      reason: 'ja_lancado',
      erp_order_id: NUMERO,
    });
  });

  it('o rastro que falha não muda a resposta: a solicitação já está gravada', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { solicitarLancamentoNoErp } = await servicoDePedidos({
      orders: [aprovado(), VAZIO, GRAVOU],
      companies: CANAIS_API,
      order_erp_events: { data: null, error: { message: 'insert recusado' } },
    });

    const r = await solicitarLancamentoNoErp('o1', EMPRESA, QUEM);

    expect(r.ok).toBe(true);
    expect(erro).toHaveBeenCalled();
  });

  it('a rota PATCH /orders/:id/solicitar-erp: financeiro solicita (200), gerente não (403)', async () => {
    const { app, fake } = await subirApp({ orders: [aprovado(), VAZIO, GRAVOU], companies: CANAIS_API });
    try {
      const negado = await app.inject({
        method: 'PATCH',
        url: '/orders/o1/solicitar-erp',
        headers: { authorization: `Bearer ${TOKEN_GERENTE}` },
      });
      expect(negado.statusCode).toBe(403);
      expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();

      const res = await app.inject({
        method: 'PATCH',
        url: '/orders/o1/solicitar-erp',
        headers: { authorization: `Bearer ${TOKEN_FINANCEIRO}` },
      });
      expect(res.statusCode).toBe(200);
      const corpo = res.json() as { data: { solicitado_em: string; ja_solicitado: boolean } };
      expect(typeof corpo.data.solicitado_em).toBe('string');
      expect(corpo.data.ja_solicitado).toBe(false);
      expect(valores(fake, 'orders', 'update')).toMatchObject({ erp_requested_by: 'fin-1' });
      expect(valores(fake, 'order_erp_events', 'insert')).toMatchObject({ por_nome: 'Financeiro Teste' });
    } finally {
      await app.close();
    }
  }, 60_000);

  it.each([
    ['canal manual', {}, 409, 'CANAL_MANUAL'],
    ['sem a 049', { ausentes: [...FORA_DO_ASSUNTO, 'orders.erp_requested_at'] }, 503, 'MIGRACAO_PENDENTE'],
    ['já com número', { pedido: { erp_order_id: NUMERO, status: 'sent_erp' } }, 409, 'ORDER_HAS_ERP_NUMBER'],
  ])('a rota traduz "%s" em %i %s', async (_nome, caso, status, code) => {
    const c = caso as { ausentes?: string[]; pedido?: Record<string, unknown> };
    const { app } = await subirApp(
      { orders: aprovado(c.pedido ?? {}), ...(c.pedido || c.ausentes ? { companies: CANAIS_API } : {}) },
      c.ausentes,
    );
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: '/orders/o1/solicitar-erp',
        headers: { authorization: `Bearer ${TOKEN_FINANCEIRO}` },
      });
      expect(res.statusCode).toBe(status);
      expect((res.json() as { code: string }).code).toBe(code);
    } finally {
      await app.close();
    }
  }, 60_000);

  it('GET /orders/canais devolve só os dois canais — a lista esconde o "Marcar faturado" do cartão; sem resposta do banco, null', async () => {
    const TOKEN_VENDA_INTERNA = assinar({ ...base, sub: REP, name: 'Venda Interna Teste', role: 'rep', venda_interna: true });
    const { app } = await subirApp({ companies: CANAIS_API });
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/orders/canais',
        headers: { authorization: `Bearer ${TOKEN_VENDA_INTERNA}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ data: { pedido_erp: 'api', faturamento: 'api' } });
    } finally {
      await app.close();
    }

    vi.resetModules();
    const semResposta = await subirApp({ companies: { data: null, error: { message: 'timeout' } } });
    try {
      const res = await semResposta.app.inject({
        method: 'GET',
        url: '/orders/canais',
        headers: { authorization: `Bearer ${TOKEN_FINANCEIRO}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ data: null });
    } finally {
      await semResposta.app.close();
    }
  }, 60_000);

  it('GET /orders/:id devolve os canais da empresa e o bloco solicitacao_erp — é o que a tela consulta a cada 3 s', async () => {
    const { app } = await subirApp({
      orders: aprovado({ company_id: EMPRESA, erp_requested_at: SOLICITADO_EM, erp_requested_by: 'fin-1' }),
      companies: CANAIS_API,
    });
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/orders/o1',
        headers: { authorization: `Bearer ${TOKEN_FINANCEIRO}` },
      });
      expect(res.statusCode).toBe(200);
      const corpo = res.json() as { data: Record<string, unknown> };
      expect(corpo.data).toMatchObject({
        erp_order_id: null,
        erp_requested_at: SOLICITADO_EM,
        solicitacao_erp: { solicitado_em: SOLICITADO_EM, solicitado_por: 'fin-1' },
        canais: { pedido_erp: 'api', faturamento: 'api' },
      });
    } finally {
      await app.close();
    }
  }, 60_000);

  it('lançar pela tela SEM número com o canal na API aponta para o solicitar (409 LANCAMENTO_PELO_CONTROL), sem gravar', async () => {
    const { updateOrderStatus, fake } = await servicoDePedidos({ orders: aprovado(), companies: CANAIS_API });
    await expect(
      updateOrderStatus('o1', EMPRESA, 'fin-1', { status: 'sent_erp', notes: '' }, 'financeiro'),
    ).rejects.toThrow('LANCAMENTO_PELO_CONTROL');
    expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();

    vi.resetModules();
    const { app } = await subirApp({ orders: aprovado(), companies: CANAIS_API });
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: '/orders/o1/status',
        headers: { authorization: `Bearer ${TOKEN_FINANCEIRO}` },
        payload: { status: 'sent_erp' },
      });
      expect(res.statusCode).toBe(409);
      const corpo = res.json() as { code: string; error: string };
      expect(corpo.code).toBe('LANCAMENTO_PELO_CONTROL');
      expect(corpo.error).toMatch(/Lançar no Control/);
    } finally {
      await app.close();
    }
  }, 60_000);
});

// ─── Corrigir o número ───────────────────────────────────────────────────────

describe('corrigir o número do Control', () => {
  const LANCADO = { data: { id: 'o1', order_number: 7, status: 'sent_erp', invoiced: false, erp_order_id: NUMERO }, error: null };

  it('grava a origem "correcao" e o evento com o antes e o depois do número', async () => {
    const { corrigirNumeroErp, fake } = await servicoDePedidos({
      orders: [LANCADO, VAZIO, { data: [], error: null }, VAZIO, VAZIO],
    });

    const r = await corrigirNumeroErp('o1', EMPRESA, 'zz 0000002', { id: 'fin-1', nome: 'Financeiro Teste' });

    expect(r).toEqual({ ok: true, erp_order_id: 'ZZ0000002' });
    const gravado = valores(fake, 'orders', 'update')!;
    expect(gravado).toMatchObject({
      erp_order_id: 'ZZ0000002',
      erp_order_source: 'correcao',
      erp_order_set_by: 'fin-1',
    });
    expect(valores(fake, 'order_erp_events', 'insert')).toMatchObject({
      tipo: 'numero_corrigido',
      origem: 'tela',
      order_number: 7,
      por: 'fin-1',
      antes: { erp_order_id: NUMERO },
      depois: { erp_order_id: 'ZZ0000002' },
    });
  });

  it('falha de banco na leitura vira "erro", não "pedido não encontrado"', async () => {
    const { corrigirNumeroErp, fake } = await servicoDePedidos({
      orders: { data: null, error: { message: 'fetch failed', code: '' } },
    });

    expect(await corrigirNumeroErp('o1', EMPRESA, 'ZZ0000002', { id: 'fin-1' })).toEqual({
      ok: false,
      motivo: 'erro',
    });
    expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();
  });

  it('o mesmo número de novo não grava nada', async () => {
    const { corrigirNumeroErp, fake } = await servicoDePedidos({ orders: LANCADO });

    expect(await corrigirNumeroErp('o1', EMPRESA, NUMERO, { id: 'fin-1' })).toEqual({ ok: true, erp_order_id: NUMERO });
    expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();
    expect(fake.ultimaGravacao('order_erp_events', 'insert')).toBeUndefined();
  });
});

// ─── O botão manual de faturado ──────────────────────────────────────────────

describe('botão manual de faturado', () => {
  const pedido = (extra: Record<string, unknown>) => ({
    data: {
      id: 'o1',
      company_id: EMPRESA,
      order_number: 3,
      rep_id: REP,
      customer_id: 'c1',
      status: 'sent_erp',
      invoiced: false,
      invoiced_at: null,
      invoiced_total: null,
      erp_order_id: NUMERO,
      ...extra,
    },
    error: null,
  });

  it('com o faturamento na API, pedido com número é recusado e nada é gravado', async () => {
    const { setOrderInvoiced, fake } = await servicoDePedidos({ orders: pedido({}), companies: CANAIS_API });

    const r = await setOrderInvoiced('o1', EMPRESA, true, { por: 'fin-1' });

    expect(r).toEqual({ ok: false, reason: 'faturamento_pelo_control' });
    expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();
    expect(fake.ultimaGravacao('customers', 'update')).toBeUndefined();
  });

  it('com o faturamento na API, pedido SEM número também é recusado — o botão some para todos (decisão 11)', async () => {
    const { setOrderInvoiced, fake } = await servicoDePedidos({
      orders: pedido({ erp_order_id: null }),
      companies: CANAIS_API,
    });

    const r = await setOrderInvoiced('o1', EMPRESA, true, { por: 'fin-1' });

    expect(r).toEqual({ ok: false, reason: 'faturamento_pelo_control' });
    expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();
    expect(fake.ultimaGravacao('order_erp_events', 'insert')).toBeUndefined();
  });

  it('com o faturamento na API, a venda interna não carimba o próprio pedido, e ninguém desmarca', async () => {
    const vendaInterna = await servicoDePedidos({ orders: pedido({ erp_order_id: null }), companies: CANAIS_API });
    expect(await vendaInterna.setOrderInvoiced('o1', EMPRESA, true, { somenteDoRep: REP, por: REP })).toEqual({
      ok: false,
      reason: 'faturamento_pelo_control',
    });
    expect(vendaInterna.fake.ultimaGravacao('orders', 'update')).toBeUndefined();

    vi.resetModules();
    const desmarcar = await servicoDePedidos({
      orders: pedido({ invoiced: true, invoiced_at: '2026-08-01T12:00:00.000Z' }),
      companies: CANAIS_API,
    });
    expect(await desmarcar.setOrderInvoiced('o1', EMPRESA, false, { por: 'fin-1' })).toEqual({
      ok: false,
      reason: 'faturamento_pelo_control',
    });
    expect(desmarcar.fake.ultimaGravacao('orders', 'update')).toBeUndefined();
  });

  it('sem a 048 o botão carimba pedido COM número e nem lê companies', async () => {
    // O ramo que a produção percorre no dia do deploy: a coluna não existe,
    // lerCanais devolve os padrões e `companies` nem é consultada.
    const { setOrderInvoiced, fake } = await servicoDePedidos(
      { orders: [pedido({}), VAZIO, pedido({ invoiced: true, invoiced_at: '2026-08-14T01:30:00.000Z' })] },
      [...FORA_DO_ASSUNTO, 'companies.canal_pedido_erp', 'order_erp_events'],
    );

    const r = await setOrderInvoiced('o1', EMPRESA, true, { por: 'fin-1' });

    expect(r.ok && r.mudou).toBe(true);
    expect(valores(fake, 'orders', 'update')).toMatchObject({ invoiced: true });
    expect(fake.filtrosDe('companies', 'eq')).toEqual([]);
  });

  it('banco sem resposta sobre o canal não carimba e devolve canal_indisponivel', async () => {
    const { setOrderInvoiced, fake } = await servicoDePedidos({
      orders: pedido({}),
      companies: { data: null, error: { message: 'fetch failed', code: '' } },
    });

    const r = await setOrderInvoiced('o1', EMPRESA, true, { por: 'fin-1' });

    expect(r).toEqual({ ok: false, reason: 'canal_indisponivel' });
    expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();
  });

  it('a rota traduz o canal indisponível em 503 e não avisa ninguém', async () => {
    const { app, avisarFaturadoAoRep } = await subirApp({
      orders: pedido({}),
      companies: { data: null, error: { message: 'fetch failed', code: '' } },
    });
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: '/orders/o1/invoice',
        headers: { authorization: `Bearer ${TOKEN_FINANCEIRO}` },
        payload: { invoiced: true },
      });
      expect(res.statusCode).toBe(503);
      expect((res.json() as { code: string }).code).toBe('CANAL_INDISPONIVEL');
      expect(avisarFaturadoAoRep).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  }, 60_000);

  it('o carimbo empurra a última compra com o DIA de São Paulo, filtrado pela empresa, e deixa o evento', async () => {
    const { setOrderInvoiced, fake } = await servicoDePedidos({
      orders: [pedido({}), VAZIO, pedido({ invoiced: true, invoiced_at: '2026-08-14T01:30:00.000Z' })],
    });

    const r = await setOrderInvoiced('o1', EMPRESA, true, { por: 'fin-1', por_nome: 'Financeiro Teste' });

    expect(r.ok && r.mudou).toBe(true);
    const gravado = valores(fake, 'orders', 'update')!;
    expect(gravado['invoiced']).toBe(true);
    expect(typeof gravado['invoiced_at']).toBe('string');
    // Dois toques ao mesmo tempo: o update só pega quem ainda não está faturado.
    expect(fake.filtrosDe('orders', 'or')[0]?.args[0]).toBe('invoiced.is.null,invoiced.eq.false');

    expect(valores(fake, 'customers', 'update')).toMatchObject({ last_purchase_at: '2026-08-13' });
    expect(fake.filtrosDe('customers', 'eq').map((f) => f.args)).toContainEqual(['company_id', EMPRESA]);

    expect(valores(fake, 'order_erp_events', 'insert')).toMatchObject({
      tipo: 'faturado',
      origem: 'tela',
      por: 'fin-1',
      antes: { invoiced: false },
      depois: { invoiced: true, invoiced_at: '2026-08-14T01:30:00.000Z' },
    });
  });

  it('recarimbo de pedido já faturado não grava, não move a última compra e não deixa evento', async () => {
    const { setOrderInvoiced, fake } = await servicoDePedidos({
      orders: pedido({ invoiced: true, invoiced_at: '2026-08-01T12:00:00.000Z', invoiced_total: 100 }),
    });

    const r = await setOrderInvoiced('o1', EMPRESA, true, { por: 'fin-1' });

    expect(r.ok).toBe(true);
    expect(r.ok && r.mudou).toBe(false);
    expect(r.ok && r.order.invoiced_at).toBe('2026-08-01T12:00:00.000Z');
    expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();
    expect(fake.ultimaGravacao('customers', 'update')).toBeUndefined();
    expect(fake.ultimaGravacao('order_erp_events', 'insert')).toBeUndefined();
  });

  it('desfazer limpa também o valor faturado e deixa o evento faturamento_desfeito', async () => {
    const { setOrderInvoiced, fake } = await servicoDePedidos({
      orders: [
        pedido({ invoiced: true, invoiced_at: '2026-08-01T12:00:00.000Z', invoiced_total: 100 }),
        VAZIO,
        pedido({ invoiced: false }),
      ],
    });

    const r = await setOrderInvoiced('o1', EMPRESA, false, { por: 'fin-1' });

    expect(r.ok && r.mudou).toBe(true);
    expect(valores(fake, 'orders', 'update')).toMatchObject({
      invoiced: false,
      invoiced_at: null,
      invoiced_total: null,
    });
    expect(fake.ultimaGravacao('customers', 'update')).toBeUndefined();
    expect(valores(fake, 'order_erp_events', 'insert')).toMatchObject({
      tipo: 'faturamento_desfeito',
      antes: { invoiced: true, invoiced_total: 100 },
      depois: { invoiced: false, invoiced_at: null, invoiced_total: null },
    });
  });

  it('desfazer num banco sem a 027 não manda invoiced_total', async () => {
    const semValor = (extra: Record<string, unknown>) => {
      const r = pedido(extra);
      delete (r.data as Record<string, unknown>)['invoiced_total'];
      return r;
    };
    const { setOrderInvoiced, fake } = await servicoDePedidos({
      orders: [semValor({ invoiced: true, invoiced_at: '2026-08-01T12:00:00.000Z' }), VAZIO, semValor({})],
    });

    await setOrderInvoiced('o1', EMPRESA, false);

    expect(Object.keys(valores(fake, 'orders', 'update')!)).not.toContain('invoiced_total');
  });

  it('desfazer o que não está faturado não grava nada', async () => {
    const { setOrderInvoiced, fake } = await servicoDePedidos({ orders: pedido({}) });

    const r = await setOrderInvoiced('o1', EMPRESA, false);

    expect(r.ok && r.mudou).toBe(false);
    expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();
  });

  it('a rota responde 409 FATURAMENTO_PELO_CONTROL e não avisa ninguém', async () => {
    const { app, avisarFaturadoAoRep } = await subirApp({ orders: pedido({}), companies: CANAIS_API });
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: '/orders/o1/invoice',
        headers: { authorization: `Bearer ${TOKEN_FINANCEIRO}` },
        payload: { invoiced: true },
      });
      expect(res.statusCode).toBe(409);
      expect((res.json() as { code: string }).code).toBe('FATURAMENTO_PELO_CONTROL');
      expect(avisarFaturadoAoRep).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  }, 60_000);

  it('na rota, o recarimbo não avisa o representante de novo', async () => {
    const { app, avisarFaturadoAoRep } = await subirApp({
      orders: pedido({ invoiced: true, invoiced_at: '2026-08-01T12:00:00.000Z' }),
    });
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: '/orders/o1/invoice',
        headers: { authorization: `Bearer ${TOKEN_FINANCEIRO}` },
        payload: { invoiced: true },
      });
      expect(res.statusCode).toBe(200);
      expect(avisarFaturadoAoRep).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  }, 60_000);

  it('na rota, o carimbo de verdade avisa o representante', async () => {
    const { app, avisarFaturadoAoRep } = await subirApp({
      orders: [pedido({ erp_order_id: null }), VAZIO, pedido({ erp_order_id: null, invoiced: true, invoiced_at: '2026-08-13T15:00:00.000Z' })],
    });
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: '/orders/o1/invoice',
        headers: { authorization: `Bearer ${TOKEN_FINANCEIRO}` },
        payload: { invoiced: true },
      });
      expect(res.statusCode).toBe(200);
      expect(avisarFaturadoAoRep).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  }, 60_000);
});

describe('o dia da compra', () => {
  it('é o dia em São Paulo, não o de UTC', async () => {
    const { diaDaCompra } = await servicoDePedidos({});
    expect(diaDaCompra('2026-08-13T23:30:00-03:00')).toBe('2026-08-13');
    expect(diaDaCompra('2026-08-14T01:30:00Z')).toBe('2026-08-13');
    expect(diaDaCompra('2026-08-14T12:00:00Z')).toBe('2026-08-14');
    expect(diaDaCompra('2026-08-13')).toBe('2026-08-13');
    expect(diaDaCompra('nao e data')).toBeNull();
    expect(diaDaCompra(null)).toBeNull();
  });
});

// ─── Editar peças sem a foto do original ────────────────────────────────────

describe('editar peças quando a foto do original falha', () => {
  const PEDIDO = {
    data: {
      id: 'o1',
      company_id: EMPRESA,
      rep_id: REP,
      customer_id: 'c1',
      status: 'pending_approval',
      invoiced: false,
      price_table_id: 't1',
      total: 100,
    },
    error: null,
  };
  const FOTO_RECUSADA = { data: null, error: { message: 'falha de teste', code: 'XX000' } };

  it('a edição é recusada e nenhuma peça é trocada', async () => {
    const { setOrderItems, fake } = await servicoDePedidos(
      { orders: PEDIDO, order_originals: FOTO_RECUSADA },
      ['order_erp_sync'],
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const r = await setOrderItems('o1', EMPRESA, 'ger-1', 'manager', [{ product_id: 'p1', quantity: 1 }]);

    expect(r).toEqual({ ok: false, reason: 'original_nao_guardado' });
    expect(fake.gravacoes.filter((g) => g.tabela === 'order_items')).toHaveLength(0);
    expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();
  });

  it('a rota responde 503 ORIGINAL_NAO_GUARDADO com a mensagem para a tela', async () => {
    const { app } = await subirApp({ orders: PEDIDO, order_originals: FOTO_RECUSADA }, ['order_erp_sync']);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: '/orders/o1/items',
        headers: { authorization: `Bearer ${TOKEN_GERENTE}` },
        payload: { items: [{ product_id: 'p1', quantity: 1 }] },
      });
      expect(res.statusCode).toBe(503);
      const corpo = res.json() as { code: string; error: string };
      expect(corpo.code).toBe('ORIGINAL_NAO_GUARDADO');
      expect(corpo.error).toMatch(/Nada foi alterado/);
    } finally {
      await app.close();
    }
  }, 60_000);

  it('sem a tabela da 044 a edição segue', async () => {
    const { setOrderItems } = await servicoDePedidos(
      {
        orders: PEDIDO,
        product_prices: { data: [{ product_id: 'p1', price: 10, price_larger: null }], error: null },
        order_items: { data: [], error: null },
      },
      ['order_erp_sync', 'order_originals'],
    );

    const r = await setOrderItems('o1', EMPRESA, 'ger-1', 'manager', [{ product_id: 'p1', quantity: 1 }]);

    expect(r.ok).toBe(true);
  });
});

// ─── updated_at nos cadastros ────────────────────────────────────────────────

describe('updated_at nas gravações de cliente', () => {
  async function servicoDeClientes(respostas: Record<string, unknown>) {
    const fake = prepararFake(respostas, []);
    const mod = await import('../apps/api/src/modules/customers/customers.service.js');
    return { ...mod, fake };
  }

  it('marcar inatividade toca o updated_at', async () => {
    const { marcarInatividade, fake } = await servicoDeClientes({ customers: { data: { id: 'c1' }, error: null } });

    const r = await marcarInatividade(EMPRESA, 'c1', { rep_id: REP, irrestrito: true }, 'u1', { motivo: 'Fechou a loja' });

    expect(r).toEqual({ ok: true });
    const gravado = valores(fake, 'customers', 'update')!;
    expect(typeof gravado['updated_at']).toBe('string');
    expect(gravado['updated_at']).toBe(gravado['inactivity_updated_at']);
  });

  it('marcar varejo toca o updated_at', async () => {
    const { marcarVarejo, fake } = await servicoDeClientes({ customers: { data: { id: 'c1' }, error: null } });

    await marcarVarejo(EMPRESA, 'c1', { rep_id: REP }, REP, true);

    const gravado = valores(fake, 'customers', 'update')!;
    expect(gravado['updated_at']).toBe(gravado['varejo_marcado_em']);
  });
});

describe('updated_at em users só com a coluna da 048', () => {
  const REP_LIDO = {
    data: {
      id: REP,
      name: 'Rep Teste',
      email: 'rep@teste.invalid',
      cpf: null,
      legal_name: null,
      phone: null,
      active: true,
      price_table_id: null,
      created_at: '2026-01-01T00:00:00.000Z',
      price_tables: null,
    },
    error: null,
  };
  const LOGIN_LIDO = {
    data: {
      id: 'u2',
      name: 'Login Teste',
      email: 'login@teste.invalid',
      role: 'manager',
      active: true,
      created_at: '2026-01-01T00:00:00.000Z',
    },
    error: null,
  };

  it.each([
    ['com a coluna, grava', [] as string[], true],
    ['sem a coluna, não manda', ['users.updated_at'], false],
  ])('tela de representantes: %s', async (_nome, ausentes, espera) => {
    const fake = prepararFake({ users: REP_LIDO }, ausentes);
    const { updateRep } = await import('../apps/api/src/modules/reps/reps.service.js');

    const r = await updateRep(EMPRESA, REP, { name: 'Rep Teste Novo' });

    expect(r.ok).toBe(true);
    const gravado = valores(fake, 'users', 'update')!;
    expect(gravado['name']).toBe('Rep Teste Novo');
    expect(Object.keys(gravado).includes('updated_at')).toBe(espera);
  });

  it.each([
    ['com a coluna, grava', [] as string[], true],
    ['sem a coluna, não manda', ['users.updated_at'], false],
  ])('tela de logins: %s', async (_nome, ausentes, espera) => {
    const fake = prepararFake({ users: LOGIN_LIDO }, ausentes);
    const { atualizarUsuario } = await import('../apps/api/src/modules/users/users.service.js');

    const r = await atualizarUsuario(EMPRESA, 'adm-1', 'u2', { name: 'Login Teste Novo' });

    expect(r.ok).toBe(true);
    const gravado = valores(fake, 'users', 'update')!;
    expect(gravado['name']).toBe('Login Teste Novo');
    expect(Object.keys(gravado).includes('updated_at')).toBe(espera);
  });
});
