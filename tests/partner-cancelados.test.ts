import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { criarSupabaseFake, type RespostaTabela } from './supabaseFake.js';
import { LIMITE_POSTGREST } from '../apps/api/src/lib/paginacao.js';

/**
 * GET /partner/v1/pedidos/cancelados — o Control descobre que o app cancelou.
 *
 * Desde a 053 o financeiro e o admin cancelam qualquer pedido não faturado,
 * inclusive o que já tem número do Control: o pedido vai para 'rejected' e
 * some da fila (`GET /pedidos`, só 'approved') e da reconciliação
 * (`?incluir=todos`, só 'approved' e 'sent_erp'). Sumir não se distingue de
 * "ainda não chegou" — sem esta lista o programa do Fábio fatura um pedido
 * que a fábrica já cancelou.
 *
 * O que estes testes trancam:
 *   1. só o que o Control pode ter: com número do Control OU solicitado;
 *   2. o `desde` compara com a hora do cancelamento, e exige fuso (400
 *      INVALID_DESDE) como nas outras rotas;
 *   3. canal de pedidos fechado é 409, sem ler o banco;
 *   4. banco sem a 053 (a PLUMENE, hoje) responde 200 com lista vazia e um
 *      aviso — nunca 500; soluço de rede, porém, continua subindo;
 *   5. e o `GET /pedidos`, que aceitava `desde` sem fuso, passa a recusar.
 *
 * Dados todos fictícios.
 */

const EMPRESA = '00000000-0000-0000-0000-00000000000a';
const SUPABASE = '../apps/api/src/config/supabase.js';
const AUTH = '../apps/api/src/modules/partner/partner.auth.js';
const SERVICO = '../apps/api/src/modules/partner/partner.service.js';
const CONTROLLER = '../apps/api/src/modules/partner/partner.controller.js';
const INTEGRACAO = '../apps/api/src/modules/integracao/integracao.service.js';

const OK: RespostaTabela = { data: [], error: null };
/** Sonda de coluna: `cancelled_at` (053), `erp_requested_at` (049), `order_number` (009). */
const SONDA = OK;
const SEM_053: RespostaTabela = {
  data: null,
  error: { message: 'column orders.cancelled_at does not exist', code: '42703' },
};
const SEM_049: RespostaTabela = {
  data: null,
  error: { message: 'column orders.erp_requested_at does not exist', code: '42703' },
};
const SEM_009: RespostaTabela = {
  data: null,
  error: { message: 'column orders.order_number does not exist', code: '42703' },
};
/** Soluco: nao e resposta sobre o schema (nem 42703 nem sucesso). */
const SOLUCO: RespostaTabela = { data: null, error: { message: 'tempo esgotado' } };

/** Cada `from()` consome uma resposta e cada `await` pré-busca a seguinte. */
const emSequencia = (...respostas: RespostaTabela[]) => respostas.flatMap((r) => [r, r]);

const CANCELADO = (extra: Record<string, unknown> = {}) => ({
  id: '00000000-0000-0000-0000-000000000001',
  order_number: 90001,
  erp_order_id: 'ZZ0000001',
  cancelled_at: '2026-10-05T13:00:00+00:00',
  cancel_reason_label: 'CLIENTE CANCELOU',
  cancel_note: 'a loja ligou pedindo para cancelar',
  ...extra,
});

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.doUnmock(SUPABASE);
  vi.doUnmock(AUTH);
  vi.doUnmock(SERVICO);
  vi.doUnmock(INTEGRACAO);
  vi.restoreAllMocks();
});

async function carregar(respostas: Record<string, RespostaTabela | RespostaTabela[]>) {
  const fake = criarSupabaseFake(respostas as never);
  vi.doMock(SUPABASE, () => ({ supabase: fake.cliente }));
  const mod = await import(SERVICO);
  return { ...mod, fake };
}

// ─── listarCanceladosDoControl ───────────────────────────────────────────────

