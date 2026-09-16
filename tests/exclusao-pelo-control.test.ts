import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { criarSupabaseFake, type RespostaTabela } from './supabaseFake.js';

/**
 * O CONTROL EXCLUIU O PEDIDO (POST /partner/v1/pedidos/:id/excluir, 16/09/2026).
 *
 * Pela tela ninguém apaga pedido com número do Control (nem o admin). Quando o
 * Control exclui do lado dele, avisa aqui e o app apaga — com a cópia em
 * deleted_orders no MESMO formato do deleteOrder da tela, deleted_by_name = o
 * parceiro, e o evento 'excluido' (origem api) com o motivo.
 *
 * O que fica trancado:
 *   1. funciona com número do Control (ou solicitado ao Control); a cópia vai
 *      antes do DELETE e é obrigatória com a 040 no ar (não gravou = não apaga);
 *      sem a 040, apaga como sempre; só o pedido é apagado (cascata);
 *   2. pedido faturado não é apagado; id inexistente (ou malformado) é not_found;
 *      o que o Control nunca recebeu (rascunho, aprovado não solicitado) é
 *      fora_do_control; o DELETE repete as condições e, se não apagar, a cópia
 *      sai do histórico;
 *   3. sempre dentro da empresa da chave;
 *   4. a rota: canal de pedidos em 'api', 404/409/500 com os códigos, 200 { ok, excluido_em }.
 *
 * Dados fictícios de propósito.
 */

const EMPRESA = 'empresa-1';
const OK: RespostaTabela = { data: null, error: null };
const SEM_TABELA: RespostaTabela = {
  data: null,
  error: { message: 'relation "deleted_orders" does not exist', code: '42P01' },
};

const PEDIDO = { id: 'o1', order_number: 14632, status: 'sent_erp', invoiced: false, erp_order_id: 'CS0014632' };
const PEDIDO_INTEIRO = {
  ...PEDIDO,
  company_id: EMPRESA,
  total: 1542.48,
  items: [{ id: 'i1', order_id: 'o1', product_id: 'p1', variant_id: 'v1', quantity: 3, unit_price: 43.9, total: 131.7, product: { sku: '0130', name: 'Camisola' }, variant: { size: 'M' } }],
  customer: { name: 'LOJA TESTE', cnpj: '00000000000191' },
  rep: { name: 'REP TESTE' },
};

/** Respostas em sequência para a mesma tabela (o dublê adianta uma a cada consulta). */
function emSequencia(...respostas: RespostaTabela[]): RespostaTabela[] {
  return respostas.flatMap((r, i) => (i === respostas.length - 1 ? [r] : [r, OK]));
}

async function carregar(respostas: Record<string, RespostaTabela | RespostaTabela[]>) {
  const fake = criarSupabaseFake(respostas);
  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
  const mod = await import('../apps/api/src/modules/orders/exclusaoPeloControl.service.js');
  const deteccao = await import('../apps/api/src/lib/detectarColuna.js');
  deteccao.esquecerDeteccoes();
  return { ...mod, fake };
}

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.doUnmock('../apps/api/src/config/supabase.js');
  vi.doUnmock('../apps/api/src/modules/partner/partner.auth.js');
  vi.doUnmock('../apps/api/src/modules/orders/exclusaoPeloControl.service.js');
  vi.doUnmock('../apps/api/src/modules/partner/partner.sync.service.js');
  vi.restoreAllMocks();
});

