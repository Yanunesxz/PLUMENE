import { describe, it, expect, vi, beforeEach } from 'vitest';
import { criarSupabaseFake } from './supabaseFake.js';
import { ORDER_STATUS_FLOW } from '@csb/shared';

const EMPRESA = 'empresa-1';
const REP = 'rep-1';
const TABELA = 'tabela-1';

async function carregarServico(respostas: Record<string, unknown>) {
  const fake = criarSupabaseFake(respostas as never);
  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
  const mod = await import('../apps/api/src/modules/orders/orders.service.js');
  return { ...mod, fake };
}

const clienteLiberado = { data: { id: 'c1', blocked: false }, error: null };
const pedidoCriado = { data: { id: 'o1' }, error: null };
const pedidoLido = { data: { id: 'o1', items: [] }, error: null };

beforeEach(() => {
  vi.resetModules();
});

describe('criação de pedido', () => {
  it('entra na fila de aprovação quando o rep envia (submit)', async () => {
    const { createOrder, fake } = await carregarServico({
      customers: clienteLiberado,
      product_prices: { data: [{ product_id: 'p1', price: 50 }], error: null },
      orders: [pedidoCriado, pedidoLido],
      order_items: { data: [], error: null },
    });

    await createOrder(EMPRESA, REP, TABELA, {
      customer_id: 'c1',
      submit: true,
      items: [{ product_id: 'p1', quantity: 2, unit_price: 50 }],
    });

    const insercao = fake.ultimaGravacao('orders', 'insert')!.valores as { status: string };
    expect(insercao.status).toBe('pending_approval');
  });

  it('fica em rascunho quando submit não vem', async () => {
    const { createOrder, fake } = await carregarServico({
      customers: clienteLiberado,
      product_prices: { data: [{ product_id: 'p1', price: 50 }], error: null },
      orders: [pedidoCriado, pedidoLido],
      order_items: { data: [], error: null },
    });

    await createOrder(EMPRESA, REP, TABELA, {
      customer_id: 'c1',
      items: [{ product_id: 'p1', quantity: 2, unit_price: 50 }],
    });

    const insercao = fake.ultimaGravacao('orders', 'insert')!.valores as { status: string };
    expect(insercao.status).toBe('draft');
  });

  it('ignora o preço mandado pelo cliente e usa a tabela do representante', async () => {
    const { createOrder, fake } = await carregarServico({
      customers: clienteLiberado,
      product_prices: { data: [{ product_id: 'p1', price: 50 }], error: null },
      orders: [pedidoCriado, pedidoLido],
      order_items: { data: [], error: null },
    });

    // Cliente tenta comprar a R$ 1,00 o que custa R$ 50,00.
    await createOrder(EMPRESA, REP, TABELA, {
      customer_id: 'c1',
      items: [{ product_id: 'p1', quantity: 3, unit_price: 1 }],
    });

    const pedido = fake.ultimaGravacao('orders', 'insert')!.valores as { total: number };
    expect(pedido.total).toBe(150);

    const itens = fake.ultimaGravacao('order_items', 'insert')!.valores as Array<{
      unit_price: number;
      total: number;
    }>;
    expect(itens[0]!.unit_price).toBe(50);
    expect(itens[0]!.total).toBe(150);
  });

  it('cliente bloqueado no Control NÃO trava o pedido (decisão 8 de 16/09/2026) — segue para o preço', async () => {
    const { createOrder } = await carregarServico({
      customers: { data: { id: 'c1', blocked: true, price_table_id: null }, error: null },
      product_prices: { data: [], error: null },
    });

    // Passou do cliente: o que barra aqui é o item sem preço, não o bloqueio.
    await expect(
      createOrder(EMPRESA, REP, TABELA, {
        customer_id: 'c1',
        items: [{ product_id: 'p1', quantity: 1, unit_price: 50 }],
      }),
    ).rejects.toThrow('PRICE_NOT_FOUND');
  });

  it('recusa item sem preço na tabela do representante', async () => {
    const { createOrder } = await carregarServico({
      customers: clienteLiberado,
      product_prices: { data: [], error: null },
      orders: [pedidoCriado, pedidoLido],
      order_items: { data: [], error: null },
    });

    await expect(
      createOrder(EMPRESA, REP, TABELA, {
        customer_id: 'c1',
        items: [{ product_id: 'sem-preco', quantity: 1, unit_price: 10 }],
      }),
    ).rejects.toThrow('PRICE_NOT_FOUND');
  });

  it('não deixa pedido órfão quando a gravação dos itens falha', async () => {
    const { createOrder, fake } = await carregarServico({
      customers: clienteLiberado,
      product_prices: { data: [{ product_id: 'p1', price: 50 }], error: null },
      orders: [pedidoCriado, pedidoLido],
      order_items: { data: null, error: { message: 'falhou' } },
    });

    const resultado = await createOrder(EMPRESA, REP, TABELA, {
      customer_id: 'c1',
      items: [{ product_id: 'p1', quantity: 1, unit_price: 50 }],
    });

    expect(resultado).toBeNull();
    expect(fake.ultimaGravacao('orders', 'delete')).toBeDefined();
  });
});

