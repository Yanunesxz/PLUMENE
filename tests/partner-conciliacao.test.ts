import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { criarSupabaseFake, type Filtro, type RespostaTabela } from './supabaseFake.js';
import { LIMITE_POSTGREST } from '../apps/api/src/lib/paginacao.js';

/**
 * As três rotas novas da fase 0 do lado dos PEDIDOS:
 *
 *   • POST /partner/v1/pedidos/:id/conciliar — o passivo `sent_erp` sem número
 *     (o financeiro lançou no Control e marcou "enviado" sem digitar o número).
 *     Ordem trancada: formato → existe → já tem número (o mesmo é idempotente,
 *     outro é conflito) → só `sent_erp` → número livre → grava só se ninguém
 *     gravou no meio. Não mexe no status; diz a origem `conciliacao`; deixa o
 *     rastro `numero_conciliado`. Exige canal_pedido_erp = 'api'.
 *   • GET /partner/v1/conciliacao — só contagens (count exact, limit 0), sempre
 *     liberada, erro sobe.
 *   • GET /partner/v1/pedidos/excluidos — só id, números e momento dos
 *     excluídos que tinham número do Control; nunca o snapshot; `desde` exige
 *     fuso; sempre liberada.
 *
 * Dados todos fictícios.
 */

const EMPRESA = '00000000-0000-0000-0000-00000000000a';
const SUPABASE = '../apps/api/src/config/supabase.js';
const ERP_SYNC = '../apps/api/src/modules/orders/erpSync.service.js';
const AUTH = '../apps/api/src/modules/partner/partner.auth.js';
const SERVICO = '../apps/api/src/modules/partner/partner.service.js';
const CONTROLLER = '../apps/api/src/modules/partner/partner.controller.js';

const OK: RespostaTabela = { data: [], error: null };
const COLUNA_AUSENTE: RespostaTabela = {
  data: null,
  error: { message: 'column orders.erp_order_source does not exist', code: '42703' },
};

/** Cada `from()` consome uma resposta e cada `await` pré-busca a seguinte. */
const emSequencia = (...respostas: RespostaTabela[]) => respostas.flatMap((r) => [r, r]);

const LIDO = (linha: Record<string, unknown> | null): RespostaTabela => ({ data: linha, error: null });
const ENVIADO_SEM_NUMERO = LIDO({ id: 'o1', status: 'sent_erp', erp_order_id: null });
/** Sonda de `orders.order_number` (a pré-checagem do dono do número). */
const SONDA = OK;
const NUMERO_LIVRE: RespostaTabela = { data: [], error: null };
const NUMERO_DO_O2: RespostaTabela = { data: [{ id: 'o2', order_number: 90002 }], error: null };
/** Sonda de `orders.erp_order_source` (048). */
const SONDA_ORIGEM = OK;
const GRAVOU: RespostaTabela = { data: [{ id: 'o1', order_number: 90001 }], error: null };

async function carregar(respostas: Record<string, RespostaTabela | RespostaTabela[]>) {
  const fake = criarSupabaseFake(respostas as never);
  vi.doMock(SUPABASE, () => ({ supabase: fake.cliente }));
  const registrarNoErp = vi.fn().mockResolvedValue('guardada');
  vi.doMock(ERP_SYNC, () => ({ registrarNoErp }));
  const mod = await import(SERVICO);
  return { ...mod, fake, registrarNoErp };
}

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.doUnmock(SUPABASE);
  vi.doUnmock(ERP_SYNC);
  vi.doUnmock(AUTH);
  vi.doUnmock(SERVICO);
  vi.restoreAllMocks();
});

// ─── conciliarPedidoErp ──────────────────────────────────────────────────────

