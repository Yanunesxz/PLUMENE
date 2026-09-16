import { describe, it, expect, vi, beforeEach } from 'vitest';
import { criarSupabaseFake } from './supabaseFake.js';

/**
 * O representante escolhendo a tabela — cliente e link temporário.
 *
 * Cobertura pelo risco, não por porcentagem. O que estas asserções protegem é
 * o que custa dinheiro ou vaza informação comercial:
 *
 *  • pedir tabela que não é do conjunto dele não pode passar, porque a tela
 *    não é a proteção — quem chama a API por fora ignora a tela inteira;
 *  • ter duas tabelas e não escolher não pode virar "usa a principal": esse
 *    silêncio é exatamente o erro caro que o recurso existe para impedir;
 *  • reprecificar cliente de outra carteira não pode passar nem com a tabela
 *    certa — são duas travas, não uma.
 */

const EMPRESA = 'empresa-1';
const REP = 'rep-1';

const TABELAS = [
  { id: 't1', name: 'TABELA 01 - 2027', company_id: EMPRESA },
  { id: 't2', name: 'TABELA 02 - 2027', company_id: EMPRESA },
  { id: 't3', name: 'TABELA 03 - 2027', company_id: EMPRESA },
];

/** Monta o service com o conjunto do rep já semeado. */
async function comConjunto(ids: string[]) {
  const fake = criarSupabaseFake({
    price_tables: { data: TABELAS, error: null },
    rep_price_tables: {
      data: ids.map((price_table_id) => ({ user_id: REP, price_table_id })),
      error: null,
    },
    users: { data: { price_table_id: ids[0] ?? null }, error: null },
  } as never);
  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
  const mod = await import('../apps/api/src/modules/reps/reps.service.js');
  return { ...mod, fake };
}

beforeEach(() => {
  vi.resetModules();
});

describe('o que o representante enxerga', () => {
  it('com uma tabela, recebe exatamente uma — e não descobre as outras duas', async () => {
    const { listRepPriceTables } = await comConjunto(['t2']);

    const minhas = await listRepPriceTables(EMPRESA, REP);

    expect(minhas.map((t) => t.id)).toEqual(['t2']);
  });

  it('com três tabelas, recebe as três', async () => {
    const { listRepPriceTables } = await comConjunto(['t1', 't2', 't3']);

    const minhas = await listRepPriceTables(EMPRESA, REP);

    expect(minhas.map((t) => t.id).sort()).toEqual(['t1', 't2', 't3']);
  });
});

describe('resolver a tabela escolhida', () => {
  it('rep com uma tabela não precisa escolher: usa a dele', async () => {
    const { resolverTabelaEscolhida } = await comConjunto(['t2']);

    expect(await resolverTabelaEscolhida(EMPRESA, REP, 'rep', undefined)).toEqual({
      ok: true,
      price_table_id: 't2',
    });
  });

  it('rep com duas tabelas que não escolhe é barrado — o servidor não arbitra', async () => {
    const { resolverTabelaEscolhida } = await comConjunto(['t1', 't2']);

    expect(await resolverTabelaEscolhida(EMPRESA, REP, 'rep', undefined)).toEqual({
      ok: false,
      motivo: 'escolha_obrigatoria',
    });
  });

  it('rep escolhendo dentro do conjunto passa', async () => {
    const { resolverTabelaEscolhida } = await comConjunto(['t1', 't2']);

    expect(await resolverTabelaEscolhida(EMPRESA, REP, 'rep', 't2')).toEqual({
      ok: true,
      price_table_id: 't2',
    });
  });

  it('rep pedindo tabela de fora do conjunto é barrado, mesmo ela existindo na empresa', async () => {
    const { resolverTabelaEscolhida } = await comConjunto(['t1', 't2']);

    expect(await resolverTabelaEscolhida(EMPRESA, REP, 'rep', 't3')).toEqual({
      ok: false,
      motivo: 'fora_do_conjunto',
    });
  });

  it('rep com uma tabela pedindo outra é barrado', async () => {
    const { resolverTabelaEscolhida } = await comConjunto(['t2']);

    expect(await resolverTabelaEscolhida(EMPRESA, REP, 'rep', 't1')).toEqual({
      ok: false,
      motivo: 'fora_do_conjunto',
    });
  });

  it('gerente atribui qualquer tabela da empresa — é ele quem define os conjuntos', async () => {
    const { resolverTabelaEscolhida } = await comConjunto([]);

    expect(await resolverTabelaEscolhida(EMPRESA, 'ger-1', 'manager', 't3')).toEqual({
      ok: true,
      price_table_id: 't3',
    });
  });
});