describe('listarCanceladosDoControl — o que o ERP precisa não faturar', () => {
  it('só id, números, momento, motivo e observação — de quem o Control pode ter', async () => {
    const { listarCanceladosDoControl, fake } = await carregar({
      orders: emSequencia(SONDA, SONDA, SONDA, {
        data: [
          CANCELADO(),
          // Solicitado e cancelado antes de o Control confirmar: sem número.
          CANCELADO({ id: 'x2', order_number: 90002, erp_order_id: null, cancel_note: null }),
          // Motivo em branco não vira texto vazio.
          CANCELADO({ id: 'x3', order_number: null, cancel_reason_label: '  ' }),
        ],
        error: null,
      }),
    });

    const { cancelados, avisos } = await listarCanceladosDoControl(EMPRESA, '2026-10-01T00:00:00-03:00');

    expect(avisos).toEqual([]);
    expect(cancelados).toEqual([
      {
        id: '00000000-0000-0000-0000-000000000001',
        numero: 90001,
        pedido_erp: 'ZZ0000001',
        cancelado_em: '2026-10-05T13:00:00+00:00',
        motivo: 'CLIENTE CANCELOU',
        observacao: 'a loja ligou pedindo para cancelar',
      },
      {
        id: 'x2',
        numero: 90002,
        pedido_erp: null,
        cancelado_em: '2026-10-05T13:00:00+00:00',
        motivo: 'CLIENTE CANCELOU',
        observacao: null,
      },
      {
        id: 'x3',
        numero: null,
        pedido_erp: 'ZZ0000001',
        cancelado_em: '2026-10-05T13:00:00+00:00',
        motivo: null,
        observacao: 'a loja ligou pedindo para cancelar',
      },
    ]);

    // Nunca o cliente, as peças, o valor nem quem cancelou.
    const selects = fake.filtrosDe('orders', 'select').map((f) => String(f.args[0]));
    const daLista = selects.at(-1)!;
    expect(daLista).toBe('id, order_number, erp_order_id, cancelled_at, cancel_reason_label, cancel_note');
    expect(daLista).not.toContain('cancelled_by');
    expect(daLista).not.toContain('customer');
    expect(daLista).not.toContain('total');

    const filtros = fake.filtrosDe('orders').map((f) => [f.metodo, ...f.args]);
    expect(filtros).toContainEqual(['eq', 'company_id', EMPRESA]);
    expect(filtros).toContainEqual(['not', 'cancelled_at', 'is', null]);
    // Com número do Control OU solicitado pelo financeiro (049).
    expect(filtros).toContainEqual(['or', 'erp_order_id.not.is.null,erp_requested_at.not.is.null']);
    expect(fake.filtrosDe('orders', 'order').map((f) => f.args)).toEqual([
      ['cancelled_at', { ascending: true }],
      ['id', { ascending: true }],
    ]);
  });

  it('o `desde` compara com a hora do cancelamento; sem ele, a lista inteira', async () => {
    const comDesde = await carregar({ orders: emSequencia(SONDA, SONDA, SONDA, { data: [], error: null }) });
    await comDesde.listarCanceladosDoControl(EMPRESA, '2026-10-01T00:00:00-03:00');
    expect(comDesde.fake.filtrosDe('orders', 'gte').map((f) => f.args)).toEqual([
      ['cancelled_at', '2026-10-01T00:00:00-03:00'],
    ]);

    vi.resetModules();
    const semDesde = await carregar({ orders: emSequencia(SONDA, SONDA, SONDA, { data: [], error: null }) });
    expect(await semDesde.listarCanceladosDoControl(EMPRESA)).toEqual({ cancelados: [], avisos: [] });
    expect(semDesde.fake.filtrosDe('orders', 'gte')).toHaveLength(0);
  });

  it('sem a 049, só o cancelado que já tinha número do Control — e um aviso', async () => {
    const { listarCanceladosDoControl, fake } = await carregar({
      orders: emSequencia(SONDA, SEM_049, SONDA, { data: [CANCELADO()], error: null }),
    });

    const { cancelados, avisos } = await listarCanceladosDoControl(EMPRESA);

    expect(cancelados).toHaveLength(1);
    expect(avisos).toHaveLength(1);
    // A frase sai no corpo da resposta, que é contrato público: fala do
    // recurso que falta, nunca do número da migração do app.
    expect(avisos[0]).toContain('não registra a solicitação ao Control');
    expect(avisos[0]).not.toMatch(/migra/i);
    const filtros = fake.filtrosDe('orders').map((f) => [f.metodo, ...f.args]);
    expect(filtros).toContainEqual(['not', 'erp_order_id', 'is', null]);
    expect(fake.filtrosDe('orders', 'or')).toHaveLength(0);
  });

  it('sem a 053 (a PLUMENE, hoje): lista vazia com aviso, sem consultar nada', async () => {
    const { listarCanceladosDoControl, fake } = await carregar({ orders: SEM_053 });

    const { cancelados, avisos } = await listarCanceladosDoControl(EMPRESA);

    expect(cancelados).toEqual([]);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain('não guarda o cancelamento de pedido');
    expect(avisos[0]).not.toMatch(/migra/i);
    expect(fake.filtrosDe('orders', 'range')).toHaveLength(0);
  });

  it('sonda da 053 que falha por rede LANÇA — soluço não vira "nenhum cancelado"', async () => {
    const { listarCanceladosDoControl } = await carregar({ orders: SOLUCO });

    await expect(listarCanceladosDoControl(EMPRESA)).rejects.toThrow(/orders\.cancelled_at/);
  });

  it('sonda da 049 que falha por rede LANÇA — lista truncada com aviso falso é pior que 500', async () => {
    // `erp_requested_at` é FILTRO: degradar aqui deixaria de fora o cancelado
    // que estava solicitado e ainda sem número, com um aviso dizendo que falta
    // um recurso que existe — e o Control avançaria o cursor por cima dele.
    const { listarCanceladosDoControl, fake } = await carregar({ orders: emSequencia(SONDA, SOLUCO) });

    await expect(listarCanceladosDoControl(EMPRESA)).rejects.toThrow(/orders\.erp_requested_at/);
    expect(fake.filtrosDe('orders', 'range')).toHaveLength(0);
  });

  it('sem a 009 o select não pede `order_number`, e o número sai null', async () => {
    const { listarCanceladosDoControl, fake } = await carregar({
      orders: emSequencia(SONDA, SONDA, SEM_009, {
        data: [{ ...CANCELADO(), order_number: undefined }],
        error: null,
      }),
    });

    const { cancelados } = await listarCanceladosDoControl(EMPRESA);

    expect(cancelados[0]!.numero).toBeNull();
    const selects = fake.filtrosDe('orders', 'select').map((f) => String(f.args[0]));
    expect(selects.at(-1)!).toBe('id, erp_order_id, cancelled_at, cancel_reason_label, cancel_note');
  });

  it('erro numa página LANÇA', async () => {
    const { listarCanceladosDoControl } = await carregar({
      orders: emSequencia(SONDA, SONDA, SONDA, { data: null, error: { message: 'caiu' } }),
    });

    await expect(listarCanceladosDoControl(EMPRESA)).rejects.toThrow(/caiu/);
  });

  it('passa das 1.000 linhas: página cheia e mais uma', async () => {
    const cheia = Array.from({ length: LIMITE_POSTGREST }, (_, i) => CANCELADO({ id: `x-${i}` }));
    const { listarCanceladosDoControl, fake } = await carregar({
      orders: emSequencia(
        SONDA,
        SONDA,
        SONDA,
        { data: cheia, error: null },
        { data: [CANCELADO({ id: 'x-ultimo' })], error: null },
      ),
    });

    const { cancelados } = await listarCanceladosDoControl(EMPRESA);

    expect(cancelados).toHaveLength(LIMITE_POSTGREST + 1);
    expect(cancelados.at(-1)!.id).toBe('x-ultimo');
    expect(fake.filtrosDe('orders', 'range')).toHaveLength(2);
  });
});

