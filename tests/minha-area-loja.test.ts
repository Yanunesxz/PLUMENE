import { describe, it, expect, vi, beforeEach } from 'vitest';
import { criarSupabaseFake } from './supabaseFake.js';

/**
 * "Minha área" da loja.
 *
 * O que estes testes protegem é o número que a loja lê primeiro: há quantos
 * dias ela não compra. Se pedido recusado ou rascunho entrasse na conta, a tela
 * diria que ela comprou numa data em que não comprou — e o representante
 * deixaria de ligar para quem sumiu.
 */

const EMPRESA = 'empresa-1';
const CLIENTE = 'cliente-1';
const REP = 'rep-1';

async function carregar(respostas: Record<string, unknown>) {
  const fake = criarSupabaseFake(respostas as never);
  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
  const mod = await import('../apps/api/src/modules/access/loja.service.js');
  return { ...mod, fake };
}

const diasAtras = (d: number) => new Date(Date.now() - d * 86400_000).toISOString();

const cliente = {
  data: {
    name: 'LOJA DA ANA LTDA',
    trade_name: 'Loja da Ana',
    cnpj: '12345678000199',
    whatsapp: '32999990000',
  },
  error: null,
};

const representante = { data: { name: 'Carlos', phone: '32988887777' }, error: null };

const produtos = {
  data: [
    { id: 'p1', name: 'Camisola Renda', sku: '0001', image_url: 'https://x/1.jpg' },
    { id: 'p2', name: 'Pijama Longo', sku: '0002', image_url: null },
  ],
  error: null,
};

beforeEach(() => {
  vi.resetModules();
});

describe('há quanto tempo a loja não compra', () => {
  it('conta os dias desde o pedido mais recente que virou compra', async () => {
    const { montarMinhaArea } = await carregar({
      customers: cliente,
      users: representante,
      orders: {
        data: [
          { id: 'o2', order_number: 2, status: 'approved', total: 300, created_at: diasAtras(10) },
          { id: 'o1', order_number: 1, status: 'approved', total: 200, created_at: diasAtras(70) },
        ],
        error: null,
      },
      order_items: {
        data: [
          { order_id: 'o2', product_id: 'p1', variant_id: 'v1', quantity: 6 },
          { order_id: 'o1', product_id: 'p1', variant_id: 'v1', quantity: 4 },
        ],
        error: null,
      },
      products: produtos,
    });

    const area = await montarMinhaArea(EMPRESA, CLIENTE, REP);

    expect(area!.resumo.dias_desde_ultimo).toBe(10);
    expect(area!.resumo.total_pedidos).toBe(2);
    expect(area!.resumo.total_gasto).toBe(500);
    expect(area!.resumo.ticket_medio).toBe(250);
    expect(area!.resumo.total_pecas).toBe(10);
  });

  it('pedido recusado não vira compra — nem no gasto, nem na data', async () => {
    const { montarMinhaArea } = await carregar({
      customers: cliente,
      users: representante,
      orders: {
        data: [
          // O mais recente foi recusado: não pode passar por "última compra".
          { id: 'o3', order_number: 3, status: 'rejected', total: 900, created_at: diasAtras(2) },
          { id: 'o2', order_number: 2, status: 'approved', total: 300, created_at: diasAtras(40) },
        ],
        error: null,
      },
      order_items: {
        data: [{ order_id: 'o2', product_id: 'p1', variant_id: 'v1', quantity: 5 }],
        error: null,
      },
      products: produtos,
    });

    const area = await montarMinhaArea(EMPRESA, CLIENTE, REP);

    expect(area!.resumo.dias_desde_ultimo).toBe(40);
    expect(area!.resumo.total_gasto).toBe(300);
    expect(area!.resumo.total_pedidos).toBe(1);
  });

  it('loja que nunca pediu não inventa data', async () => {
    const { montarMinhaArea } = await carregar({
      customers: cliente,
      users: representante,
      orders: { data: [], error: null },
    });

    const area = await montarMinhaArea(EMPRESA, CLIENTE, REP);

    expect(area!.resumo.ultimo_pedido_em).toBeNull();
    expect(area!.resumo.dias_desde_ultimo).toBeNull();
    expect(area!.resumo.ticket_medio).toBe(0);
    expect(area!.pecas).toEqual([]);
    expect(area!.repetir).toEqual([]);
  });
});