describe('excluirPedidoPeloControl', () => {
  /** O DELETE que apagou: devolve a linha (o `.select('id')` depois do delete). */
  const APAGOU: RespostaTabela = { data: [{ id: 'o1' }], error: null };

  it('com número do Control: copia (parceiro como quem apagou), apaga SÓ o pedido (a cascata leva as peças) e deixa o rastro', async () => {
    const { excluirPedidoPeloControl, fake } = await carregar({
      // cabeçalho → pedido inteiro (a cópia) → DELETE
      orders: emSequencia({ data: PEDIDO, error: null }, { data: PEDIDO_INTEIRO, error: null }, APAGOU),
      deleted_orders: OK, // a tabela existe (sonda) e o insert gravou
      order_erp_events: OK,
    });

    const r = await excluirPedidoPeloControl(EMPRESA, 'o1', 'control-teste', 'pedido duplicado no Control');

    expect(r).toMatchObject({ outcome: 'ok', numero: 14632, pedido_erp: 'CS0014632' });
    expect(typeof (r as { excluido_em: string }).excluido_em).toBe('string');

    const copia = fake.ultimaGravacao('deleted_orders', 'insert')?.valores as Record<string, unknown>;
    expect(copia).toMatchObject({
      company_id: EMPRESA,
      order_id: 'o1',
      order_number: 14632,
      deleted_by: null,
      deleted_by_name: 'control-teste',
    });
    expect((copia['snapshot'] as { items: unknown[]; customer: { name: string } }).items).toHaveLength(1);
    expect((copia['snapshot'] as { customer: { name: string } }).customer.name).toBe('LOJA TESTE');

    // Ordem: cópia → pedido → evento. As peças caem em cascata (ON DELETE CASCADE).
    const ordem = fake.gravacoes.map((g) => `${g.tabela}:${g.operacao}`);
    expect(ordem).toEqual(['deleted_orders:insert', 'orders:delete', 'order_erp_events:insert']);

    // O rastro da decisão 12: 'excluido' (existe desde a 048), origem api.
    const evento = fake.ultimaGravacao('order_erp_events', 'insert')?.valores as Record<string, unknown>;
    expect(evento).toMatchObject({
      company_id: EMPRESA,
      order_id: 'o1',
      order_number: 14632,
      tipo: 'excluido',
      origem: 'api',
      parceiro: 'control-teste',
      motivo: 'pedido duplicado no Control',
      antes: { erp_order_id: 'CS0014632', status: 'sent_erp' },
      depois: null,
    });

    // Sempre dentro da empresa: na busca e no DELETE do pedido.
    const porEmpresa = fake.filtrosDe('orders', 'eq').filter((f) => f.args[0] === 'company_id' && f.args[1] === EMPRESA);
    expect(porEmpresa.length).toBeGreaterThanOrEqual(3);
    // O DELETE repete as condições: não faturado e ainda com número do Control.
    expect(fake.filtrosDe('orders', 'or').map((f) => f.args)).toEqual([['invoiced.is.null,invoiced.eq.false']]);
    expect(fake.filtrosDe('orders', 'not').map((f) => f.args)).toEqual([['erp_order_id', 'is', null]]);
    expect(fake.filtrosDe('order_items')).toHaveLength(0);
  });

  it.each<[string, Record<string, unknown>]>([
    ['rascunho', { status: 'draft', erp_order_id: null, erp_requested_at: null }],
    ['aguardando aceite', { status: 'pending_approval', erp_order_id: null, erp_requested_at: null }],
    ['aprovado nunca solicitado', { status: 'approved', erp_order_id: null, erp_requested_at: null }],
    ['aprovado num banco sem a 049', { status: 'approved', erp_order_id: null }],
  ])('%s: o Control nunca recebeu — fora_do_control, nada copiado nem apagado', async (_nome, estado) => {
    const { excluirPedidoPeloControl, fake } = await carregar({
      orders: { data: { ...PEDIDO, ...estado }, error: null },
      deleted_orders: OK,
    });

    expect(await excluirPedidoPeloControl(EMPRESA, 'o1', 'control-teste', null)).toEqual({ outcome: 'fora_do_control' });
    expect(fake.gravacoes).toEqual([]);
  });

  it('solicitado ao Control e ainda sem número: apaga (o Control pode ter importado e excluído antes de confirmar)', async () => {
    const SOLICITADO = { ...PEDIDO, status: 'approved', erp_order_id: null, erp_requested_at: '2026-09-16T13:00:00Z' };
    const { excluirPedidoPeloControl, fake } = await carregar({
      orders: emSequencia({ data: SOLICITADO, error: null }, { data: PEDIDO_INTEIRO, error: null }, APAGOU),
      deleted_orders: OK,
      order_erp_events: OK,
    });

    expect(await excluirPedidoPeloControl(EMPRESA, 'o1', 'control-teste', null)).toMatchObject({ outcome: 'ok', pedido_erp: null });
    expect(fake.filtrosDe('orders', 'not').map((f) => f.args)).toEqual([['erp_requested_at', 'is', null]]);
  });

  it('com a 040 no ar, cópia que não gravou segura o pedido (sem_copia): nada apagado', async () => {
    const { excluirPedidoPeloControl, fake } = await carregar({
      orders: emSequencia({ data: PEDIDO, error: null }, { data: PEDIDO_INTEIRO, error: null }, APAGOU),
      deleted_orders: emSequencia(OK, { data: null, error: { message: 'disco cheio' } }),
    });

    const r = await excluirPedidoPeloControl(EMPRESA, 'o1', 'control-teste', null);

    expect(r).toEqual({ outcome: 'sem_copia' });
    expect(fake.gravacoes.some((g) => g.operacao === 'delete')).toBe(false);
    expect(fake.gravacoes.some((g) => g.tabela === 'order_erp_events')).toBe(false);
  });

  it('sem a 040, apaga sem tentar copiar', async () => {
    const { excluirPedidoPeloControl, fake } = await carregar({
      orders: emSequencia({ data: PEDIDO, error: null }, APAGOU),
      deleted_orders: SEM_TABELA,
      order_erp_events: OK,
    });

    const r = await excluirPedidoPeloControl(EMPRESA, 'o1', 'control-teste', null);

    expect(r).toMatchObject({ outcome: 'ok' });
    expect(fake.ultimaGravacao('deleted_orders', 'insert')).toBeUndefined();
    expect(fake.ultimaGravacao('orders', 'delete')).toBeDefined();
  });

  it('pedido faturado não é apagado; inexistente e id malformado são not_found; erro na busca é falhou', async () => {
    const faturado = await carregar({ orders: { data: { ...PEDIDO, invoiced: true }, error: null } });
    expect(await faturado.excluirPedidoPeloControl(EMPRESA, 'o1', 'control-teste', null)).toEqual({ outcome: 'faturado' });
    expect(faturado.fake.gravacoes).toEqual([]);

    vi.resetModules();
    const inexistente = await carregar({ orders: { data: null, error: null } });
    expect(await inexistente.excluirPedidoPeloControl(EMPRESA, 'o9', 'control-teste', null)).toEqual({ outcome: 'not_found' });

    vi.resetModules();
    const malformado = await carregar({
      orders: { data: null, error: { message: 'invalid input syntax for type uuid: "abc"', code: '22P02' } },
    });
    expect(await malformado.excluirPedidoPeloControl(EMPRESA, 'abc', 'control-teste', null)).toEqual({ outcome: 'not_found' });

    vi.resetModules();
    const caiu = await carregar({ orders: { data: null, error: { message: 'timeout' } } });
    expect(await caiu.excluirPedidoPeloControl(EMPRESA, 'o1', 'control-teste', null)).toEqual({
      outcome: 'falhou',
      erro: 'falha ao buscar: timeout',
    });
  });

  it('faturado entre a leitura e o DELETE: nada apagado, a cópia sai do histórico e a resposta é faturado', async () => {
    const { excluirPedidoPeloControl, fake } = await carregar({
      orders: emSequencia(
        { data: PEDIDO, error: null },
        { data: PEDIDO_INTEIRO, error: null },
        { data: [], error: null }, // o DELETE não casou mais
        { data: { ...PEDIDO, invoiced: true }, error: null }, // relido
      ),
      deleted_orders: OK,
    });

    const r = await excluirPedidoPeloControl(EMPRESA, 'o1', 'control-teste', null);

    expect(r).toEqual({ outcome: 'faturado' });
    const copiaTirada = fake.ultimaGravacao('deleted_orders', 'delete');
    expect(copiaTirada).toBeDefined();
    expect(fake.filtrosDe('deleted_orders', 'eq').map((f) => f.args)).toEqual(
      expect.arrayContaining([
        ['company_id', EMPRESA],
        ['order_id', 'o1'],
      ]),
    );
    expect(fake.gravacoes.some((g) => g.tabela === 'order_erp_events')).toBe(false);
  });

  it('o DELETE do pedido que falha é falhou, a cópia sai do histórico e o evento não é registrado', async () => {
    const { excluirPedidoPeloControl, fake } = await carregar({
      orders: emSequencia({ data: PEDIDO, error: null }, { data: PEDIDO_INTEIRO, error: null }, { data: null, error: { message: 'bloqueado' } }),
      deleted_orders: OK,
    });

    const r = await excluirPedidoPeloControl(EMPRESA, 'o1', 'control-teste', null);

    expect(r).toEqual({ outcome: 'falhou', erro: 'falha ao apagar: bloqueado' });
    expect(fake.ultimaGravacao('deleted_orders', 'delete')).toBeDefined();
    expect(fake.gravacoes.some((g) => g.tabela === 'order_erp_events')).toBe(false);
  });
});