describe('repPodeUsarTabela', () => {
  it('libera o catálogo na tabela do conjunto — é o preço que o rep vai ver montando o pedido', async () => {
    const { repPodeUsarTabela } = await comConjunto(['t1', 't2']);

    expect(await repPodeUsarTabela(EMPRESA, REP, 't2')).toBe(true);
  });

  it('recusa o catálogo na tabela da região vizinha', async () => {
    const { repPodeUsarTabela } = await comConjunto(['t1', 't2']);

    expect(await repPodeUsarTabela(EMPRESA, REP, 't3')).toBe(false);
  });
});

// ─── Trocar a tabela de um cliente ───────────────────────────────────────────

async function carregarClientes(respostas: Record<string, unknown>) {
  const fake = criarSupabaseFake(respostas as never);
  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
  const mod = await import('../apps/api/src/modules/customers/customers.service.js');
  return { ...mod, fake };
}

describe('trocar a tabela de um cliente', () => {
  const achou = { data: { id: 'c1' }, error: null };
  const gravou = { data: { id: 'c1', name: 'WORKMARKER', price_table_id: 't3' }, error: null };

  it('grava a tabela nova quando o cliente é da carteira', async () => {
    const { atualizarTabelaDoCliente, fake } = await carregarClientes({
      customers: [achou, gravou],
    });

    const r = await atualizarTabelaDoCliente(EMPRESA, 'c1', 't3', { rep_id: REP });

    expect(r.ok).toBe(true);
    // `updated_at` junto: é por ele que o CRM descobre que o cadastro mudou.
    expect(fake.ultimaGravacao('customers', 'update')!.valores).toEqual({
      price_table_id: 't3',
      updated_at: expect.any(String),
    });
  });

  it('a mesma tabela de novo não grava nada — nem o updated_at', async () => {
    const { atualizarTabelaDoCliente, fake } = await carregarClientes({
      customers: { data: { id: 'c1', name: 'Cliente Teste', price_table_id: 't3' }, error: null },
    });

    const r = await atualizarTabelaDoCliente(EMPRESA, 'c1', 't3', { rep_id: REP });

    expect(r.ok).toBe(true);
    expect(fake.ultimaGravacao('customers', 'update')).toBeUndefined();
  });

  it('procura o cliente nas DUAS metades da carteira — app e ERP', async () => {
    const { atualizarTabelaDoCliente, fake } = await carregarClientes({
      customers: [achou, gravou],
    });

    await atualizarTabelaDoCliente(EMPRESA, 'c1', 't3', { rep_id: REP, erp_rep_id: '04518' });

    expect(fake.filtrosDe('customers', 'or')[0]!.args[0]).toBe(
      'rep_id.eq.rep-1,rep_erp_id.eq.04518',
    );
  });

  it('cliente de outra carteira não é reprecificado, e nada é gravado', async () => {
    const { atualizarTabelaDoCliente, fake } = await carregarClientes({
      customers: [{ data: null, error: null }],
    });

    const r = await atualizarTabelaDoCliente(EMPRESA, 'c9', 't3', { rep_id: REP });

    expect(r).toEqual({ ok: false, motivo: 'cliente_nao_encontrado' });
    expect(fake.ultimaGravacao('customers', 'update')).toBeUndefined();
  });

  it('gerente passa por qualquer cliente da empresa, sem filtro de dono', async () => {
    const { atualizarTabelaDoCliente, fake } = await carregarClientes({
      customers: [achou, gravou],
    });

    await atualizarTabelaDoCliente(EMPRESA, 'c1', 't3', { rep_id: 'ger-1', irrestrito: true });

    expect(fake.filtrosDe('customers', 'or')).toHaveLength(0);
    const eqs = fake.filtrosDe('customers', 'eq').map((f) => f.args[0]);
    expect(eqs).not.toContain('rep_id');
  });

  it('sempre restringe pela empresa do token', async () => {
    const { atualizarTabelaDoCliente, fake } = await carregarClientes({
      customers: [achou, gravou],
    });

    await atualizarTabelaDoCliente(EMPRESA, 'c1', 't3', { rep_id: REP });

    const eqs = fake.filtrosDe('customers', 'eq').map((f) => f.args);
    expect(eqs).toContainEqual(['company_id', EMPRESA]);
  });
});

