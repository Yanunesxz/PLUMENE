import { describe, it, expect, vi, beforeEach } from 'vitest';
import { criarSupabaseFake } from './supabaseFake.js';

/**
 * Pedido offline entra UMA vez.
 *
 * O aparelho só limpa a fila quando a resposta chega. Se o servidor gravou e a
 * resposta se perdeu no caminho — sinal caindo, servidor reiniciando —, a fila
 * é reenviada inteira. Sem trava, nasce um segundo pedido idêntico: segunda
 * nota, segunda comissão e uma ligação da loja.
 */

const EMPRESA = 'empresa-1';
const REP = 'rep-1';
const TABELA = 'tabela-1';
const LOCAL_ID = 'local_1754170000000_ab12cd';

async function carregarServico(respostas: Record<string, unknown>) {
  const fake = criarSupabaseFake(respostas as never);
  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
  const mod = await import('../apps/api/src/modules/orders/orders.service.js');
  return { ...mod, fake };
}

const itens = [{ product_id: 'p1', quantity: 2, unit_price: 50 }];

beforeEach(() => {
  vi.resetModules();
});

describe('reenvio da fila offline', () => {
  it('encontra o pedido que já entrou e não cria outro', async () => {
    const { createOrder, fake } = await carregarServico({
      // 1ª consulta: procura pelo local_id e ACHA. 2ª: a leitura de volta.
      orders: [
        { data: { id: 'pedido-que-ja-existe' }, error: null },
        { data: { id: 'pedido-que-ja-existe', items: [] }, error: null },
      ],
      customers: { data: { id: 'c1', blocked: false }, error: null },
      product_prices: { data: [{ product_id: 'p1', price: 50 }], error: null },
    });

    const pedido = await createOrder(EMPRESA, REP, TABELA, {
      customer_id: 'c1',
      local_id: LOCAL_ID,
      submit: true,
      items: itens,
    });

    expect(pedido).not.toBeNull();
    // A prova: nenhuma gravação. O segundo envio é um NÃO-EVENTO.
    expect(fake.ultimaGravacao('orders', 'insert')).toBeUndefined();
  });

  it('procura pelo local_id DENTRO da empresa, nunca solto', async () => {
    const { createOrder, fake } = await carregarServico({
      orders: [
        { data: { id: 'ja-existe' }, error: null },
        { data: { id: 'ja-existe', items: [] }, error: null },
      ],
      customers: { data: { id: 'c1', blocked: false }, error: null },
      product_prices: { data: [{ product_id: 'p1', price: 50 }], error: null },
    });

    await createOrder(EMPRESA, REP, TABELA, { customer_id: 'c1', local_id: LOCAL_ID, items: itens });

    // Sem o filtro de empresa, o `local_id` de uma fábrica encontraria o pedido
    // de outra — o gerador é `Date.now()` + aleatório, não um UUID.
    const filtros = fake.filtrosDe('orders', 'eq').map((f) => f.args[0]);
    expect(filtros).toContain('company_id');
    expect(filtros).toContain('local_id');
  });

  it('pedido novo (local_id livre) grava normalmente', async () => {
    const { createOrder, fake } = await carregarServico({
      orders: [
        { data: null, error: null }, // não existe ainda
        { data: [{ id: 'sonda' }], error: null }, // sondagem das colunas de origem
        { data: { id: 'o1' }, error: null }, // a gravação
      ],
      customers: { data: { id: 'c1', blocked: false }, error: null },
      product_prices: { data: [{ product_id: 'p1', price: 50 }], error: null },
      order_items: { data: [], error: null },
    });

    await createOrder(EMPRESA, REP, TABELA, {
      customer_id: 'c1',
      local_id: LOCAL_ID,
      submit: true,
      items: itens,
    });

    const gravado = fake.ultimaGravacao('orders', 'insert')!.valores as { local_id: string };
    expect(gravado.local_id).toBe(LOCAL_ID);
  });

  it('pedido montado no app, sem local_id, nem consulta a fila', async () => {
    const { createOrder, fake } = await carregarServico({
      orders: [
        { data: [{ id: 'sonda' }], error: null },
        { data: { id: 'o1' }, error: null },
      ],
      customers: { data: { id: 'c1', blocked: false }, error: null },
      product_prices: { data: [{ product_id: 'p1', price: 50 }], error: null },
      order_items: { data: [], error: null },
    });

    await createOrder(EMPRESA, REP, TABELA, { customer_id: 'c1', submit: true, items: itens });

    const filtros = fake.filtrosDe('orders', 'eq').map((f) => f.args[0]);
    expect(filtros).not.toContain('local_id');
    expect(fake.ultimaGravacao('orders', 'insert')).toBeDefined();
  });
});