// ─── A rota ──────────────────────────────────────────────────────────────────

const SUPABASE = '../apps/api/src/config/supabase.js';
const AUTH = '../apps/api/src/modules/partner/partner.auth.js';
const SERVICO = '../apps/api/src/modules/orders/exclusaoPeloControl.service.js';
const CADASTROS = '../apps/api/src/modules/partner/partner.sync.service.js';
const CONTROLLER = '../apps/api/src/modules/partner/partner.cadastros.controller.js';

function replyFalso() {
  const enviado: { status: number; corpo: unknown } = { status: 200, corpo: undefined };
  const reply = {
    status(codigo: number) {
      enviado.status = codigo;
      return reply;
    },
    send(corpo: unknown) {
      enviado.corpo = corpo;
      return Promise.resolve();
    },
  };
  return { reply: reply as unknown as FastifyReply, enviado };
}

function requisicao(body: unknown, params: Record<string, string> = {}, query: Record<string, string> = {}) {
  return { body, params, query, headers: { 'x-api-key': 'chave' } } as unknown as FastifyRequest<{
    Params: { id: string };
    Body: { motivo?: unknown };
    Querystring: { desde?: string };
  }> & { partnerLog?: { company_id?: string | null; detalhe?: Record<string, unknown> | null } | null };
}