describe('o que a loja mais compra', () => {
  it('soma as quantidades e põe a peça mais comprada na frente', async () => {
    const { montarMinhaArea } = await carregar({
      customers: cliente,
      users: representante,
      orders: {
        data: [
          { id: 'o2', order_number: 2, status: 'approved', total: 300, created_at: diasAtras(5) },
          { id: 'o1', order_number: 1, status: 'sent_erp', total: 200, created_at: diasAtras(50) },
        ],
        error: null,
      },
      order_items: {
        data: [
          { order_id: 'o2', product_id: 'p2', variant_id: 'v9', quantity: 2 },
          { order_id: 'o2', product_id: 'p1', variant_id: 'v1', quantity: 6 },
          { order_id: 'o1', product_id: 'p1', variant_id: 'v1', quantity: 4 },
        ],
        error: null,
      },
      products: produtos,
    });

    const area = await montarMinhaArea(EMPRESA, CLIENTE, REP);

    expect(area!.pecas[0]).toMatchObject({
      product_id: 'p1',
      name: 'Camisola Renda',
      quantidade: 10,
      vezes: 2,
    });
    expect(area!.pecas[1]).toMatchObject({ product_id: 'p2', quantidade: 2, vezes: 1 });
  });

  it('repetir a compra traz os itens do último pedido, não os do primeiro', async () => {
    const { montarMinhaArea } = await carregar({
      customers: cliente,
      users: representante,
      orders: {
        data: [
          { id: 'o2', order_number: 2, status: 'approved', total: 300, created_at: diasAtras(5) },
          { id: 'o1', order_number: 1, status: 'approved', total: 200, created_at: diasAtras(50) },
        ],
        error: null,
      },
      order_items: {
        data: [
          { order_id: 'o1', product_id: 'p1', variant_id: 'v1', quantity: 4 },
          { order_id: 'o2', product_id: 'p2', variant_id: 'v9', quantity: 3 },
        ],
        error: null,
      },
      products: produtos,
    });

    const area = await montarMinhaArea(EMPRESA, CLIENTE, REP);

    expect(area!.repetir).toEqual([{ product_id: 'p2', variant_id: 'v9', quantity: 3 }]);
  });
});

describe('a conta que a loja vê', () => {
  it('traz o WhatsApp do representante — é por onde ela fala com a fábrica', async () => {
    const { montarMinhaArea } = await carregar({
      customers: cliente,
      users: representante,
      orders: { data: [], error: null },
    });

    const area = await montarMinhaArea(EMPRESA, CLIENTE, REP);

    expect(area!.conta.rep_name).toBe('Carlos');
    expect(area!.conta.rep_whatsapp).toBe('32988887777');
  });

  it('não conta para a loja em qual tabela de preço ela está', async () => {
    const { montarMinhaArea, fake } = await carregar({
      customers: cliente,
      users: representante,
      orders: { data: [], error: null },
    });

    const area = await montarMinhaArea(EMPRESA, CLIENTE, REP);

    // Saber que está na "TABELA 03" é saber que existem 01 e 02. Não sai nem no
    // payload: a checagem é na resposta inteira, não só no que a tela desenha.
    expect(JSON.stringify(area)).not.toContain('price_table');
    expect(fake.filtrosDe('price_tables')).toHaveLength(0);
  });

  it('cadastro que não existe devolve nulo em vez de tela pela metade', async () => {
    const { montarMinhaArea } = await carregar({ customers: { data: null, error: null } });

    expect(await montarMinhaArea(EMPRESA, CLIENTE, REP)).toBeNull();
  });

  it('conta pedidos em análise para a loja saber que não sumiram', async () => {
    const { montarMinhaArea } = await carregar({
      customers: cliente,
      users: representante,
      orders: {
        data: [
          { id: 'o3', order_number: 3, status: 'pending_rep', total: 100, created_at: diasAtras(1) },
          { id: 'o2', order_number: 2, status: 'pending_approval', total: 200, created_at: diasAtras(3) },
          { id: 'o1', order_number: 1, status: 'approved', total: 300, created_at: diasAtras(9) },
        ],
        error: null,
      },
      order_items: { data: [], error: null },
      products: produtos,
    });

    const area = await montarMinhaArea(EMPRESA, CLIENTE, REP);

    expect(area!.resumo.aguardando).toBe(2);
  });
});
