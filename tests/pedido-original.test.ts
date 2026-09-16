import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  compararComOOriginal,
  compararOriginalComNotas,
  itensDasNotasAtivas,
  lerFaturamentoDoPedido,
  type ItemDaFoto,
  type ItemDaNota,
  type NotaDoPedido,
} from '@csb/shared';
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
afterEach(() => {
  vi.doUnmock('../apps/api/src/config/supabase.js');
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

/**
 * O corte feito DENTRO do Control (048): as peças que cada nota levou.
 *
 * O carimbo manual não muda os itens do app, então o cartão comparava o
 * original com ele mesmo e afirmava "nenhuma peça foi cortada" sem saber.
 * Quando o Control manda os itens da nota, a coluna "Faturado" passa a ser o
 * que as notas ativas levaram.
 */
const pecaDaFoto = (
  product_id: string,
  sku: string,
  variant_id: string,
  size: string,
  quantity: number,
  unit_price = 10,
): ItemDaFoto =>
  peca({
    product_id,
    variant_id,
    quantity,
    unit_price,
    total: quantity * unit_price,
    product: { sku, name: 'PEÇA TESTE' },
    variant: { size },
  });

const itemDaNota = (p: Partial<ItemDaNota> & { produto: string; tamanho: string; quantidade: number }): ItemDaNota => ({
  variant_id: null,
  preco_unitario: null,
  ...p,
});

const nota = (itens: ItemDaNota[], extra: Partial<NotaDoPedido> = {}): NotaDoPedido => ({
  numero: '000123',
  serie: '1',
  emitida_em: '2026-08-13T17:02:00+00:00',
  valor: null,
  cancelada_em: null,
  itens,
  ...extra,
});

describe('compararOriginalComNotas — o que as notas levaram', () => {
  const ORIGINAL = [
    pecaDaFoto('p1', '0124', 'v-m', 'M', 12, 24.9),
    pecaDaFoto('p2', '0703', 'v-g', 'G', 6, 28.5),
  ];

  it('casa pela variante e mostra a peça cortada no Control', () => {
    const d = compararOriginalComNotas(ORIGINAL, [
      itemDaNota({ produto: '0124', tamanho: 'M', variant_id: 'v-m', quantidade: 8 }),
      itemDaNota({ produto: '0703', tamanho: 'G', variant_id: 'v-g', quantidade: 6 }),
    ]);

    expect(d.pecasAntes).toBe(18);
    expect(d.pecasDepois).toBe(14);
    expect(d.linhas).toHaveLength(1);
    expect(d.linhas[0]).toMatchObject({ ref: '0124', tamanho: 'M', antes: 12, depois: 8, valor: 99.6 });
    expect(d.valorQueSaiu).toBe(99.6);
  });

  it('sem variante, casa pelo par produto/tamanho — "124" e "0124" são a mesma referência', () => {
    const d = compararOriginalComNotas(ORIGINAL, [
      itemDaNota({ produto: '124', tamanho: 'm', quantidade: 12 }),
      itemDaNota({ produto: '0703', tamanho: 'G', quantidade: 2 }),
    ]);

    expect(d.linhas).toEqual([
      expect.objectContaining({ ref: '0703', tamanho: 'G', antes: 6, depois: 2, valor: 114 }),
    ]);
  });

  it('casa pelo erp_id do produto — é o código que o Control manda, e ele pode diferir do sku', () => {
    // Produto cadastrado à mão: sku '0130 PLUS' no app, erp_id '0130' no
    // Control. A peça da nota veio sem variante resolvida; só o erp_id casa.
    const original = [
      peca({
        product_id: 'p1',
        variant_id: 'v-m',
        quantity: 12,
        unit_price: 24.9,
        total: 298.8,
        product: { sku: '0130 PLUS', erp_id: '0130', name: 'PEÇA TESTE' },
        variant: { size: 'M' },
      }),
    ];

    const d = compararOriginalComNotas(original, [itemDaNota({ produto: '0130', tamanho: 'M', quantidade: 12 })]);

    // Sem o erp_id, a peça entraria como linha nova e o original sairia com
    // depois=0: 12 peças "cortadas" e 12 "entradas" num pedido que saiu inteiro.
    expect(d.mudou).toBe(false);
    expect(d.linhas).toEqual([]);
    expect(d.pecasDepois).toBe(12);
  });

  it('referência que a nota não levou aparece com zero', () => {
    const d = compararOriginalComNotas(ORIGINAL, [itemDaNota({ produto: '0124', tamanho: 'M', quantidade: 12 })]);

    expect(d.linhas).toEqual([expect.objectContaining({ ref: '0703', antes: 6, depois: 0 })]);
  });

  it('peça que só a nota tem entra com o código do Control', () => {
    const d = compararOriginalComNotas(ORIGINAL, [
      itemDaNota({ produto: '0124', tamanho: 'M', quantidade: 12 }),
      itemDaNota({ produto: '0703', tamanho: 'G', quantidade: 6 }),
      itemDaNota({ produto: '0999', tamanho: 'P', quantidade: 1, preco_unitario: 15 }),
    ]);

    expect(d.linhas).toEqual([expect.objectContaining({ ref: '0999', tamanho: 'P', antes: 0, depois: 1, valor: -15 })]);
  });

  it('preço da nota diferente do original vai para a reprecificação, não para o corte', () => {
    const d = compararOriginalComNotas(ORIGINAL, [
      itemDaNota({ produto: '0124', tamanho: 'M', quantidade: 12, preco_unitario: 23.9 }),
      itemDaNota({ produto: '0703', tamanho: 'G', quantidade: 6 }),
    ]);

    expect(d.mudou).toBe(false);
    expect(d.valorReprecificado).toBe(-12);
  });

  it('nota cancelada não conta', () => {
    const itens = itensDasNotasAtivas([
      nota([itemDaNota({ produto: '0124', tamanho: 'M', quantidade: 12 })], { cancelada_em: '2026-08-14T12:00:00Z' }),
      nota([itemDaNota({ produto: '0124', tamanho: 'M', quantidade: 5 })], { numero: '000124' }),
    ]);
    expect(itens).toHaveLength(1);
    expect(itens[0]?.quantidade).toBe(5);
  });
});

describe('lerFaturamentoDoPedido — o que o cartão pode afirmar', () => {
  const ORIGINAL = [pecaDaFoto('p1', '0124', 'v-m', 'M', 10, 20)];
  const base = { original: ORIGINAL, itensAtuais: ORIGINAL, totalAtual: 200 };

  it('faturado sem itens de nota e sem valor da nota: NUNCA "nenhuma peça foi cortada"', () => {
    const l = lerFaturamentoDoPedido({ ...base, faturado: true, invoicedTotal: null, notas: [] });

    expect(l.situacao).toBe('sem_detalhe');
    expect(l.semDetalheDoControl).toBe(true);
    expect(l.mostrar).toBe(true);
    expect(l.rotuloDaDireita).toBe('Pedido no app');
  });

  it('só nota cancelada também é "sem detalhe"', () => {
    const l = lerFaturamentoDoPedido({
      ...base,
      faturado: true,
      notas: [nota([itemDaNota({ produto: '0124', tamanho: 'M', quantidade: 10 })], { cancelada_em: '2026-08-14T12:00:00Z', valor: 200 })],
    });

    expect(l.situacao).toBe('sem_detalhe');
  });

  it('com os itens da nota e o valor fechado, a coluna "Faturado" é o que a nota levou e o corte aparece', () => {
    const l = lerFaturamentoDoPedido({
      ...base,
      faturado: true,
      // O Control fechou o valor do pedido: o que a nota não levou foi cortado.
      invoicedTotal: 140,
      notas: [nota([itemDaNota({ produto: '0124', tamanho: 'M', variant_id: 'v-m', quantidade: 7 })], { valor: 140 })],
    });

    expect(l.fonte).toBe('notas');
    expect(l.rotuloDaDireita).toBe('Faturado');
    expect(l.faturamentoParcial).toBe(false);
    expect(l.diferenca.pecasDepois).toBe(7);
    expect(l.diferenca.linhas[0]).toMatchObject({ antes: 10, depois: 7, valor: 60 });
    expect(l.valorDaNota).toBe(140);
    expect(l.diferencaDaNota).toBe(60);
    expect(l.situacao).toBe('mudou');
  });

  it('nota com PARTE das peças e sem o valor fechado é faturamento em partes, não corte', () => {
    // O pedido pode sair em mais de uma nota: a segunda chega amanhã. Enquanto
    // o Control não fecha o valor, chamar a diferença de corte seria afirmar
    // um corte que talvez não tenha havido.
    const l = lerFaturamentoDoPedido({
      ...base,
      faturado: true,
      invoicedTotal: null,
      notas: [nota([itemDaNota({ produto: '0124', tamanho: 'M', variant_id: 'v-m', quantidade: 7 })], { valor: 140 })],
    });

    expect(l.situacao).toBe('parcial');
    expect(l.faturamentoParcial).toBe(true);
    expect(l.pecasFaturadas).toBe(7);
    expect(l.rotuloDaDireita).toBe('Faturado até agora');
    // Nada de "a nota fechou R$ 60 abaixo": o resto ainda pode vir.
    expect(l.diferencaDaNota).toBeNull();
    expect(l.notaDiferente).toBe(false);
    expect(l.mostrar).toBe(true);
  });

  it('as notas que chegaram já levaram tudo: aí a leitura é normal, não parcial', () => {
    const l = lerFaturamentoDoPedido({
      ...base,
      faturado: true,
      invoicedTotal: null,
      notas: [
        nota([itemDaNota({ produto: '0124', tamanho: 'M', variant_id: 'v-m', quantidade: 6 })], { numero: '000123' }),
        nota([itemDaNota({ produto: '0124', tamanho: 'M', variant_id: 'v-m', quantidade: 4 })], { numero: '000124' }),
      ],
    });

    expect(l.faturamentoParcial).toBe(false);
    expect(l.situacao).toBe('igual');
  });

  it('itens da nota iguais ao original: aí sim "faturado igual ao original"', () => {
    const l = lerFaturamentoDoPedido({
      ...base,
      faturado: true,
      notas: [nota([itemDaNota({ produto: '0124', tamanho: 'M', quantidade: 10 })], { valor: 200 })],
    });

    expect(l.situacao).toBe('igual');
    expect(l.semDetalheDoControl).toBe(false);
  });

  it('só o valor da nota (027), igual ao pedido, sustenta o "igual"', () => {
    const l = lerFaturamentoDoPedido({ ...base, faturado: true, invoicedTotal: 200 });

    expect(l.fonte).toBe('pedido');
    expect(l.situacao).toBe('igual');
  });

  it('pedido ainda não faturado e intacto: o cartão não aparece', () => {
    const l = lerFaturamentoDoPedido({ ...base, faturado: false });

    expect(l.mostrar).toBe(false);
    expect(l.rotuloDaDireita).toBe('Hoje');
  });
});

describe('lerNotasDoPedido — as notas no detalhe do pedido', () => {
  async function carregarNotas(respostas: Record<string, RespostaTabela | RespostaTabela[]>) {
    const fake = criarSupabaseFake(respostas);
    vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
    const mod = await import('../apps/api/src/modules/orders/notasDoPedido.service.js');
    return { ...mod, fake };
  }

  it('devolve as notas com as peças, filtrando pela empresa', async () => {
    const { lerNotasDoPedido, fake } = await carregarNotas({
      order_invoices: [
        { data: [], error: null }, // detecção: a 048 rodou
        { data: null, error: null },
        {
          data: [
            {
              numero: '000123',
              serie: '1',
              emitida_em: '2026-08-13T17:02:00+00:00',
              valor: '150.00',
              cancelada_em: null,
              itens: [{ produto: '0124', tamanho: 'M', variant_id: 'v1', quantidade: 4, preco_unitario: '24.90' }],
            },
          ],
          error: null,
        },
      ],
      order_invoice_items: { data: [], error: null },
    });

    const notas = await lerNotasDoPedido('o1', 'empresa-1');

    expect(notas).toEqual([
      {
        numero: '000123',
        serie: '1',
        emitida_em: '2026-08-13T17:02:00+00:00',
        valor: 150,
        cancelada_em: null,
        itens: [{ produto: '0124', tamanho: 'M', variant_id: 'v1', quantidade: 4, preco_unitario: 24.9 }],
      },
    ]);
    expect(fake.filtrosDe('order_invoices', 'eq').map((f) => f.args)).toContainEqual(['company_id', 'empresa-1']);
  });

  it('sem a 048, lista vazia (e o detalhe do pedido segue como antes)', async () => {
    const { lerNotasDoPedido } = await carregarNotas({
      order_invoices: { data: null, error: { message: 'relation "order_invoices" does not exist', code: '42P01' } },
    });

    expect(await lerNotasDoPedido('o1', 'empresa-1')).toEqual([]);
  });
});
