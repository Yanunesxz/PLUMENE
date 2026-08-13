import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { preencherModelo } from '../apps/web/src/lib/planilha/modeloOficial.js';
import type { LinhaDaPlanilha } from '../apps/web/src/lib/planilha/linhas.js';

/**
 * O desconto do pedido no formulário oficial.
 *
 * O rodapé do formulário do Control é uma conta em três degraus, e ele já vinha
 * pronto para receber desconto — só estava sempre zerado:
 *
 *     AB45  Valor Parcial   =SUM(AB13:AB44)
 *     AB46  DESC  %         (entrada — FRAÇÃO: 0,1 é 10%)
 *     AB47                  =AB45*AB46
 *     AB48  TOTAL           =AB45-AB47
 *
 * Duas armadilhas que estes testes trancam:
 *
 *   1. AB46 é FRAÇÃO, não percentual. Escrever 10 para "10%" daria dez vezes o
 *      valor do pedido de desconto e o total sairia negativo.
 *   2. O Control lê o VALOR guardado da célula, não recalcula a fórmula. Se só
 *      a taxa fosse gravada, AB47 e AB48 continuariam com o cache antigo e a
 *      fábrica importaria o total sem desconto.
 *
 * O preço unitário NÃO muda: a fábrica quer ver o desconto declarado, com a
 * coluna UNIT no preço de tabela.
 */

const MODELO = join(
  process.cwd(),
  'apps',
  'web',
  'public',
  'modelos',
  'pedido-cs-1.xlsx',
);

const linha = (unit: number, pecas: number): LinhaDaPlanilha => ({
  ref: '0015',
  sistema: 'letras',
  quantidades: { M: pecas },
  pecas,
  unit_price: unit,
});

/** Lê o valor em cache de uma célula do arquivo gerado. */
function valorDaCelula(arquivo: Uint8Array, ref: string): number | null {
  const sheet = new TextDecoder().decode(unzipSync(arquivo)['xl/worksheets/sheet1.xml']!);
  const m = sheet.match(new RegExp(`<c r="${ref}"[^>]*>[\\s\\S]*?<v>([^<]*)</v>`));
  return m ? Number(m[1]) : null;
}

const modelo = new Uint8Array(readFileSync(MODELO));
// 10 peças a R$ 100 = R$ 1.000 de valor parcial.
const LINHAS = [linha(100, 10)];

describe('o desconto no formulário do Control', () => {
  it('sem desconto, o total fecha no parcial — como sempre foi', () => {
    const { arquivo } = preencherModelo(modelo, { linhas: LINHAS });
    expect(valorDaCelula(arquivo, 'AB45')).toBe(1000);
    expect(valorDaCelula(arquivo, 'AB46')).toBe(0);
    expect(valorDaCelula(arquivo, 'AB47')).toBe(0);
    expect(valorDaCelula(arquivo, 'AB48')).toBe(1000);
  });

  it('grava a taxa em FRAÇÃO — 10% vira 0,1, não 10', () => {
    const { arquivo } = preencherModelo(modelo, { linhas: LINHAS, descontoPercentual: 10 });
    // Se saísse 10, o desconto seria AB45*10 = R$ 10.000 num pedido de R$ 1.000.
    expect(valorDaCelula(arquivo, 'AB46')).toBeCloseTo(0.1, 6);
  });

  it('grava o valor do desconto e o total já calculados, sem depender do Excel', () => {
    const { arquivo } = preencherModelo(modelo, { linhas: LINHAS, descontoPercentual: 10 });
    expect(valorDaCelula(arquivo, 'AB47')).toBe(100);
    expect(valorDaCelula(arquivo, 'AB48')).toBe(900);
  });

  it('o total bate com a fórmula do formulário: parcial − (parcial × taxa)', () => {
    for (const pct of [0, 5, 7.5, 10, 15, 20, 33.33]) {
      const { arquivo } = preencherModelo(modelo, { linhas: LINHAS, descontoPercentual: pct });
      const parcial = valorDaCelula(arquivo, 'AB45')!;
      const taxa = valorDaCelula(arquivo, 'AB46')!;
      const desconto = valorDaCelula(arquivo, 'AB47')!;
      const total = valorDaCelula(arquivo, 'AB48')!;
      expect(desconto).toBeCloseTo(parcial * taxa, 2);
      expect(total).toBeCloseTo(parcial - desconto, 2);
    }
  });

  it('aceita meio ponto — 7,5% é desconto comum e arredondar mudaria o combinado', () => {
    const { arquivo } = preencherModelo(modelo, { linhas: LINHAS, descontoPercentual: 7.5 });
    expect(valorDaCelula(arquivo, 'AB47')).toBe(75);
    expect(valorDaCelula(arquivo, 'AB48')).toBe(925);
  });

  it('NÃO mexe no preço unitário — a fábrica vê o preço de tabela e o desconto à parte', () => {
    const { arquivo } = preencherModelo(modelo, { linhas: LINHAS, descontoPercentual: 20 });
    // AB13 é o total da primeira linha de item: 10 peças × R$ 100, sem desconto.
    expect(valorDaCelula(arquivo, 'AB13')).toBe(1000);
    expect(valorDaCelula(arquivo, 'AB48')).toBe(800);
  });

  it('desconto de 100% zera o total sem quebrar a conta', () => {
    const { arquivo } = preencherModelo(modelo, { linhas: LINHAS, descontoPercentual: 100 });
    expect(valorDaCelula(arquivo, 'AB47')).toBe(1000);
    expect(valorDaCelula(arquivo, 'AB48')).toBe(0);
  });
});