describe('conciliarPedidoErp — o número do Control para o sent_erp sem número', () => {
  it('grava o número normalizado SEM mexer no status, com origem conciliacao, foto e rastro', async () => {
    const { conciliarPedidoErp, fake, registrarNoErp } = await carregar({
      orders: emSequencia(ENVIADO_SEM_NUMERO, SONDA, NUMERO_LIVRE, SONDA_ORIGEM, GRAVOU),
    });

    const r = await conciliarPedidoErp(EMPRESA, 'o1', ' zz-0000001 ', 'control-cs');

    expect(r).toEqual({ outcome: 'ok', ja_conciliado: false });
    const gravado = fake.ultimaGravacao('orders', 'update')?.valores as Record<string, unknown>;
    expect(Object.keys(gravado).sort()).toEqual([
      'erp_order_id',
      'erp_order_set_at',
      'erp_order_set_by',
      'erp_order_source',
      'synced_at',
      'updated_at',
    ]);
    expect(gravado).toMatchObject({ erp_order_id: 'ZZ0000001', erp_order_source: 'conciliacao', erp_order_set_by: null });
    expect(gravado['erp_order_set_at']).toBe(gravado['updated_at']);

    // Só grava se continua enviado, sem número, e nesta empresa.
    const eqs = fake.filtrosDe('orders', 'eq').map((f) => f.args);
    expect(eqs).toContainEqual(['company_id', EMPRESA]);
    expect(eqs).toContainEqual(['status', 'sent_erp']);
    expect(fake.filtrosDe('orders', 'is').map((f) => f.args)).toContainEqual(['erp_order_id', null]);

    expect(registrarNoErp).toHaveBeenCalledWith('o1', EMPRESA, null);
    const evento = fake.ultimaGravacao('order_erp_events', 'insert')?.valores as Record<string, unknown>;
    expect(evento).toMatchObject({
      company_id: EMPRESA,
      order_id: 'o1',
      order_number: 90001,
      tipo: 'numero_conciliado',
      origem: 'api',
      parceiro: 'control-cs',
      antes: { erp_order_id: null },
      depois: { erp_order_id: 'ZZ0000001' },
    });
  });

  it('sem a 048: o UPDATE leva só número, synced_at e updated_at', async () => {
    const { conciliarPedidoErp, fake } = await carregar({
      orders: emSequencia(ENVIADO_SEM_NUMERO, SONDA, NUMERO_LIVRE, COLUNA_AUSENTE, GRAVOU),
      order_erp_events: { data: null, error: { message: 'relation "order_erp_events" does not exist', code: '42P01' } },
    });

    expect(await conciliarPedidoErp(EMPRESA, 'o1', 'ZZ0000001')).toEqual({ outcome: 'ok', ja_conciliado: false });
    const gravado = fake.ultimaGravacao('orders', 'update')?.valores as Record<string, unknown>;
    expect(Object.keys(gravado).sort()).toEqual(['erp_order_id', 'synced_at', 'updated_at']);
    expect(fake.ultimaGravacao('order_erp_events', 'insert')).toBeUndefined();
  });

  it('número fora da máscara é invalid_number antes de tocar no banco', async () => {
    const { conciliarPedidoErp, fake } = await carregar({ orders: emSequencia(ENVIADO_SEM_NUMERO) });

    for (const ruim of ['PED-00123', '17379', 'ZZ', 'Z0000001']) {
      expect(await conciliarPedidoErp(EMPRESA, 'o1', ruim)).toEqual({ outcome: 'invalid_number' });
    }
    expect(fake.filtrosDe('orders')).toHaveLength(0);
  });

  it('pedido que não existe, de outra empresa ou com id malformado (22P02) é not_found', async () => {
    const a = await carregar({ orders: emSequencia(LIDO(null)) });
    expect(await a.conciliarPedidoErp(EMPRESA, 'o1', 'ZZ0000001')).toEqual({ outcome: 'not_found' });
    expect(a.fake.filtrosDe('orders', 'eq').map((f) => f.args)).toContainEqual(['company_id', EMPRESA]);

    vi.resetModules();
    const b = await carregar({
      orders: emSequencia({ data: null, error: { message: 'invalid input syntax for type uuid', code: '22P02' } }),
    });
    expect(await b.conciliarPedidoErp(EMPRESA, 'abc', 'ZZ0000001')).toEqual({ outcome: 'not_found' });
  });

  it('erro de banco na leitura LANÇA', async () => {
    const { conciliarPedidoErp } = await carregar({
      orders: emSequencia({ data: null, error: { message: 'timeout' } }),
    });

    await expect(conciliarPedidoErp(EMPRESA, 'o1', 'ZZ0000001')).rejects.toThrow(/timeout/);
  });

  it('repetir com o MESMO número (outra grafia) é idempotente: ja_conciliado, sem gravar nem rastro', async () => {
    const { conciliarPedidoErp, fake, registrarNoErp } = await carregar({
      orders: emSequencia(LIDO({ id: 'o1', status: 'sent_erp', erp_order_id: 'zz 0000001' })),
    });

    expect(await conciliarPedidoErp(EMPRESA, 'o1', 'ZZ0000001')).toEqual({ outcome: 'ok', ja_conciliado: true });
    expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();
    expect(fake.ultimaGravacao('order_erp_events', 'insert')).toBeUndefined();
    expect(registrarNoErp).not.toHaveBeenCalled();
  });

  it('número DIFERENTE do já gravado é conflito — e o "já tem número" vem antes do status', async () => {
    const { conciliarPedidoErp, fake } = await carregar({
      orders: emSequencia(LIDO({ id: 'o1', status: 'approved', erp_order_id: 'ZZ0000009' })),
    });

    expect(await conciliarPedidoErp(EMPRESA, 'o1', 'ZZ0000001')).toEqual({
      outcome: 'conflict',
      pedido_erp_atual: 'ZZ0000009',
    });
    expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();
  });

  it.each([['approved'], ['error_erp'], ['draft'], ['pending_approval'], ['rejected']])(
    'pedido em %s sem número não é conciliável (aprovado usa /confirmar)',
    async (status) => {
      const { conciliarPedidoErp, fake } = await carregar({
        orders: emSequencia(LIDO({ id: 'o1', status, erp_order_id: null })),
      });

      expect(await conciliarPedidoErp(EMPRESA, 'o1', 'ZZ0000001')).toEqual({
        outcome: 'not_reconcilable',
        situacao: status,
      });
      expect(fake.filtrosDe('orders', 'neq')).toHaveLength(0);
      expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();
    },
  );

  it('número já usado por OUTRO pedido da empresa é recusado antes de gravar, dizendo qual', async () => {
    const { conciliarPedidoErp, fake } = await carregar({
      orders: emSequencia(ENVIADO_SEM_NUMERO, SONDA, NUMERO_DO_O2),
    });

    expect(await conciliarPedidoErp(EMPRESA, 'o1', 'ZZ0000001')).toEqual({
      outcome: 'number_in_use',
      pedido_em_uso: { id: 'o2', numero: 90002 },
    });
    expect(fake.filtrosDe('orders', 'eq').map((f) => f.args)).toContainEqual(['erp_order_id', 'ZZ0000001']);
    expect(fake.filtrosDe('orders', 'neq').map((f) => f.args)).toContainEqual(['id', 'o1']);
    expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();
  });

  it('o índice único (23505) na gravação vira number_in_use, não 500', async () => {
    const { conciliarPedidoErp, registrarNoErp } = await carregar({
      orders: emSequencia(
        ENVIADO_SEM_NUMERO,
        SONDA,
        NUMERO_LIVRE,
        SONDA_ORIGEM,
        { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } },
        NUMERO_DO_O2,
      ),
    });

    expect(await conciliarPedidoErp(EMPRESA, 'o1', 'ZZ0000001')).toEqual({
      outcome: 'number_in_use',
      pedido_em_uso: { id: 'o2', numero: 90002 },
    });
    expect(registrarNoErp).not.toHaveBeenCalled();
  });

  it('outro erro na gravação LANÇA', async () => {
    const { conciliarPedidoErp } = await carregar({
      orders: emSequencia(ENVIADO_SEM_NUMERO, SONDA, NUMERO_LIVRE, SONDA_ORIGEM, {
        data: null,
        error: { message: 'caiu a conexão' },
      }),
    });

    await expect(conciliarPedidoErp(EMPRESA, 'o1', 'ZZ0000001')).rejects.toThrow(/caiu a conexão/);
  });

  it('corrida: ninguém afetado porque alguém conciliou no meio com o MESMO número → idempotente', async () => {
    const { conciliarPedidoErp, registrarNoErp, fake } = await carregar({
      orders: emSequencia(
        ENVIADO_SEM_NUMERO,
        SONDA,
        NUMERO_LIVRE,
        SONDA_ORIGEM,
        { data: [], error: null },
        LIDO({ id: 'o1', status: 'sent_erp', erp_order_id: 'ZZ0000001' }),
      ),
    });

    expect(await conciliarPedidoErp(EMPRESA, 'o1', 'ZZ0000001')).toEqual({ outcome: 'ok', ja_conciliado: true });
    expect(registrarNoErp).not.toHaveBeenCalled();
    expect(fake.ultimaGravacao('order_erp_events', 'insert')).toBeUndefined();
  });

  it('corrida: o pedido saiu de sent_erp no meio → not_reconcilable com a situação de agora', async () => {
    const { conciliarPedidoErp } = await carregar({
      orders: emSequencia(
        ENVIADO_SEM_NUMERO,
        SONDA,
        NUMERO_LIVRE,
        SONDA_ORIGEM,
        { data: [], error: null },
        LIDO({ id: 'o1', status: 'error_erp', erp_order_id: null }),
      ),
    });

    expect(await conciliarPedidoErp(EMPRESA, 'o1', 'ZZ0000001')).toEqual({
      outcome: 'not_reconcilable',
      situacao: 'error_erp',
    });
  });

  it('corrida: alguém conciliou no meio com OUTRO número → conflito, não sobrescreve', async () => {
    const { conciliarPedidoErp } = await carregar({
      orders: emSequencia(
        ENVIADO_SEM_NUMERO,
        SONDA,
        NUMERO_LIVRE,
        SONDA_ORIGEM,
        { data: [], error: null },
        LIDO({ id: 'o1', status: 'sent_erp', erp_order_id: 'ZZ0000009' }),
      ),
    });

    expect(await conciliarPedidoErp(EMPRESA, 'o1', 'ZZ0000001')).toEqual({
      outcome: 'conflict',
      pedido_erp_atual: 'ZZ0000009',
    });
  });
});