async function carregarRota(
  canais: { pedido_erp?: string; cadastro?: string },
  servicos: { excluirPedidoPeloControl?: unknown; listarClientesAlterados?: unknown; listarRepresentantesAlterados?: unknown },
) {
  const fake = criarSupabaseFake({
    companies: {
      data: {
        canal_pedido_erp: canais.pedido_erp ?? 'manual',
        canal_faturamento: 'manual',
        canal_cadastro: canais.cadastro ?? 'carga',
        canal_retrato: 'carga',
        canal_catalogo: 'carga',
      },
      error: null,
    },
  });
  vi.doMock(SUPABASE, () => ({ supabase: fake.cliente }));
  vi.doMock(AUTH, () => ({
    requirePartner: () => Promise.resolve({ name: 'control-teste', key: 'chave', company_id: EMPRESA }),
  }));
  vi.doMock(SERVICO, () => ({ excluirPedidoPeloControl: servicos.excluirPedidoPeloControl ?? vi.fn() }));
  vi.doMock(CADASTROS, () => ({
    listarClientesAlterados: servicos.listarClientesAlterados ?? vi.fn(),
    listarRepresentantesAlterados: servicos.listarRepresentantesAlterados ?? vi.fn(),
  }));
  const controller = await import(CONTROLLER);
  return { ...controller, fake };
}

