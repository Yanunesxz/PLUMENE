import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { criarSupabaseFake, type RespostaTabela } from './supabaseFake.js';

/**
 * Pedido para um cliente que o admin excluiu juntando em outro cadastro (050).
 *
 * O aparelho do representante guarda o cliente no cache e só o do admin apaga o
 * excluído; a loja cujo login foi herdado carrega o cliente antigo no token por
 * até 1h. O que estes testes trancam:
 *   • o pedido para o cliente excluído E juntado entra no cadastro que ficou
 *     (seguindo `deleted_customers.juntado_em`, em cadeia e com limite), com a
 *     tabela dele — online e pela fila offline;
 *   • excluído sem junção, sem a 050 ou em ciclo: "cliente não encontrado",
 *     como antes, sem gravar pedido;
 *   • a fila offline não conta como sincronizado o pedido que não nasceu: ele
 *     volta em `failed` e fica no aparelho (antes sumia sem existir no servidor).
 *
 * Ids fictícios.
 */

const EMPRESA = 'empresa-ficticia-1';
const REP = 'rep-ficticio';
const TABELA_DO_REP = 'tabela-do-rep';
const SAI = 'cliente-que-saiu';
const MEIO = 'cliente-do-meio';
const FICA = 'cliente-que-ficou';
const SUPABASE = '../apps/api/src/config/supabase.js';

const ok = (data: unknown = null): RespostaTabela => ({ data, error: null });
const NAO_EXISTE: RespostaTabela = {
  data: null,
  error: { message: 'relation "public.deleted_customers" does not exist', code: '42P01' },
};

/** O dublê adianta uma resposta a cada consulta: dobrar faz a i-ésima consulta receber a i-ésima resposta. */
function emOrdem(...respostas: RespostaTabela[]): RespostaTabela[] {
  const fila: RespostaTabela[] = [];
  respostas.forEach((r, i) => {
    fila.push(r);
    if (i < respostas.length - 1) fila.push(r);
  });
  return fila;
}

/** O resto do pedido, igual ao de tests/pedidos.test.ts: preço do p1 e a gravação. */
const RESTO = {
  product_prices: ok([{ product_id: 'p1', price: 50 }]),
  orders: [ok({ id: 'o1' }), ok({ id: 'o1', items: [] })],
  order_items: ok([]),
};

async function carregar(respostas: Record<string, RespostaTabela | RespostaTabela[]>) {
  const fake = criarSupabaseFake({ ...RESTO, ...respostas } as never);
  vi.doMock(SUPABASE, () => ({ supabase: fake.cliente }));
  const pedidos = await import('../apps/api/src/modules/orders/orders.service.js');
  const sync = await import('../apps/api/src/modules/sync/sync.service.js');
  return { ...pedidos, ...sync, fake };
}

const ITENS = [{ product_id: 'p1', quantity: 2, unit_price: 50 }];

function clienteGravado(fake: ReturnType<typeof criarSupabaseFake>): unknown {
  return (fake.ultimaGravacao('orders', 'insert')?.valores as { customer_id?: unknown } | undefined)?.customer_id;
}

beforeEach(() => {
  vi.resetModules();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.doUnmock(SUPABASE);
  vi.restoreAllMocks();
});