// ─── contarConciliacao ───────────────────────────────────────────────────────

/** Os filtros de cada contagem, separados a cada `select`. */
function consultasDe(filtros: Filtro[]): Filtro[][] {
  const grupos: Filtro[][] = [];
  for (const f of filtros) {
    if (f.metodo === 'select') grupos.push([]);
    grupos.at(-1)?.push(f);
  }
  return grupos;
}

const contagem = (n: number): RespostaTabela => ({ data: [], error: null, count: n });

describe('contarConciliacao — só contagens da empresa da chave', () => {
  it('as cinco grandezas, cada uma com o seu filtro, count exact e limit 0 (nenhuma linha)', async () => {
    const { contarConciliacao, fake } = await carregar({
      // sonda de invoiced (+ espaço), as cinco contagens em paralelo, e os espaços delas.
      orders: [OK, OK, contagem(1), contagem(2), contagem(3), contagem(4), contagem(5), OK, OK, OK, OK, OK],
    });

    const r = await contarConciliacao(EMPRESA);

    expect(r).toEqual({
      fila_aprovados_sem_numero_nao_faturados: 1,
      enviados_sem_numero_nao_faturados: 2,
      enviados_sem_numero_faturados: 3,
      aprovados_faturados_sem_numero: 4,
      enviados_com_numero_sem_faturamento: 5,
    });

    const [sonda, ...contagens] = consultasDe(fake.filtrosDe('orders'));
    expect(sonda!.map((f) => f.metodo)).toEqual(['select', 'limit']);
    expect(contagens).toHaveLength(5);
    const resumo = contagens.map((c) => c.map((f) => [f.metodo, ...f.args]));
    for (const c of resumo) {
      expect(c[0]).toEqual(['select', 'id', { count: 'exact' }]);
      expect(c).toContainEqual(['eq', 'company_id', EMPRESA]);
      expect(c.at(-1)).toEqual(['limit', 0]);
    }
    const semFaturado = ['or', 'invoiced.is.null,invoiced.eq.false'];
    const faturado = ['eq', 'invoiced', true];
    const semNumero = ['is', 'erp_order_id', null];
    const comNumero = ['not', 'erp_order_id', 'is', null];
    expect(resumo[0]).toEqual(expect.arrayContaining([['eq', 'status', 'approved'], semNumero, semFaturado]));
    expect(resumo[1]).toEqual(expect.arrayContaining([['eq', 'status', 'sent_erp'], semNumero, semFaturado]));
    expect(resumo[2]).toEqual(expect.arrayContaining([['eq', 'status', 'sent_erp'], semNumero, faturado]));
    expect(resumo[3]).toEqual(expect.arrayContaining([['eq', 'status', 'approved'], semNumero, faturado]));
    expect(resumo[4]).toEqual(expect.arrayContaining([['eq', 'status', 'sent_erp'], comNumero, semFaturado]));
  });

  it('banco sem invoiced (antes da 027): faturados são 0 sem consultar, e os outros sem o filtro', async () => {
    const { contarConciliacao, fake } = await carregar({
      orders: [
        { data: null, error: { message: 'column orders.invoiced does not exist', code: '42703' } },
        OK,
        contagem(7),
        contagem(8),
        contagem(9),
        OK,
        OK,
        OK,
      ],
    });

    expect(await contarConciliacao(EMPRESA)).toEqual({
      fila_aprovados_sem_numero_nao_faturados: 7,
      enviados_sem_numero_nao_faturados: 8,
      enviados_sem_numero_faturados: 0,
      aprovados_faturados_sem_numero: 0,
      enviados_com_numero_sem_faturamento: 9,
    });
    expect(fake.filtrosDe('orders', 'or')).toHaveLength(0);
    expect(fake.filtrosDe('orders', 'select')).toHaveLength(4);
  });

  it('sonda de invoiced que falha por rede LANÇA e não conta nada', async () => {
    const { contarConciliacao, fake } = await carregar({
      orders: { data: null, error: { message: 'timeout' } },
    });

    await expect(contarConciliacao(EMPRESA)).rejects.toThrow(/orders\.invoiced/);
    expect(fake.filtrosDe('orders', 'select')).toHaveLength(1);
  });

  it('erro em qualquer contagem LANÇA — nunca um painel com número inventado', async () => {
    const { contarConciliacao } = await carregar({
      orders: [OK, OK, contagem(1), { data: null, error: { message: 'caiu' } }, contagem(3), contagem(4), contagem(5), OK],
    });

    await expect(contarConciliacao(EMPRESA)).rejects.toThrow(/caiu/);
  });

  it('banco que não devolve a contagem também LANÇA', async () => {
    const { contarConciliacao } = await carregar({
      orders: [OK, OK, contagem(1), { data: [], error: null }, contagem(3), contagem(4), contagem(5), OK],
    });

    await expect(contarConciliacao(EMPRESA)).rejects.toThrow(/contagem/);
  });
});