describe('POST /partner/v1/pedidos/:id/excluir — a rota', () => {
  it('canal manual: 409 CANAL_FECHADO sem chamar o serviço', async () => {
    const excluir = vi.fn();
    const { partnerExcluirPedidoHandler } = await carregarRota({ pedido_erp: 'manual' }, { excluirPedidoPeloControl: excluir });
    const { reply, enviado } = replyFalso();

    await partnerExcluirPedidoHandler(requisicao({ motivo: 'x' }, { id: 'o1' }), reply);

    expect(enviado.status).toBe(409);
    expect(enviado.corpo).toMatchObject({ code: 'CANAL_FECHADO', canal: 'pedido_erp', valor_atual: 'manual' });
    expect(excluir).not.toHaveBeenCalled();
  });

  it.each<[string, Record<string, unknown>, number, string]>([
    ['not_found', { outcome: 'not_found' }, 404, 'ORDER_NOT_FOUND'],
    ['faturado', { outcome: 'faturado' }, 409, 'ORDER_INVOICED'],
    ['fora_do_control', { outcome: 'fora_do_control' }, 409, 'ORDER_NOT_IN_CONTROL'],
    ['sem_copia', { outcome: 'sem_copia' }, 500, 'SEM_COPIA'],
    ['falhou', { outcome: 'falhou', erro: 'caiu' }, 500, 'INTERNAL_ERROR'],
  ])('desfecho %s vira %i %s', async (_nome, resultado, status, code) => {
    const excluir = vi.fn().mockResolvedValue(resultado);
    const { partnerExcluirPedidoHandler } = await carregarRota({ pedido_erp: 'api' }, { excluirPedidoPeloControl: excluir });
    const { reply, enviado } = replyFalso();
    const req = requisicao({}, { id: 'o1' });

    await partnerExcluirPedidoHandler(req, reply);

    expect(enviado.status).toBe(status);
    expect(enviado.corpo).toMatchObject({ code, statusCode: status });
    expect(req.partnerLog).toMatchObject({ detalhe: { code, order_id: 'o1' } });
  });

  it('canal api: chama o serviço com o parceiro e o motivo aparado, e responde { ok, excluido_em }', async () => {
    const excluir = vi.fn().mockResolvedValue({
      outcome: 'ok',
      excluido_em: '2026-09-16T12:00:00.000Z',
      numero: 14632,
      pedido_erp: 'CS0014632',
    });
    const { partnerExcluirPedidoHandler } = await carregarRota({ pedido_erp: 'api' }, { excluirPedidoPeloControl: excluir });
    const { reply, enviado } = replyFalso();
    const req = requisicao({ motivo: '  cliente desistiu  ' }, { id: 'o1' });

    await partnerExcluirPedidoHandler(req, reply);

    expect(enviado.status).toBe(200);
    expect(enviado.corpo).toEqual({ ok: true, excluido_em: '2026-09-16T12:00:00.000Z' });
    expect(excluir).toHaveBeenCalledWith(EMPRESA, 'o1', 'control-teste', 'cliente desistiu');
    expect(req.partnerLog).toMatchObject({ recebidos: 1, gravados: 1, detalhe: { order_id: 'o1', pedido_erp: 'CS0014632' } });

    // Corpo sem motivo (ou que não é objeto) vira motivo nulo, nunca TypeError.
    await partnerExcluirPedidoHandler(requisicao(null, { id: 'o1' }), replyFalso().reply);
    expect(excluir).toHaveBeenLastCalledWith(EMPRESA, 'o1', 'control-teste', null);
  });
});