// ─── Os handlers ─────────────────────────────────────────────────────────────

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

function requisicao(query: Record<string, unknown> = {}) {
  return { body: undefined, params: { id: 'o1' }, query, headers: { 'x-api-key': 'chave' } } as unknown as FastifyRequest<{
    Querystring: { desde?: string; incluir?: string };
  }> & { partnerLog?: { detalhe?: Record<string, unknown> | null } | null };
}

async function carregarController(servico: Record<string, unknown>, canalPedido = 'api') {
  const fake = criarSupabaseFake({
    companies: {
      data: {
        canal_pedido_erp: canalPedido,
        canal_faturamento: 'manual',
        canal_cadastro: 'carga',
        canal_retrato: 'carga',
        canal_catalogo: 'carga',
      },
      error: null,
    },
  });
  vi.doMock(SUPABASE, () => ({ supabase: fake.cliente }));
  vi.doMock(AUTH, () => ({
    requirePartner: () => Promise.resolve({ name: 'control-cs', key: 'chave', company_id: EMPRESA }),
  }));
  vi.doMock(INTEGRACAO, () => ({
    lerSolicitacaoDeSync: vi.fn().mockResolvedValue({ migracao: true, solicitacao: null, expirado: false }),
  }));
  vi.doMock(SERVICO, () => ({
    getPartnerOrders: vi.fn(),
    confirmOrderImport: vi.fn(),
    conciliarPedidoErp: vi.fn(),
    contarConciliacao: vi.fn(),
    listarExcluidosComNumero: vi.fn(),
    listarCanceladosDoControl: vi.fn(),
    ...servico,
  }));
  return import(CONTROLLER);
}

