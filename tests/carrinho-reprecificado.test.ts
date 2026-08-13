import { describe, it, expect } from 'vitest';
import { precoDoTamanho } from '@csb/shared';

/**
 * A reprecificação do carrinho.
 *
 * O carrinho guarda o `unit_price` de quando a peça foi adicionada, e é
 * persistido no aparelho: um pedido montado semana passada abre hoje com os
 * preços daquele dia. Duas rotinas reprecificam esse carrinho —
 * `PaginaNovoPedido` ajusta ao trocar de cliente (tabela do cliente) e ao abrir
 * a tela (preço velho parado).
 *
 * O defeito que este teste tranca: as duas liam `produto.price` puro. Isso
 * REBAIXAVA todo EG e toda peça da grade plus ao preço do tamanho normal — em
 * silêncio, e logo depois de o preço certo ter sido carregado. O representante
 * via o total menor; o servidor, que recalcula no envio, cobrava o certo. A
 * diferença só aparecia na nota.
 */

/** O que a reprecificação faz com UMA linha do carrinho. */
function reprecificar(
  linha: { size: string; unit_price: number },
  produto: { price: number | null; price_larger: number | null },
): number | null {
  return precoDoTamanho(linha.size, produto.price, produto.price_larger);
}

const PRODUTO = { price: 43.9, price_larger: 53.9 };

describe('reprecificar o carrinho', () => {
  it('NÃO rebaixa o tamanho extra ao preço do normal', () => {
    // A linha entrou com o preço antigo, de quando só existia uma faixa.
    const linha = { size: '48', unit_price: 43.9 };
    expect(reprecificar(linha, PRODUTO)).toBe(53.9);
  });

  it('corrige o EG parado no aparelho com preço velho', () => {
    expect(reprecificar({ size: 'EG', unit_price: 43.9 }, PRODUTO)).toBe(53.9);
  });

  it('deixa o tamanho normal no preço normal', () => {
    expect(reprecificar({ size: 'M', unit_price: 43.9 }, PRODUTO)).toBe(43.9);
  });

  it('corrige para BAIXO também, quando a tabela do cliente é mais barata', () => {
    const maisBarata = { price: 38.5, price_larger: 44.9 };
    expect(reprecificar({ size: 'M', unit_price: 43.9 }, maisBarata)).toBe(38.5);
    expect(reprecificar({ size: 'EG', unit_price: 53.9 }, maisBarata)).toBe(44.9);
  });

  it('peça de preço único mantém um preço só em toda a grade', () => {
    const unico = { price: 27.5, price_larger: null };
    expect(reprecificar({ size: '4', unit_price: 27.5 }, unico)).toBe(27.5);
    expect(reprecificar({ size: 'EG', unit_price: 27.5 }, unico)).toBe(27.5);
  });

  it('devolve null quando a peça não tem preço na tabela — a linha sai do carrinho', () => {
    expect(reprecificar({ size: 'M', unit_price: 43.9 }, { price: null, price_larger: null })).toBeNull();
  });

  it('o preço reprecificado é o MESMO que o servidor vai gravar', () => {
    // A API resolve por `precoDoTamanho` com o tamanho lido do banco. Se as duas
    // pontas divergirem, o representante vende por um valor e a fábrica fatura
    // por outro — que e o defeito que a faixa maior inteira existe para evitar.
    for (const size of ['PP', 'P', 'M', 'G', 'GG', 'EG', '48', '50', '52', '54']) {
      const naTela = reprecificar({ size, unit_price: 0 }, PRODUTO);
      const noServidor = precoDoTamanho(size, PRODUTO.price, PRODUTO.price_larger);
      expect(naTela).toBe(noServidor);
    }
  });
});