describe('GET /partner/v1/clientes e /representantes ?desde= — as rotas', () => {
  it('canal de cadastro fechado: 409 sem chamar o serviço', async () => {
    const listar = vi.fn();
    const { partnerClientesAlteradosHandler, partnerRepresentantesAlteradosHandler } = await carregarRota(
      { cadastro: 'carga' },
      { listarClientesAlterados: listar, listarRepresentantesAlterados: listar },
    );

    const c = replyFalso();
    await partnerClientesAlteradosHandler(requisicao(undefined), c.reply);
    expect(c.enviado).toMatchObject({ status: 409, corpo: { code: 'CANAL_FECHADO', canal: 'cadastro' } });

    const r = replyFalso();
    await partnerRepresentantesAlteradosHandler(requisicao(undefined), r.reply);
    expect(r.enviado).toMatchObject({ status: 409, corpo: { code: 'CANAL_FECHADO', canal: 'cadastro' } });
    expect(listar).not.toHaveBeenCalled();
  });

  it('desde sem fuso é 400 INVALID_DESDE; sem desde vale undefined (tudo)', async () => {
    const listar = vi.fn().mockResolvedValue({ registros: [], avisos: [] });
    const { partnerClientesAlteradosHandler } = await carregarRota({ cadastro: 'api' }, { listarClientesAlterados: listar });

    const ruim = replyFalso();
    await partnerClientesAlteradosHandler(requisicao(undefined, {}, { desde: '2026-09-16T00:00:00' }), ruim.reply);
    expect(ruim.enviado).toMatchObject({ status: 400, corpo: { code: 'INVALID_DESDE' } });
    expect(listar).not.toHaveBeenCalled();

    const semDesde = replyFalso();
    await partnerClientesAlteradosHandler(requisicao(undefined, {}, {}), semDesde.reply);
    expect(semDesde.enviado.status).toBe(200);
    expect(listar).toHaveBeenCalledWith(EMPRESA, undefined);
  });

  it('canal api: devolve total, servidor_hora, a lista no formato do POST e os avisos; anota a chamada', async () => {
    const clientes = [
      { codigo: null, chave: '00000000000191', novo_no_control: true, razao_social: 'LOJA NOVA' },
      { codigo: '00123', chave: '00000000000272', novo_no_control: false, razao_social: 'LOJA ANTIGA' },
    ];
    const listarClientes = vi.fn().mockResolvedValue({ registros: clientes, avisos: ['um aviso'] });
    const reps = [{ codigo: '00779', nome: 'REP TESTE', razao_social: null, ativo: 'S', atualizado_em: null }];
    const listarReps = vi.fn().mockResolvedValue({ registros: reps, avisos: [] });
    const { partnerClientesAlteradosHandler, partnerRepresentantesAlteradosHandler } = await carregarRota(
      { cadastro: 'api' },
      { listarClientesAlterados: listarClientes, listarRepresentantesAlterados: listarReps },
    );

    const c = replyFalso();
    const reqC = requisicao(undefined, {}, { desde: '2026-09-16T00:00:00-03:00' });
    await partnerClientesAlteradosHandler(reqC, c.reply);
    expect(c.enviado.status).toBe(200);
    expect(c.enviado.corpo).toMatchObject({ total: 2, clientes, avisos: ['um aviso'] });
    expect(typeof (c.enviado.corpo as { servidor_hora: string }).servidor_hora).toBe('string');
    expect(listarClientes).toHaveBeenCalledWith(EMPRESA, '2026-09-16T00:00:00-03:00');
    expect(reqC.partnerLog).toMatchObject({
      detalhe: { desde: '2026-09-16T00:00:00-03:00', clientes: 2, novos_no_control: 1, avisos: 1 },
    });

    const r = replyFalso();
    const reqR = requisicao(undefined, {}, { desde: '2026-09-16T00:00:00Z' });
    await partnerRepresentantesAlteradosHandler(reqR, r.reply);
    expect(r.enviado.corpo).toMatchObject({ total: 1, representantes: reps, avisos: [] });
    expect(listarReps).toHaveBeenCalledWith(EMPRESA, '2026-09-16T00:00:00Z');
    expect(reqR.partnerLog).toMatchObject({ detalhe: { representantes: 1 } });
  });
});