// ─── A ficha do cliente ──────────────────────────────────────────────────────

describe('ficha do cliente', () => {
  const cadastro = {
    id: 'c1',
    name: 'WORKMARKER',
    trade_name: 'Workmarker',
    cnpj: '14526776629',
    whatsapp: '32988546656',
    email: null,
    address: null,
    credit_limit: 5000,
    blocked: false,
    block_reason: null,
    price_table_id: 't2',
  };

  it('devolve cadastro, tabela e histórico do mais recente para o mais antigo', async () => {
    const { obterCliente } = await carregarClientes({
      customers: { data: cadastro, error: null },
      orders: {
        data: [
          { id: 'o2', order_number: 14535, status: 'approved', total: 800, created_at: '2026-08-01' },
          { id: 'o1', order_number: 14530, status: 'approved', total: 1200, created_at: '2026-07-02' },
        ],
        error: null,
      },
    });

    const ficha = await obterCliente(EMPRESA, 'c1', { rep_id: REP });

    expect(ficha!.price_table_id).toBe('t2');
    expect(ficha!.pedidos.map((p) => p.id)).toEqual(['o2', 'o1']);
  });

  it('pedido sem total vira zero em vez de nulo na tela', async () => {
    const { obterCliente } = await carregarClientes({
      customers: { data: cadastro, error: null },
      orders: {
        data: [{ id: 'o1', order_number: null, status: 'draft', total: null, created_at: '2026-08-01' }],
        error: null,
      },
    });

    const ficha = await obterCliente(EMPRESA, 'c1', { rep_id: REP });

    expect(ficha!.pedidos[0]!.total).toBe(0);
  });

  it('cliente de outra carteira não abre — e nem os pedidos dele são consultados', async () => {
    const { obterCliente, fake } = await carregarClientes({
      customers: { data: null, error: null },
      orders: { data: [{ id: 'o1' }], error: null },
    });

    expect(await obterCliente(EMPRESA, 'c9', { rep_id: REP })).toBeNull();
    expect(fake.filtrosDe('orders')).toHaveLength(0);
  });

  it('procura o cliente nas duas metades da carteira', async () => {
    const { obterCliente, fake } = await carregarClientes({
      customers: { data: cadastro, error: null },
      orders: { data: [], error: null },
    });

    await obterCliente(EMPRESA, 'c1', { rep_id: REP, erp_rep_id: '04518' });

    expect(fake.filtrosDe('customers', 'or')[0]!.args[0]).toBe(
      'rep_id.eq.rep-1,rep_erp_id.eq.04518',
    );
  });
});

// ─── Cadastro com a tabela escolhida ─────────────────────────────────────────

describe('cadastro de cliente', () => {
  it('grava a tabela que o representante escolheu', async () => {
    const { createCustomer, fake } = await carregarClientes({
      customers: { data: { id: 'c2', name: 'LOJA NOVA', price_table_id: 't3' }, error: null },
    });

    await createCustomer(EMPRESA, REP, { name: 'LOJA NOVA' }, 't3');

    const inserido = fake.ultimaGravacao('customers', 'insert')!.valores as {
      price_table_id: string | null;
    };
    expect(inserido.price_table_id).toBe('t3');
  });
});
