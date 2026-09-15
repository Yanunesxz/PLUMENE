import { describe, it, expect, vi, beforeEach } from 'vitest';
import { compararComOOriginal, type ItemDaFoto } from '@csb/shared';
import { criarSupabaseFake, type RespostaTabela } from './supabaseFake.js';
import { esquecerDeteccoes } from '../apps/api/src/lib/detectarColuna.js';

/**
 * A cópia do pedido ORIGINAL (migração 044).
 *
 * "Hoje o pedido original vem montado mas depois que a gente fatura pode tirar
 * algumas peças que não temos e o pedido vem com menos; precisamos deixar uma
 * cópia do pedido original e como que o pedido foi faturado" (Yan,
 * 11/09/2026).
 *
 * O que estes testes trancam: a foto é tirada UMA vez (a primeira), rascunho
 * não tem original, e a comparação diz o que saiu peça por peça.
 */

const peca = (p: Partial<ItemDaFoto> & { product_id: string; quantity: number }): ItemDaFoto => ({
  id: `${p.product_id}-${p.variant_id ?? 'x'}`,
  order_id: 'o1',
  variant_id: null,
  unit_price: 10,
  total: p.quantity * 10,
  product: { sku: '0124', name: 'PIJAMA' },
  variant: null,
  ...p,
});

describe('compararComOOriginal', () => {
  it('mostra a peça que saiu, com o que ela deixou de faturar', () => {
    const antes = [
      peca({ product_id: 'p1', variant_id: 'm', quantity: 12, unit_price: 24.9, total: 298.8 }),
      peca({ product_id: 'p2', quantity: 6 }),
    ];
    const depois = [
      peca({ product_id: 'p1', variant_id: 'm', quantity: 4, unit_price: 24.9, total: 99.6 }),
      peca({ product_id: 'p2', quantity: 6 }),
    ];

    const d = compararComOOriginal(antes, depois);

    expect(d.mudou).toBe(true);
    expect(d.pecasAntes).toBe(18);
    expect(d.pecasDepois).toBe(10);
    expect(d.linhas).toHaveLength(1);
    expect(d.linhas[0]).toMatchObject({ antes: 12, depois: 4, valor: 199.2 });
    expect(d.valorQueSaiu).toBe(199.2);
  });

  it('referência cortada INTEIRA aparece com zero, não some da lista', () => {
    const d = compararComOOriginal(
      [peca({ product_id: 'p1', quantity: 5 }), peca({ product_id: 'p2', quantity: 3 })],
      [peca({ product_id: 'p1', quantity: 5 })],
    );

    expect(d.linhas).toHaveLength(1);
    expect(d.linhas[0]).toMatchObject({ antes: 3, depois: 0 });
  });

  it('peça que ENTROU também conta — o comparativo não conta meia história', () => {
    const d = compararComOOriginal(
      [peca({ product_id: 'p1', quantity: 2 })],
      [peca({ product_id: 'p1', quantity: 2 }), peca({ product_id: 'p9', quantity: 4 })],
    );

    expect(d.linhas).toHaveLength(1);
    expect(d.linhas[0]).toMatchObject({ antes: 0, depois: 4 });
    expect(d.valorQueSaiu).toBe(-40);
  });

  it('pedido intacto não vira comparação nenhuma', () => {
    const iguais = [peca({ product_id: 'p1', quantity: 7 })];
    expect(compararComOOriginal(iguais, [...iguais]).mudou).toBe(false);
  });
});

async function carregarServico(respostas: Record<string, RespostaTabela | RespostaTabela[]>) {
  const fake = criarSupabaseFake(respostas as never);
  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
  const mod = await import('../apps/api/src/modules/orders/pedidoOriginal.service.js');
  return { ...mod, fake };
}

const PEDIDO = { id: 'o1', company_id: 'empresa-1', status: 'approved' as const };

beforeEach(() => {
  vi.resetModules();
  esquecerDeteccoes();
});

