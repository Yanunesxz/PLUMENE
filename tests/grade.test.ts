import { describe, it, expect } from 'vitest';
import { compararTamanho, ordenarGrade } from '../apps/web/src/components/comercial/grade.js';
import type { CatalogVariant } from '@csb/shared';

/**
 * Ordem da grade. A fábrica manda tamanho como texto ("P", "10", "EG"), e sem
 * ordenação a lista sai alfabética: "10, 12, 8" e "EG, G, GG, M, P". Numa tela
 * de venda isso custa tempo do representante a cada produto.
 */

const v = (size: string): CatalogVariant => ({ id: size, size, in_stock: true });

describe('ordem dos tamanhos', () => {
  it('põe a grade adulta em ordem de corpo, não alfabética', () => {
    const ordem = ordenarGrade(['GG', 'P', 'EG', 'M', 'PP', 'G'].map(v)).map((x) => x.size);
    expect(ordem).toEqual(['PP', 'P', 'M', 'G', 'GG', 'EG']);
  });

  it('ordena grade numérica por número, não por texto', () => {
    const ordem = ordenarGrade(['10', '2', '12', '8', '4'].map(v)).map((x) => x.size);
    expect(ordem).toEqual(['2', '4', '8', '10', '12']);
  });

  it('trata zero à esquerda como número (a fábrica manda "01", "02")', () => {
    const ordem = ordenarGrade(['08', '01', '10', '02'].map(v)).map((x) => x.size);
    expect(ordem).toEqual(['01', '02', '08', '10']);
  });

  it('joga tamanho desconhecido para depois dos conhecidos', () => {
    const ordem = ordenarGrade(['LD', 'M', 'P'].map(v)).map((x) => x.size);
    expect(ordem).toEqual(['P', 'M', 'LD']);
  });

  it('aceita minúsculas', () => {
    expect(compararTamanho('p', 'g')).toBeLessThan(0);
  });

  it('não altera o array recebido', () => {
    const original = ['G', 'P'].map(v);
    ordenarGrade(original);
    expect(original.map((x) => x.size)).toEqual(['G', 'P']);
  });
});