const LISTA = [
  {
    id: 'c1',
    numero: 90001,
    pedido_erp: 'ZZ0000001',
    cancelado_em: '2026-10-05T13:00:00+00:00',
    motivo: 'CLIENTE CANCELOU',
    observacao: null,
  },
];

describe('GET /pedidos/cancelados — a rota', () => {
  it('entrega a lista, o total, a hora do servidor e os avisos; anota o resumo da chamada', async () => {
    const listarCanceladosDoControl = vi.fn().mockResolvedValue({ cancelados: LISTA, avisos: [] });
    const { partnerCanceladosHandler } = await carregarController({ listarCanceladosDoControl });
    const { reply, enviado } = replyFalso();
    const req = requisicao({ desde: '2026-10-01T00:00:00-03:00' });

    await partnerCanceladosHandler(req, reply);

    expect(enviado.status).toBe(200);
    const corpo = enviado.corpo as Record<string, unknown>;
    expect(Object.keys(corpo).sort()).toEqual(['avisos', 'cancelados', 'servidor_hora', 'total']);
    expect(corpo).toMatchObject({ total: 1, cancelados: LISTA, avisos: [] });
    expect(Number.isNaN(Date.parse(String(corpo['servidor_hora'])))).toBe(false);
    expect(listarCanceladosDoControl).toHaveBeenCalledWith(EMPRESA, '2026-10-01T00:00:00-03:00');
    expect(req.partnerLog?.detalhe).toMatchObject({ desde: '2026-10-01T00:00:00-03:00', cancelados: 1 });
  });

  it('sem `desde` lista tudo', async () => {
    const listarCanceladosDoControl = vi.fn().mockResolvedValue({ cancelados: [], avisos: [] });
    const { partnerCanceladosHandler } = await carregarController({ listarCanceladosDoControl });
    const { reply, enviado } = replyFalso();

    await partnerCanceladosHandler(requisicao(), reply);

    expect(enviado.status).toBe(200);
    expect(enviado.corpo).toMatchObject({ total: 0, cancelados: [] });
    expect(listarCanceladosDoControl).toHaveBeenCalledWith(EMPRESA, undefined);
  });

  it('banco sem a 053: 200 com lista vazia e o aviso — nunca 500', async () => {
    const aviso = 'Esta marca ainda não guarda o cancelamento de pedido: a lista vem sempre vazia.';
    const listarCanceladosDoControl = vi.fn().mockResolvedValue({ cancelados: [], avisos: [aviso] });
    const { partnerCanceladosHandler } = await carregarController({ listarCanceladosDoControl });
    const { reply, enviado } = replyFalso();
    const req = requisicao();

    await partnerCanceladosHandler(req, reply);

    expect(enviado.status).toBe(200);
    expect(enviado.corpo).toMatchObject({ total: 0, cancelados: [], avisos: [aviso] });
    expect(req.partnerLog?.detalhe).toMatchObject({ avisos: 1 });
  });

  it('o `servidor_hora` é a hora de ANTES da consulta, menos a folga', async () => {
    // O `cancelled_at` é carimbado antes de o UPDATE ser confirmado: um
    // cancelamento que espera trava confirma depois da leitura com uma hora
    // anterior a ela. Com a hora tomada DEPOIS da consulta, ele não sairia
    // nesta lista nem na próxima (o `desde` da próxima o excluiria) e o
    // Control faturaria um pedido já cancelado.
    const ANTES = new Date('2026-10-05T13:40:00.000Z');
    const DURANTE = new Date('2026-10-05T13:40:02.500Z');
    const listarCanceladosDoControl = vi.fn(async () => {
      vi.setSystemTime(DURANTE);
      return { cancelados: [], avisos: [] };
    });
    const { partnerCanceladosHandler } = await carregarController({ listarCanceladosDoControl });
    const { FOLGA_DO_SERVIDOR_HORA_MS } = await import('../apps/api/src/modules/partner/partner.porta.js');
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(ANTES);
      const { reply, enviado } = replyFalso();

      await partnerCanceladosHandler(requisicao(), reply);

      const esperada = new Date(ANTES.getTime() - FOLGA_DO_SERVIDOR_HORA_MS).toISOString();
      expect(enviado.corpo).toMatchObject({ servidor_hora: esperada });
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([['manual'], ['sync_py']])('canal de pedidos %s: 409 CANAL_FECHADO, sem ler o banco', async (canal) => {
    const listarCanceladosDoControl = vi.fn();
    const { partnerCanceladosHandler } = await carregarController({ listarCanceladosDoControl }, canal);
    const { reply, enviado } = replyFalso();

    await partnerCanceladosHandler(requisicao(), reply);

    expect(enviado.status).toBe(409);
    expect(enviado.corpo).toMatchObject({ code: 'CANAL_FECHADO', canal: 'pedido_erp', valor_atual: canal });
    expect(listarCanceladosDoControl).not.toHaveBeenCalled();
  });

  it.each([['2026-10-01T00:00:00'], ['2026-10-01'], ['ontem'], ['2026-13-45T00:00:00Z']])(
    '`desde` sem fuso ou inválido (%s) é 400 INVALID_DESDE',
    async (desde) => {
      const listarCanceladosDoControl = vi.fn();
      const { partnerCanceladosHandler } = await carregarController({ listarCanceladosDoControl });
      const { reply, enviado } = replyFalso();

      await partnerCanceladosHandler(requisicao({ desde }), reply);

      expect(enviado.status).toBe(400);
      expect(enviado.corpo).toMatchObject({ code: 'INVALID_DESDE', statusCode: 400 });
      expect(listarCanceladosDoControl).not.toHaveBeenCalled();
    },
  );

  it('o canal é checado ANTES do `desde`: canal fechado e data torta é 409', async () => {
    const listarCanceladosDoControl = vi.fn();
    const { partnerCanceladosHandler } = await carregarController({ listarCanceladosDoControl }, 'manual');
    const { reply, enviado } = replyFalso();

    await partnerCanceladosHandler(requisicao({ desde: 'ontem' }), reply);

    expect(enviado.status).toBe(409);
    expect(enviado.corpo).toMatchObject({ code: 'CANAL_FECHADO' });
  });
});

describe('GET /pedidos — o `desde` passa a exigir fuso, como as outras rotas', () => {
  it.each([['2026-10-01T00:00:00'], ['2026-10-01'], ['ontem']])(
    '`desde` sem fuso (%s) é 400 INVALID_DESDE, sem ler a fila',
    async (desde) => {
      const getPartnerOrders = vi.fn();
      const { partnerOrdersHandler } = await carregarController({ getPartnerOrders });
      const { reply, enviado } = replyFalso();

      await partnerOrdersHandler(requisicao({ desde }), reply);

      expect(enviado.status).toBe(400);
      expect(enviado.corpo).toMatchObject({ code: 'INVALID_DESDE', statusCode: 400 });
      expect(getPartnerOrders).not.toHaveBeenCalled();
    },
  );

  it('`desde` com fuso segue valendo, e chega ao serviço como veio', async () => {
    const getPartnerOrders = vi.fn().mockResolvedValue([]);
    const { partnerOrdersHandler } = await carregarController({ getPartnerOrders });
    const { reply, enviado } = replyFalso();

    await partnerOrdersHandler(requisicao({ desde: '2026-10-01T00:00:00-03:00', incluir: 'todos' }), reply);

    expect(enviado.status).toBe(200);
    expect(getPartnerOrders).toHaveBeenCalledWith(EMPRESA, {
      desde: '2026-10-01T00:00:00-03:00',
      incluirImportados: true,
    });
  });
});