// ─── listarExcluidosComNumero ────────────────────────────────────────────────

const EXCLUIDO = (extra: Record<string, unknown> = {}) => ({
  order_id: '00000000-0000-0000-0000-000000000001',
  order_number: 90001,
  deleted_at: '2026-09-15T13:00:00+00:00',
  pedido_erp: 'ZZ0000001',
  ...extra,
});

describe('listarExcluidosComNumero — o que o ERP precisa cancelar do lado dele', () => {
  it('só id, número do app, número do Control e momento — da empresa, com número na cópia', async () => {
    const { listarExcluidosComNumero, fake } = await carregar({
      deleted_orders: emSequencia(OK, {
        data: [EXCLUIDO(), EXCLUIDO({ order_id: 'x2', pedido_erp: '  ' }), EXCLUIDO({ order_id: 'x3', order_number: null, pedido_erp: 'ZZ0000003' })],
        error: null,
      }),
    });

    const lista = await listarExcluidosComNumero(EMPRESA, '2026-09-01T00:00:00-03:00');

    expect(lista).toEqual([
      {
        id: '00000000-0000-0000-0000-000000000001',
        numero: 90001,
        pedido_erp: 'ZZ0000001',
        excluido_em: '2026-09-15T13:00:00+00:00',
      },
      { id: 'x3', numero: null, pedido_erp: 'ZZ0000003', excluido_em: '2026-09-15T13:00:00+00:00' },
    ]);

    const selects = fake.filtrosDe('deleted_orders', 'select').map((f) => String(f.args[0]));
    const daLista = selects.at(-1)!;
    // Nunca o snapshot inteiro (tem cliente, peças e valores) nem quem excluiu.
    expect(daLista).toBe('order_id, order_number, deleted_at, pedido_erp:snapshot->>erp_order_id');
    expect(daLista).not.toMatch(/snapshot\s*(,|$)/);
    expect(daLista).not.toContain('deleted_by');

    const filtros = fake.filtrosDe('deleted_orders').map((f) => [f.metodo, ...f.args]);
    expect(filtros).toContainEqual(['eq', 'company_id', EMPRESA]);
    expect(filtros).toContainEqual(['not', 'snapshot->>erp_order_id', 'is', null]);
    expect(filtros).toContainEqual(['gte', 'deleted_at', '2026-09-01T00:00:00-03:00']);
    expect(fake.filtrosDe('deleted_orders', 'order').map((f) => f.args)).toEqual([
      ['deleted_at', { ascending: true }],
      ['id', { ascending: true }],
    ]);
  });

  it('sem `desde`, a lista inteira (sem gte)', async () => {
    const { listarExcluidosComNumero, fake } = await carregar({
      deleted_orders: emSequencia(OK, { data: [], error: null }),
    });

    expect(await listarExcluidosComNumero(EMPRESA)).toEqual([]);
    expect(fake.filtrosDe('deleted_orders', 'gte')).toHaveLength(0);
  });

  it('passa das 1.000 linhas: página cheia e mais uma', async () => {
    const cheia = Array.from({ length: LIMITE_POSTGREST }, (_, i) => EXCLUIDO({ order_id: `x-${i}` }));
    const { listarExcluidosComNumero, fake } = await carregar({
      deleted_orders: emSequencia(OK, { data: cheia, error: null }, { data: [EXCLUIDO({ order_id: 'x-ultimo' })], error: null }),
    });

    const lista = await listarExcluidosComNumero(EMPRESA);

    expect(lista).toHaveLength(LIMITE_POSTGREST + 1);
    expect(lista.at(-1)!.id).toBe('x-ultimo');
    expect(fake.filtrosDe('deleted_orders', 'range')).toHaveLength(2);
  });

  it('sem a tabela (040 não aplicada): lista vazia, sem consultar', async () => {
    const { listarExcluidosComNumero, fake } = await carregar({
      deleted_orders: { data: null, error: { message: 'relation "deleted_orders" does not exist', code: '42P01' } },
    });

    expect(await listarExcluidosComNumero(EMPRESA)).toEqual([]);
    expect(fake.filtrosDe('deleted_orders', 'range')).toHaveLength(0);
  });

  it('sonda que falha por rede LANÇA — soluço não vira "nenhum excluído"', async () => {
    const { listarExcluidosComNumero } = await carregar({
      deleted_orders: { data: null, error: { message: 'timeout' } },
    });

    await expect(listarExcluidosComNumero(EMPRESA)).rejects.toThrow(/deleted_orders/);
  });

  it('erro numa página LANÇA', async () => {
    const { listarExcluidosComNumero } = await carregar({
      deleted_orders: emSequencia(OK, { data: null, error: { message: 'caiu' } }),
    });

    await expect(listarExcluidosComNumero(EMPRESA)).rejects.toThrow(/caiu/);
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

function requisicao(extra: { body?: unknown; query?: Record<string, unknown>; id?: string } = {}) {
  return {
    body: extra.body,
    params: { id: extra.id ?? 'o1' },
    query: extra.query ?? {},
    headers: { 'x-api-key': 'chave' },
  } as unknown as FastifyRequest<{
    Params: { id: string };
    Body: { pedido_erp?: unknown };
    Querystring: { desde?: string };
  }>;
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
  vi.doMock(SERVICO, () => ({
    getPartnerOrders: vi.fn(),
    confirmOrderImport: vi.fn(),
    conciliarPedidoErp: vi.fn(),
    contarConciliacao: vi.fn(),
    listarExcluidosComNumero: vi.fn(),
    ...servico,
  }));
  return import(CONTROLLER);
}

describe('POST /pedidos/:id/conciliar — os códigos que o programador do Fábio vê', () => {
  it('canal de pedidos fechado: 409 CANAL_FECHADO, sem chamar o serviço', async () => {
    const conciliarPedidoErp = vi.fn();
    const { partnerConciliarOrderHandler } = await carregarController({ conciliarPedidoErp }, 'manual');
    const { reply, enviado } = replyFalso();

    await partnerConciliarOrderHandler(requisicao({ body: { pedido_erp: 'ZZ0000001' } }), reply);

    expect(enviado.status).toBe(409);
    expect(enviado.corpo).toMatchObject({ code: 'CANAL_FECHADO', canal: 'pedido_erp', valor_atual: 'manual' });
    expect(conciliarPedidoErp).not.toHaveBeenCalled();
  });

  it.each([[{}], [{ pedido_erp: '  ' }], [{ pedido_erp: 1 }], [null], [[]]])(
    'corpo sem pedido_erp em texto (%j) é 400 MISSING_PEDIDO_ERP',
    async (body) => {
      const conciliarPedidoErp = vi.fn();
      const { partnerConciliarOrderHandler } = await carregarController({ conciliarPedidoErp });
      const { reply, enviado } = replyFalso();

      await partnerConciliarOrderHandler(requisicao({ body }), reply);

      expect(enviado.status).toBe(400);
      expect(enviado.corpo).toMatchObject({ code: 'MISSING_PEDIDO_ERP', statusCode: 400 });
      expect(conciliarPedidoErp).not.toHaveBeenCalled();
    },
  );

  it.each([
    [{ outcome: 'invalid_number' }, 400, { code: 'INVALID_PEDIDO_ERP' }],
    [{ outcome: 'not_found' }, 404, { code: 'ORDER_NOT_FOUND' }],
    [
      { outcome: 'conflict', pedido_erp_atual: 'ZZ0000009' },
      409,
      { code: 'ORDER_ALREADY_CONFIRMED', pedido_erp_atual: 'ZZ0000009' },
    ],
    [
      { outcome: 'not_reconcilable', situacao: 'approved' },
      409,
      {
        error: 'Só pedido enviado ao ERP sem número é conciliado; pedido aprovado usa /confirmar',
        code: 'ORDER_NOT_RECONCILABLE',
        statusCode: 409,
        situacao: 'approved',
      },
    ],
    [
      { outcome: 'number_in_use', pedido_em_uso: { id: 'o2', numero: 90002 } },
      409,
      { code: 'ERP_NUMBER_IN_USE', pedido_em_uso: { id: 'o2', numero: 90002 } },
    ],
    [{ outcome: 'ok', ja_conciliado: false }, 200, { ok: true, ja_conciliado: false }],
    [{ outcome: 'ok', ja_conciliado: true }, 200, { ok: true, ja_conciliado: true }],
    [{ outcome: 'inventado' }, 500, { code: 'INTERNAL_ERROR' }],
  ])('%j → %i', async (resultado, status, corpo) => {
    const conciliarPedidoErp = vi.fn().mockResolvedValue(resultado);
    const { partnerConciliarOrderHandler } = await carregarController({ conciliarPedidoErp });
    const { reply, enviado } = replyFalso();

    await partnerConciliarOrderHandler(requisicao({ body: { pedido_erp: ' ZZ0000001 ' } }), reply);

    expect(enviado.status).toBe(status);
    expect(enviado.corpo).toMatchObject(corpo);
    expect(conciliarPedidoErp).toHaveBeenCalledWith(EMPRESA, 'o1', 'ZZ0000001', 'control-cs');
  });
});

describe('GET /conciliacao e GET /pedidos/excluidos — sempre liberadas', () => {
  const CONTAGENS = {
    fila_aprovados_sem_numero_nao_faturados: 1,
    enviados_sem_numero_nao_faturados: 2,
    enviados_sem_numero_faturados: 3,
    aprovados_faturados_sem_numero: 4,
    enviados_com_numero_sem_faturamento: 5,
  };

  it('conciliação responde as contagens mesmo com o canal de pedidos fechado', async () => {
    const contarConciliacao = vi.fn().mockResolvedValue(CONTAGENS);
    const { partnerConciliacaoHandler } = await carregarController({ contarConciliacao }, 'manual');
    const { reply, enviado } = replyFalso();

    await partnerConciliacaoHandler(requisicao(), reply);

    expect(enviado.status).toBe(200);
    const corpo = enviado.corpo as Record<string, unknown>;
    expect(Object.keys(corpo).sort()).toEqual([...Object.keys(CONTAGENS), 'servidor_hora'].sort());
    expect(corpo).toMatchObject(CONTAGENS);
    expect(Number.isNaN(Date.parse(String(corpo['servidor_hora'])))).toBe(false);
    expect(contarConciliacao).toHaveBeenCalledWith(EMPRESA);
  });

  it('excluídos respondem com o canal fechado e passam o `desde` com fuso', async () => {
    const lista = [{ id: 'x1', numero: 90001, pedido_erp: 'ZZ0000001', excluido_em: '2026-09-15T13:00:00Z' }];
    const listarExcluidosComNumero = vi.fn().mockResolvedValue(lista);
    const { partnerExcluidosHandler } = await carregarController({ listarExcluidosComNumero }, 'manual');
    const { reply, enviado } = replyFalso();

    await partnerExcluidosHandler(requisicao({ query: { desde: '2026-09-15T00:00:00-03:00' } }), reply);

    expect(enviado.status).toBe(200);
    expect(enviado.corpo).toMatchObject({ total: 1, excluidos: lista });
    expect(listarExcluidosComNumero).toHaveBeenCalledWith(EMPRESA, '2026-09-15T00:00:00-03:00');
  });

  it('excluídos sem `desde` listam tudo', async () => {
    const listarExcluidosComNumero = vi.fn().mockResolvedValue([]);
    const { partnerExcluidosHandler } = await carregarController({ listarExcluidosComNumero });
    const { reply, enviado } = replyFalso();

    await partnerExcluidosHandler(requisicao(), reply);

    expect(enviado.status).toBe(200);
    expect(listarExcluidosComNumero).toHaveBeenCalledWith(EMPRESA, undefined);
  });

  it.each([['2026-09-15T00:00:00'], ['2026-09-15'], ['ontem'], ['2026-13-45T00:00:00Z']])(
    '`desde` sem fuso ou inválido (%s) é 400 INVALID_DESDE',
    async (desde) => {
      const listarExcluidosComNumero = vi.fn();
      const { partnerExcluidosHandler } = await carregarController({ listarExcluidosComNumero });
      const { reply, enviado } = replyFalso();

      await partnerExcluidosHandler(requisicao({ query: { desde } }), reply);

      expect(enviado.status).toBe(400);
      expect(enviado.corpo).toMatchObject({ code: 'INVALID_DESDE', statusCode: 400 });
      expect(listarExcluidosComNumero).not.toHaveBeenCalled();
    },
  );
});
