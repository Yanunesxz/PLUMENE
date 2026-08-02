import { describe, it, expect, vi, beforeEach } from 'vitest';
import { criarSupabaseFake } from './supabaseFake.js';
import { ORDER_STATUS_FLOW } from '@csb/shared';

/**
 * Triagem do representante.
 *
 * A regra que estes testes protegem: quem compra não fala com a fábrica. Pedido
 * de loja e de vitrine para no representante, e o que ele pode fazer ali é
 * mandar adiante ou recusar — aprovar continua sendo do gerente.
 */

const EMPRESA = 'empresa-1';
const REP = 'rep-1';
const OUTRO_REP = 'rep-2';
const TABELA = 'tabela-1';

async function carregarServico(respostas: Record<string, unknown>) {
  const fake = criarSupabaseFake(respostas as never);
  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
  const mod = await import('../apps/api/src/modules/orders/orders.service.js');
  return { ...mod, fake };
}

const clienteLiberado = { data: { id: 'c1', blocked: false }, error: null };
const precoOk = { data: [{ product_id: 'p1', price: 50 }], error: null };
const itemUnico = [{ product_id: 'p1', quantity: 2, unit_price: 50 }];

/**
 * Respostas da tabela `orders` na ordem em que o service consulta:
 * 1) a sondagem que descobre se as colunas de origem existem (migração 014);
 * 2) a gravação do pedido — e, daí em diante, a leitura de volta.
 */
const orders = () => [
  { data: [{ id: 'sonda' }], error: null },
  { data: { id: 'o1' }, error: null },
];

beforeEach(() => {
  vi.resetModules();
});

describe('onde o pedido nasce', () => {
  it('pedido da loja para no representante, não na fila do gerente', async () => {
    const { createOrder, fake } = await carregarServico({
      customers: clienteLiberado,
      product_prices: precoOk,
      orders: orders(),
      order_items: { data: [], error: null },
    });

    await createOrder(EMPRESA, REP, TABELA, { customer_id: 'c1', items: itemUnico }, {
      source: 'store',
      created_by: 'loja-1',
    });

    const gravado = fake.ultimaGravacao('orders', 'insert')!.valores as { status: string };
    expect(gravado.status).toBe('pending_rep');
  });

  it('pedido de vitrine também para no representante', async () => {
    const { createOrder, fake } = await carregarServico({
      customers: clienteLiberado,
      product_prices: precoOk,
      orders: orders(),
      order_items: { data: [], error: null },
    });

    await createOrder(EMPRESA, REP, TABELA, { items: itemUnico }, {
      source: 'showcase',
      guest_name: 'Loja da Ana',
      guest_whatsapp: '32999999999',
    });

    const gravado = fake.ultimaGravacao('orders', 'insert')!.valores as {
      status: string;
      customer_id: string | null;
    };
    expect(gravado.status).toBe('pending_rep');
    expect(gravado.customer_id).toBeNull();
  });

  it('pedido do próprio representante pula a triagem — ele já é o filtro', async () => {
    const { createOrder, fake } = await carregarServico({
      customers: clienteLiberado,
      product_prices: precoOk,
      orders: orders(),
      order_items: { data: [], error: null },
    });

    await createOrder(EMPRESA, REP, TABELA, { customer_id: 'c1', submit: true, items: itemUnico });

    const gravado = fake.ultimaGravacao('orders', 'insert')!.valores as { status: string };
    expect(gravado.status).toBe('pending_approval');
  });
});

describe('banco ainda sem a migração 015', () => {
  it('cai para a fila do gerente em vez de a compra falhar — e não insiste', async () => {
    const recusaDoCheck = {
      data: null,
      error: { code: '23514', message: 'violates check constraint "chk_orders_status"' },
    };

    const { createOrder, fake } = await carregarServico({
      customers: clienteLiberado,
      product_prices: precoOk,
      // O dublê avança a fila duas vezes por consulta concluída (uma ao montar a
      // query, outra ao entregar o resultado), então cada resposta que importa
      // vem depois de uma de folga.
      orders: [
        { data: [{ id: 'sonda' }], error: null }, // sondagem das colunas de origem
        { data: null, error: null }, // folga
        recusaDoCheck, // a gravação com `pending_rep` esbarra no CHECK antigo
        { data: { id: 'o1' }, error: null }, // a regravação, já em `pending_approval`
      ],
      order_items: { data: [], error: null },
    });

    await createOrder(EMPRESA, REP, TABELA, { customer_id: 'c1', items: itemUnico }, {
      source: 'store',
      created_by: 'loja-1',
    });

    const primeiraRodada = fake.gravacoes.filter((g) => g.tabela === 'orders' && g.operacao === 'insert');
    expect((primeiraRodada.at(-1)!.valores as { status: string }).status).toBe('pending_approval');

    // Segunda compra: já sabe que o banco não aceita a triagem e vai direto.
    await createOrder(EMPRESA, REP, TABELA, { customer_id: 'c1', items: itemUnico }, {
      source: 'store',
      created_by: 'loja-1',
    });

    const todas = fake.gravacoes.filter((g) => g.tabela === 'orders' && g.operacao === 'insert');
    expect(todas.length - primeiraRodada.length).toBe(1);
  });
});

