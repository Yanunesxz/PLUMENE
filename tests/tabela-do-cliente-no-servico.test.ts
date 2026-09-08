import { describe, it, expect, vi, beforeEach } from 'vitest';
import { criarSupabaseFake } from './supabaseFake.js';

/**
 * A tabela do pedido é a do CADASTRO do cliente — decidida em createOrder,
 * o único lugar por onde todo pedido passa.
 *
 * O caminho online já fazia isso no controller (tabelaDaLoja). O OFFLINE
 * (fila de sync) mandava a tabela do REPRESENTANTE, e um cliente de tabela 3
 * nasceu em pedido de tabela 1 — #14637, Simone, 03/09/2026: o "Editar
 * peças" depois precificou a peça nova pela tabela errada. Este teste chama
 * o serviço do jeito que o sync chama (tabela do rep no parâmetro) e prova
 * que a do cliente vence, no preço E no que fica gravado.
 */

const EMPRESA = 'empresa-1';
const REP = 'rep-1';
const TABELA_DO_REP = 'tabela-01';
const TABELA_DO_CLIENTE = 'tabela-03';

async function carregar(tabelaDoCliente: string | null) {
  vi.resetModules();
  const fake = criarSupabaseFake({
    customers: { data: { id: 'c1', blocked: false, price_table_id: tabelaDoCliente }, error: null },
    product_prices: { data: [{ product_id: 'p1', price: 42, price_larger: null }], error: null },
    // Uma resposta só para todas as consultas em `orders` (sondas de coluna,
    // insert e releitura): sem erro e com id, serve para todas.
    orders: { data: { id: 'o1', status: 'draft', items: [] }, error: null },
    order_items: { data: [], error: null },
  } as never);
  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
  const { createOrder } = await import('../apps/api/src/modules/orders/orders.service.js');
  return { createOrder, fake };
}

const PEDIDO = {
  customer_id: 'c1',
  submit: false,
  items: [{ product_id: 'p1', quantity: 2, unit_price: 999 }],
};

/** Qual tabela filtrou a consulta de preço. */
function tabelaDoPreco(fake: ReturnType<typeof criarSupabaseFake>): unknown {
  return fake.filtrosDe('product_prices', 'eq').find((f) => f.args[0] === 'price_table_id')?.args[1];
}

/** O que foi gravado em `orders.price_table_id`. */
function tabelaGravada(fake: ReturnType<typeof criarSupabaseFake>): unknown {
  const insercoes = fake.gravacoes.filter((g) => g.tabela === 'orders' && g.operacao === 'insert');
  return (insercoes.at(-1)?.valores as { price_table_id?: string } | undefined)?.price_table_id;
}

beforeEach(() => {
  vi.resetModules();
});

describe('a tabela do pedido é a do cadastro do cliente', () => {
  it('chamador manda a do rep (caminho offline), mas a do CLIENTE vence — no preço e no gravado', async () => {
    const { createOrder, fake } = await carregar(TABELA_DO_CLIENTE);
    await createOrder(EMPRESA, REP, TABELA_DO_REP, PEDIDO, { source: 'rep' });
    expect(tabelaDoPreco(fake)).toBe(TABELA_DO_CLIENTE);
    expect(tabelaGravada(fake)).toBe(TABELA_DO_CLIENTE);
  });

  it('cliente sem tabela no cadastro: vale a que o chamador mandou (a do rep)', async () => {
    const { createOrder, fake } = await carregar(null);
    await createOrder(EMPRESA, REP, TABELA_DO_REP, PEDIDO, { source: 'rep' });
    expect(tabelaDoPreco(fake)).toBe(TABELA_DO_REP);
    expect(tabelaGravada(fake)).toBe(TABELA_DO_REP);
  });
});
