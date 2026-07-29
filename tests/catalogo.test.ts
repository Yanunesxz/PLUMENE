import { describe, it, expect, vi, beforeEach } from 'vitest';
import { criarSupabaseFake } from './supabaseFake.js';

/**
 * O catálogo é o ponto onde três regras de negócio se encontram:
 *  1. o representante não vê a posição de estoque da fábrica;
 *  2. o representante não vê produto que ele não consegue vender;
 *  3. quem enxerga tudo é gerente/admin.
 * Antes destes testes, as três só existiam como intenção no comentário.
 */

const EMPRESA = 'empresa-1';
const TABELA = 'tabela-1';

const PRODUTOS = [
  { id: 'p1', sku: '0001', name: 'Camisola', active: true, image_url: null },
  { id: 'p2', sku: '0002', name: 'Short Doll', active: true, image_url: null },
];

const VARIANTES = [
  { id: 'v1', product_id: 'p1', size: 'P', stock_quantity: 10, stock_committed: 2 },
  { id: 'v2', product_id: 'p1', size: 'M', stock_quantity: 3, stock_committed: 3 },
  // Estoque negativo acontece no ERP (baixa lançada antes da entrada).
  { id: 'v3', product_id: 'p2', size: 'G', stock_quantity: -5, stock_committed: 0 },
];

// Só p1 tem preço na tabela consultada.
const PRECOS = [{ product_id: 'p1', price: 49.9 }];

async function carregarServico(respostas: Record<string, unknown>) {
  const fake = criarSupabaseFake(respostas as never);
  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
  const mod = await import('../apps/api/src/modules/catalog/catalog.service.js');
  return { ...mod, fake };
}

beforeEach(() => {
  vi.resetModules();
});

describe('catálogo', () => {
  it('esconde a quantidade em estoque quando includeStock é falso', async () => {
    const { getProducts } = await carregarServico({
      products: { data: PRODUTOS, error: null },
      product_variants: { data: VARIANTES, error: null },
      product_prices: { data: PRECOS, error: null },
    });

    const produtos = await getProducts(EMPRESA, { price_table_id: TABELA });
    const grade = produtos.find((p) => p.id === 'p1')!.variants!;

    expect(grade.every((v) => v.available === undefined)).toBe(true);
    // Mas ainda dá para saber o que dá para vender.
    expect(grade.find((v) => v.size === 'P')!.in_stock).toBe(true);
    expect(grade.find((v) => v.size === 'M')!.in_stock).toBe(false);
  });

  it('entrega a quantidade quando includeStock é verdadeiro', async () => {
    const { getProducts } = await carregarServico({
      products: { data: PRODUTOS, error: null },
      product_variants: { data: VARIANTES, error: null },
      product_prices: { data: PRECOS, error: null },
    });

    const produtos = await getProducts(EMPRESA, { price_table_id: TABELA, includeStock: true });
    const grade = produtos.find((p) => p.id === 'p1')!.variants!;

    expect(grade.find((v) => v.size === 'P')!.available).toBe(8); // 10 − 2
    expect(grade.find((v) => v.size === 'M')!.available).toBe(0); // 3 − 3
  });

  it('trata estoque negativo do ERP como esgotado, nunca como número negativo', async () => {
    const { getProducts } = await carregarServico({
      products: { data: PRODUTOS, error: null },
      product_variants: { data: VARIANTES, error: null },
      product_prices: { data: PRECOS, error: null },
    });

    const produtos = await getProducts(EMPRESA, { price_table_id: TABELA, includeStock: true });
    const g = produtos.find((p) => p.id === 'p2')!.variants!.find((v) => v.size === 'G')!;

    expect(g.available).toBe(0);
    expect(g.in_stock).toBe(false);
  });

  it('com onlyPriced, some com o produto sem preço na tabela consultada', async () => {
    const { getProducts } = await carregarServico({
      products: { data: PRODUTOS, error: null },
      product_variants: { data: VARIANTES, error: null },
      product_prices: { data: PRECOS, error: null },
    });

    const produtos = await getProducts(EMPRESA, { price_table_id: TABELA, onlyPriced: true });

    expect(produtos.map((p) => p.id)).toEqual(['p1']);
  });

  it('sem onlyPriced, mantém o produto sem preço (visão do gerente)', async () => {
    const { getProducts } = await carregarServico({
      products: { data: PRODUTOS, error: null },
      product_variants: { data: VARIANTES, error: null },
      product_prices: { data: PRECOS, error: null },
    });

    const produtos = await getProducts(EMPRESA, { price_table_id: TABELA });

    expect(produtos.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(produtos.find((p) => p.id === 'p2')!.price).toBeNull();
  });

  it('não vaza company_id nem updated_at no payload', async () => {
    const { getProducts } = await carregarServico({
      products: { data: PRODUTOS, error: null },
      product_variants: { data: VARIANTES, error: null },
      product_prices: { data: PRECOS, error: null },
    });

    const [produto] = await getProducts(EMPRESA, { price_table_id: TABELA });

    expect(produto).not.toHaveProperty('company_id');
    expect(produto).not.toHaveProperty('updated_at');
  });
});