describe('pedido para cliente excluído e juntado em outro cadastro', () => {
  it('entra no cadastro que ficou, na tabela dele, e o log diz de onde veio (só ids)', async () => {
    const { createOrder, fake } = await carregar({
      customers: emOrdem(ok(null), ok({ id: FICA, price_table_id: 'tabela-do-que-ficou' })),
      deleted_customers: emOrdem(ok([]), ok({ juntado_em: FICA })),
    });

    const pedido = await createOrder(EMPRESA, REP, TABELA_DO_REP, { customer_id: SAI, items: ITENS });

    expect(pedido).not.toBeNull();
    expect(clienteGravado(fake)).toBe(FICA);
    // O preço é o da tabela do cadastro que ficou.
    expect(fake.filtrosDe('product_prices', 'eq').map((f) => f.args)).toContainEqual([
      'price_table_id',
      'tabela-do-que-ficou',
    ]);
    // A cópia é procurada na empresa do token, pelo id que saiu, só com junção.
    const eqs = fake.filtrosDe('deleted_customers', 'eq').map((f) => f.args);
    expect(eqs).toContainEqual(['company_id', EMPRESA]);
    expect(eqs).toContainEqual(['customer_id', SAI]);
    expect(fake.filtrosDe('deleted_customers', 'not').map((f) => f.args)).toContainEqual(['juntado_em', 'is', null]);
    // E os clientes, também na empresa do token.
    expect(
      fake
        .filtrosDe('customers', 'eq')
        .filter((f) => f.args[0] === 'company_id')
        .every((f) => f.args[1] === EMPRESA),
    ).toBe(true);
    const aviso = vi.mocked(console.warn).mock.calls.map((c) => String(c[0])).join('\n');
    expect(aviso).toContain(SAI);
    expect(aviso).toContain(FICA);
  });

  it('segue a cadeia: o que ficou também foi juntado depois', async () => {
    const { createOrder, fake } = await carregar({
      customers: emOrdem(ok(null), ok(null), ok({ id: FICA, price_table_id: null })),
      deleted_customers: emOrdem(ok([]), ok({ juntado_em: MEIO }), ok({ juntado_em: FICA })),
    });

    expect(await createOrder(EMPRESA, REP, TABELA_DO_REP, { customer_id: SAI, items: ITENS })).not.toBeNull();
    expect(clienteGravado(fake)).toBe(FICA);
    expect(
      fake
        .filtrosDe('deleted_customers', 'eq')
        .filter((f) => f.args[0] === 'customer_id')
        .map((f) => f.args[1]),
    ).toEqual([SAI, MEIO]);
  });

  it('cliente que existe não consulta deleted_customers', async () => {
    const { createOrder, fake } = await carregar({
      customers: ok({ id: SAI, price_table_id: null }),
      deleted_customers: NAO_EXISTE,
    });

    expect(await createOrder(EMPRESA, REP, TABELA_DO_REP, { customer_id: SAI, items: ITENS })).not.toBeNull();
    expect(clienteGravado(fake)).toBe(SAI);
    expect(fake.filtrosDe('deleted_customers')).toHaveLength(0);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it.each([
    ['excluído sem junção (nenhuma cópia com juntado_em)', { deleted_customers: emOrdem(ok([]), ok(null)) }],
    ['sem a 050 (deleted_customers não existe)', { deleted_customers: NAO_EXISTE }],
    ['a cópia não responde', { deleted_customers: emOrdem(ok([]), { data: null, error: { message: 'timeout' } }) }],
    ['ciclo (A juntado em B, B juntado em A)', { deleted_customers: emOrdem(ok([]), ok({ juntado_em: MEIO }), ok({ juntado_em: SAI })) }],
  ])('%s: não encontrado, como antes — nenhum pedido gravado', async (_nome, extra) => {
    const { createOrder, fake } = await carregar({ customers: ok(null), ...extra });

    expect(await createOrder(EMPRESA, REP, TABELA_DO_REP, { customer_id: SAI, items: ITENS })).toBeNull();
    expect(fake.ultimaGravacao('orders', 'insert')).toBeUndefined();
  });

  it('a cadeia tem limite: não segue para sempre', async () => {
    const saltos = Array.from({ length: 12 }, (_, i) => ok({ juntado_em: `cliente-${i + 1}` }));
    const { createOrder, fake } = await carregar({
      customers: ok(null),
      deleted_customers: emOrdem(ok([]), ...saltos),
    });

    expect(await createOrder(EMPRESA, REP, TABELA_DO_REP, { customer_id: SAI, items: ITENS })).toBeNull();
    expect(fake.filtrosDe('customers', 'select').length).toBeLessThanOrEqual(6);
    expect(fake.ultimaGravacao('orders', 'insert')).toBeUndefined();
  });
});

describe('a fila offline com o cliente excluído', () => {
  const offline = (local_id: string) => ({
    local_id,
    customer_id: SAI,
    items: ITENS,
    created_at: '2026-09-16T12:00:00.000Z',
    updated_at: '2026-09-16T12:00:00.000Z',
  });

  it('juntado: sincroniza no cadastro que ficou', async () => {
    const { processSyncQueue, fake } = await carregar({
      customers: emOrdem(ok(null), ok({ id: FICA, price_table_id: null })),
      deleted_customers: emOrdem(ok([]), ok({ juntado_em: FICA })),
      orders: [ok(null), ok({ id: 'o1' }), ok({ id: 'o1', items: [] })],
    });

    const r = await processSyncQueue(EMPRESA, REP, TABELA_DO_REP, [offline('local-ficticio-1')]);

    expect(r).toEqual({ synced: 1, failed: [] });
    expect(clienteGravado(fake)).toBe(FICA);
  });

  it('sem cadastro para onde ir: volta em failed e fica no aparelho — nunca conta como sincronizado', async () => {
    const { processSyncQueue, fake } = await carregar({
      customers: ok(null),
      deleted_customers: emOrdem(ok([]), ok(null)),
      orders: ok(null),
    });

    const r = await processSyncQueue(EMPRESA, REP, TABELA_DO_REP, [offline('local-ficticio-2')]);

    expect(r).toEqual({ synced: 0, failed: [{ local_id: 'local-ficticio-2', error: 'CREATE_FAILED' }] });
    expect(fake.ultimaGravacao('orders', 'insert')).toBeUndefined();
  });
});
