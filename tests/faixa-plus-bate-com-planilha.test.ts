import { describe, it, expect } from 'vitest';
import { faixaDoTamanho } from '@csb/shared';
import { celulaDoTamanho, COLUNAS_PLUS } from '../apps/web/src/lib/planilha/colunas.js';

/**
 * A faixa PLUS tem DUAS definições no código, e elas precisam concordar.
 *
 *   1. `pricing/faixaDeTamanho.ts` (shared) — quais tamanhos custam o preço
 *      maior da tabela da fábrica. Decide dinheiro.
 *   2. `planilha/colunas.ts` (web) — quais COLUNAS do formulário oficial são a
 *      faixa PLUS (Q→T). Decide em que linha a peça sai para o Control.
 *
 * As duas nasceram separadas, de trabalhos diferentes, e descrevem a mesma
 * coisa: o corpo maior, que no Control é outro produto ("0130 PLUS") e na
 * tabela é outro preço.
 *
 * Se divergirem, o erro é SILENCIOSO e caro: uma peça cobrada pelo preço normal
 * saindo na linha PLUS da planilha — ou o contrário, faturada mais cara e
 * importada como base. Ninguém repara até a fábrica reclamar.
 *
 * Este teste não escolhe uma das duas como dona; ele só exige que continuem
 * dizendo a mesma coisa. Quem mexer numa e esquecer a outra quebra aqui.
 */

/** Todo tamanho que qualquer uma das duas definições conhece. */
const TAMANHOS = [
  // grade adulta em letras
  'PP', 'P', 'M', 'G', 'GG', 'XG', 'XG2', 'XG3', 'XG4', 'EG', 'EGG', 'EGGG',
  // grade adulta numérica
  '36', '38', '40', '42', '44', '46', '48', '50', '52', '54',
  // infantil e juvenil
  '2', '4', '6', '8', '10', '12', '14', '16',
  // como a fábrica às vezes manda
  '02', '04', '06', '08',
];

/** A peça cai na faixa PLUS do formulário? (colunas Q→T) */
function ehColunaPlus(size: string): boolean {
  const celula = celulaDoTamanho(size);
  return !!celula && COLUNAS_PLUS.has(celula.coluna);
}

describe('as duas definições de faixa PLUS concordam', () => {
  it.each(TAMANHOS)('%s cai do mesmo lado nas duas', (size) => {
    expect(faixaDoTamanho(size) === 'maior').toBe(ehColunaPlus(size));
  });

  it('o conjunto inteiro bate, não só tamanho a tamanho', () => {
    const porPreco = TAMANHOS.filter((t) => faixaDoTamanho(t) === 'maior').sort();
    const porColuna = TAMANHOS.filter(ehColunaPlus).sort();
    expect(porPreco).toEqual(porColuna);
  });

  it('e não é vazio dos dois lados — isso passaria sem provar nada', () => {
    expect(TAMANHOS.filter((t) => faixaDoTamanho(t) === 'maior').length).toBeGreaterThan(0);
  });

  it('a grade numérica normal (36-46) fica FORA — plus é 48 em diante', () => {
    for (const t of ['36', '38', '40', '42', '44', '46']) {
      expect(faixaDoTamanho(t)).toBe('normal');
      expect(ehColunaPlus(t)).toBe(false);
    }
  });
});
