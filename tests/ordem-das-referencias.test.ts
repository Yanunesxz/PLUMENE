import { describe, it, expect } from 'vitest';
import { compararReferencia } from '../apps/web/src/lib/pedido.js';
import { compararTamanho } from '../apps/web/src/components/comercial/grade.js';

/**
 * A ordem das peças numa lista de pedido.
 *
 * Toda lista (montagem, detalhe, página do cliente) sai em ref CRESCENTE — a
 * ordem do catálogo impresso, que é como o representante confere com o lojista.
 *
 * O detalhe que este teste tranca: a comparação é NUMÉRICA. As refs vêm com
 * zero à esquerda ("0015"), onde a ordem alfabética coincide — mas basta uma
 * sem o zero, vinda do ERP ou de cadastro antigo, e "950" iria parar depois de
 * "1001" na ordem alfabética.
 */

describe('ordem crescente de referência', () => {
  it('ordena como número, não como texto', () => {
    const refs = ['1001', '0130', '0015', '950', '0072'];
    expect(refs.sort(compararReferencia)).toEqual(['0015', '0072', '0130', '950', '1001']);
  });

  it('zero à esquerda não muda o valor — "0130" e "130" são a mesma ref', () => {
    expect(compararReferencia('0130', '130')).toBe(0);
  });

  it('ref não numérica cai na ordem alfabética, depois de resolver as numéricas entre si', () => {
    const refs = ['PIJ002', '0130', 'PIJ001'];
    const ordenado = refs.sort(compararReferencia);
    expect(ordenado.indexOf('PIJ001')).toBeLessThan(ordenado.indexOf('PIJ002'));
    expect(ordenado.indexOf('0130')).toBe(0);
  });

  it('na mesma ref, desempata pela ordem da grade — como as listas usam', () => {
    const linhas = [
      { sku: '0130', size: 'EG' },
      { sku: '0015', size: 'M' },
      { sku: '0130', size: 'P' },
      { sku: '0015', size: 'PP' },
    ];
    const ordenado = linhas.sort(
      (a, b) => compararReferencia(a.sku, b.sku) || compararTamanho(a.size, b.size),
    );
    expect(ordenado.map((l) => `${l.sku}|${l.size}`)).toEqual([
      '0015|PP',
      '0015|M',
      '0130|P',
      '0130|EG',
    ]);
  });
});