describe('guardarOriginal', () => {
  it('tira a foto do pedido antes do primeiro corte', async () => {
    const { guardarOriginal, fake } = await carregarServico({
      order_originals: [
        { data: [], error: null }, // detecção: a 044 rodou
        { data: null, error: null }, // ainda não há foto
        { data: null, error: null }, // o insert
      ],
      orders: {
        data: { id: 'o1', total: 500, items: [{ quantity: 12 }, { quantity: 8 }] },
        error: null,
      },
    });

    expect(await guardarOriginal(PEDIDO, 'edicao', 'financeiro-1')).toBe('guardada');
    const gravado = fake.ultimaGravacao('order_originals', 'insert')?.valores as {
      pecas: number;
      total: number;
      motivo: string;
    };
    expect(gravado).toMatchObject({ pecas: 20, total: 500, motivo: 'edicao' });
  });

  it('não tira a segunda foto — fotografia tirada duas vezes já não é original', async () => {
    const { guardarOriginal, fake } = await carregarServico({
      order_originals: [
        { data: [], error: null }, // detecção
        { data: { order_id: 'o1' }, error: null }, // já tem
      ],
    });

    expect(await guardarOriginal(PEDIDO, 'faturamento')).toBe('ja_tinha');
    expect(fake.ultimaGravacao('order_originals', 'insert')).toBeUndefined();
  });

  it('rascunho não tem original: mexer nele ainda é montar o pedido', async () => {
    const { guardarOriginal, fake } = await carregarServico({});

    expect(await guardarOriginal({ ...PEDIDO, status: 'draft' }, 'edicao')).toBe('ja_tinha');
    expect(fake.filtrosDe('order_originals')).toHaveLength(0);
  });

  it('sem a migração 044 o corte continua acontecendo, só sem foto', async () => {
    const { guardarOriginal, fake } = await carregarServico({
      order_originals: {
        data: null,
        error: { message: 'relation "order_originals" does not exist', code: '42P01' },
      },
    });

    expect(await guardarOriginal(PEDIDO, 'edicao')).toBe('sem_tabela');
    expect(fake.ultimaGravacao('order_originals', 'insert')).toBeUndefined();
  });
});

/**
 * O total mistura corte com troca de preço: ao editar, o servidor reprecifica
 * TODAS as linhas pela tabela de hoje. A comparação tem de separar os dois —
 * senão a manchete infla o corte com a reprecificação, e um pedido que só
 * GANHOU peça aparece como "saíram −2 peças" quando a tabela baixou.
 * (Caso real: a troca de 08/09 baixou 44 preços em T2/T3; o #14629 está
 * sent_erp com −R$ 80 de reprecificação pendente.)
 */
describe('compararComOOriginal — corte separado de troca de preço', () => {
  it('o corte é contado a preço ORIGINAL e a reprecificação vai à parte', () => {
    // 0161 caiu de 92,90 para 91,90 (60 peças ficaram) e saíram 5 da 0703 (28,50).
    const antes = [
      peca({ product_id: '0161', variant_id: 'm', quantity: 60, unit_price: 92.9, total: 5574 }),
      peca({ product_id: '0703', variant_id: 'g', quantity: 10, unit_price: 28.5, total: 285 }),
    ];
    const depois = [
      peca({ product_id: '0161', variant_id: 'm', quantity: 60, unit_price: 91.9, total: 5514 }),
      peca({ product_id: '0703', variant_id: 'g', quantity: 5, unit_price: 28.5, total: 142.5 }),
    ];

    const d = compararComOOriginal(antes, depois);

    expect(d.linhas).toHaveLength(1); // só a 0703 mudou de quantidade
    expect(d.valorQueSaiu).toBe(142.5); // 5 × 28,50, e NÃO 202,50
    expect(d.valorReprecificado).toBe(-60); // 60 × (91,90 − 92,90)
  });

  it('pedido que só ganhou peça com a tabela baixando NÃO vira "saíram peças"', () => {
    const antes = [peca({ product_id: '0161', quantity: 60, unit_price: 92.9, total: 5574 })];
    const depois = [
      peca({ product_id: '0161', quantity: 60, unit_price: 91.9, total: 5514 }),
      peca({ product_id: '0118', quantity: 2, unit_price: 15.1, total: 30.2 }),
    ];

    const d = compararComOOriginal(antes, depois);

    expect(d.pecasAntes).toBe(60);
    expect(d.pecasDepois).toBe(62);
    expect(d.valorQueSaiu).toBe(-30.2); // entrou R$ 30,20, a preço da linha
    expect(d.valorReprecificado).toBe(-60);
  });

  it('mesmas peças e mesmo preço: nada reprecificado, nada cortado', () => {
    const iguais = [peca({ product_id: 'p1', quantity: 7 })];
    const d = compararComOOriginal(iguais, [...iguais]);
    expect(d.mudou).toBe(false);
    expect(d.valorReprecificado).toBe(0);
  });
});