describe('transições de status', () => {
  it('rascunho vai para a fila — ou direto a aprovado, que é a VENDA INTERNA', () => {
    // O `approved` direto do rascunho existe para a venda interna (031): o
    // balcão não pede licença à fábrica. Quem NÃO é venda interna continua
    // barrado pelo portão de papel no updateOrderStatus — o mapa diz o que é
    // possível, o portão diz quem pode.
    expect(ORDER_STATUS_FLOW.draft).toEqual(['pending_approval', 'approved']);
  });

  it('aguardando aprovação vira aprovado ou recusado', () => {
    expect(ORDER_STATUS_FLOW.pending_approval).toEqual(['approved', 'rejected']);
  });

  it('recusado e enviado ao ERP são estados finais', () => {
    expect(ORDER_STATUS_FLOW.rejected).toEqual([]);
    expect(ORDER_STATUS_FLOW.sent_erp).toEqual([]);
  });

  it('nenhum estado permite voltar para rascunho', () => {
    const destinos = Object.values(ORDER_STATUS_FLOW).flat();
    expect(destinos).not.toContain('draft');
  });
});

/**
 * O gerente saiu do caminho do pedido (Yan, 02/09/2026): "nenhum pedido precisa
 * passar por ele — todos chegam direto no financeiro". Ele vê e organiza tudo,
 * mas a decisão da fila (aprovar/recusar) é do financeiro; o admin é válvula.
 */
describe('quem decide o pedido na fila', () => {
  const naFila = { data: { status: 'pending_approval', rep_id: REP }, error: null };
  const decidido = { data: { id: 'o1', status: 'approved', rep_id: REP }, error: null };

  it('o gerente NÃO aprova nem recusa o que está na fila', async () => {
    const { updateOrderStatus } = await carregarServico({ orders: [naFila] });
    await expect(
      updateOrderStatus('o1', EMPRESA, 'ger-1', { status: 'approved', notes: '' }, 'manager'),
    ).rejects.toThrow('FORBIDDEN_ROLE');
    await expect(
      updateOrderStatus('o1', EMPRESA, 'ger-1', { status: 'rejected', notes: '' }, 'manager'),
    ).rejects.toThrow('FORBIDDEN_ROLE');
  });

  it('o financeiro aprova — é a mesa dele', async () => {
    const { updateOrderStatus } = await carregarServico({ orders: [naFila, decidido] });
    const r = await updateOrderStatus('o1', EMPRESA, 'fin-1', { status: 'approved', notes: '' }, 'financeiro');
    expect(r?.status).toBe('approved');
  });

  // "Os pedidos só vão ser incluídos pela Larissa" (Yan, 10/09/2026) — e ao
  // lançar ela digita o número que o Control deu ("duas letras e a numeração").
  const aprovado = { data: { status: 'approved', rep_id: REP }, error: null };
  const lancado = { data: { id: 'o1', status: 'sent_erp', rep_id: REP, erp_order_id: 'CS17379' }, error: null };
  const ninguem = { data: [], error: null };

  it('o gerente não inclui pedido no Control', async () => {
    const { updateOrderStatus } = await carregarServico({ orders: [aprovado] });
    await expect(
      updateOrderStatus('o1', EMPRESA, 'ger-1', { status: 'sent_erp', notes: '', erp_order_id: 'CS17379' }, 'manager'),
    ).rejects.toThrow('FORBIDDEN_ROLE');
  });

  it('o financeiro lança COM o número do Control, que fica gravado', async () => {
    // O fake pré-busca a resposta seguinte a cada consulta terminada — por isso
    // as respostas vão em pares; a última fica "grudada" para o update.
    const { updateOrderStatus, fake } = await carregarServico({
      orders: [aprovado, aprovado, ninguem, ninguem, lancado],
    });
    const r = await updateOrderStatus('o1', EMPRESA, 'fin-1', { status: 'sent_erp', notes: '', erp_order_id: 'cs 17379' }, 'financeiro');
    expect(r?.status).toBe('sent_erp');
    const gravado = fake.ultimaGravacao('orders', 'update')?.valores as Record<string, unknown>;
    expect(gravado.erp_order_id).toBe('CS17379');
    expect(gravado.synced_at).toBeTruthy();
  });

  it('sem o número do Control não lança — o app nunca inventa esse número', async () => {
    const { updateOrderStatus } = await carregarServico({ orders: [aprovado] });
    await expect(
      updateOrderStatus('o1', EMPRESA, 'fin-1', { status: 'sent_erp', notes: '' }, 'financeiro'),
    ).rejects.toThrow('ERP_NUMBER_REQUIRED');
  });

  it('número do Control que já é de outro pedido é recusado', async () => {
    const { updateOrderStatus } = await carregarServico({
      orders: [aprovado, aprovado, { data: [{ id: 'o2' }], error: null }],
    });
    await expect(
      updateOrderStatus('o1', EMPRESA, 'fin-1', { status: 'sent_erp', notes: '', erp_order_id: 'CS17379' }, 'financeiro'),
    ).rejects.toThrow('ERP_NUMBER_IN_USE');
  });

  it('o gerente ainda TRIA o pedido de quem sumiu (pending_rep → fila)', async () => {
    // Organizar continua com ele; só a decisão final saiu.
    const triagem = { data: { status: 'pending_rep', rep_id: REP }, error: null };
    const mandado = { data: { id: 'o1', status: 'pending_approval', rep_id: REP }, error: null };
    const { updateOrderStatus } = await carregarServico({ orders: [triagem, mandado] });
    const r = await updateOrderStatus('o1', EMPRESA, 'ger-1', { status: 'pending_approval', notes: '' }, 'manager');
    expect(r?.status).toBe('pending_approval');
  });
});