describe('quem pode decidir o quê', () => {
  const emTriagem = { data: { status: 'pending_rep', rep_id: REP }, error: null };
  const naFilaDoGerente = { data: { status: 'pending_approval', rep_id: REP }, error: null };
  const depois = { data: { id: 'o1' }, error: null };

  it('o representante manda o pedido da loja para a fábrica', async () => {
    const { updateOrderStatus, fake } = await carregarServico({ orders: [emTriagem, depois] });

    await updateOrderStatus('o1', EMPRESA, REP, { status: 'pending_approval' }, 'rep');

    const alterado = fake.ultimaGravacao('orders', 'update')!.valores as { status: string };
    expect(alterado.status).toBe('pending_approval');
  });

  it('o representante recusa o que está na triagem dele', async () => {
    const { updateOrderStatus, fake } = await carregarServico({ orders: [emTriagem, depois] });

    await updateOrderStatus('o1', EMPRESA, REP, { status: 'rejected' }, 'rep');

    const alterado = fake.ultimaGravacao('orders', 'update')!.valores as { status: string };
    expect(alterado.status).toBe('rejected');
  });

  it('o representante NÃO aprova — a palavra final é do gerente', async () => {
    const { updateOrderStatus } = await carregarServico({ orders: [emTriagem, depois] });

    await expect(
      updateOrderStatus('o1', EMPRESA, REP, { status: 'approved' }, 'rep'),
    ).rejects.toThrow('FORBIDDEN_ROLE');
  });

  it('o representante não derruba pedido que o gerente já tem na mesa', async () => {
    const { updateOrderStatus } = await carregarServico({ orders: [naFilaDoGerente, depois] });

    await expect(
      updateOrderStatus('o1', EMPRESA, REP, { status: 'rejected' }, 'rep'),
    ).rejects.toThrow('FORBIDDEN_ROLE');
  });

  it('o representante não tria pedido de outro representante', async () => {
    const { updateOrderStatus } = await carregarServico({
      orders: [{ data: { status: 'pending_rep', rep_id: OUTRO_REP }, error: null }, depois],
    });

    await expect(
      updateOrderStatus('o1', EMPRESA, REP, { status: 'pending_approval' }, 'rep'),
    ).rejects.toThrow('FORBIDDEN_NOT_OWNER');
  });

  it('o gerente aprova o que passou pela triagem', async () => {
    const { updateOrderStatus, fake } = await carregarServico({ orders: [naFilaDoGerente, depois] });

    await updateOrderStatus('o1', EMPRESA, 'ger-1', { status: 'approved' }, 'manager');

    const alterado = fake.ultimaGravacao('orders', 'update')!.valores as {
      status: string;
      approved_by: string;
    };
    expect(alterado.status).toBe('approved');
    expect(alterado.approved_by).toBe('ger-1');
  });

  it('o gerente destrava o pedido quando o representante some', async () => {
    const { updateOrderStatus, fake } = await carregarServico({ orders: [emTriagem, depois] });

    await updateOrderStatus('o1', EMPRESA, 'ger-1', { status: 'pending_approval' }, 'manager');

    const alterado = fake.ultimaGravacao('orders', 'update')!.valores as { status: string };
    expect(alterado.status).toBe('pending_approval');
  });

  it('não dá para aprovar direto da triagem, pulando o gerente', async () => {
    const { updateOrderStatus } = await carregarServico({ orders: [emTriagem, depois] });

    await expect(
      updateOrderStatus('o1', EMPRESA, 'ger-1', { status: 'approved' }, 'manager'),
    ).rejects.toThrow('INVALID_STATUS_TRANSITION');
  });
});

describe('fluxo declarado', () => {
  it('da triagem só saem dois caminhos: fábrica ou recusa', () => {
    expect(ORDER_STATUS_FLOW.pending_rep).toEqual(['pending_approval', 'rejected']);
  });

  it('a triagem não é destino de ninguém — só nascimento', () => {
    const destinos = Object.values(ORDER_STATUS_FLOW).flat();
    expect(destinos).not.toContain('pending_rep');
  });
});
