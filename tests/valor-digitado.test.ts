import { describe, it, expect } from 'vitest';
import { lerValorDigitado } from '../apps/web/src/lib/valorDigitado.js';

/**
 * A meta de bonificação como as pessoas digitam (Yan, 19/10/2026: "a meta de
 * 50K não está gerando gráfico e nem salvando a meta").
 */
describe('lerValorDigitado', () => {
  it('lê os jeitos comuns de escrever 50 mil', () => {
    for (const t of ['50000', '50.000', '50k', '50K', '50 mil', 'R$ 50.000,00', ' 50.000 ']) {
      expect(lerValorDigitado(t), t).toBe(50_000);
    }
  });

  it('decimal com vírgula e milhar com ponto', () => {
    expect(lerValorDigitado('1.500,50')).toBe(1500.5);
    expect(lerValorDigitado('1.500.000')).toBe(1_500_000);
    expect(lerValorDigitado('2,5k')).toBe(2500);
    expect(lerValorDigitado('500')).toBe(500);
  });

  it('vazio ou ilegível é null — a tela avisa em vez de sumir com a faixa', () => {
    expect(lerValorDigitado('')).toBeNull();
    expect(lerValorDigitado('   ')).toBeNull();
    expect(lerValorDigitado('cinquenta')).toBeNull();
    expect(lerValorDigitado('50.00.0')).toBeNull();
  });
});
