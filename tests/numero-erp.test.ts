import { describe, it, expect } from 'vitest';
import {
  normalizarNumeroErp,
  numeroErpValido,
  lerNumeroErp,
  proximoNumeroErp,
  seguemAOrdem,
} from '@csb/shared';

/**
 * O número do pedido no Control: duas letras e a numeração ("CS17379" na
 * Corpo Sensual, "PL02672" na PLUMENE; a série SX foi descontinuada em
 * 16/09/2026). Quem cunha é o ERP; o app guarda, sugere o próximo e avisa
 * quando sai da ordem.
 */
describe('número do pedido no Control', () => {
  it('reconhece o padrão da fábrica, limpando espaço e caixa', () => {
    expect(numeroErpValido('CS17379')).toBe(true);
    expect(numeroErpValido('pl 02672')).toBe(true);
    expect(numeroErpValido('CS-14627')).toBe(true);
    expect(numeroErpValido('14627')).toBe(false); // sem as letras
    expect(numeroErpValido('CSA17379')).toBe(false); // três letras
    expect(numeroErpValido('')).toBe(false);
    expect(normalizarNumeroErp(' cs 17379 ')).toBe('CS17379');
    expect(lerNumeroErp('CS17379')).toEqual({ prefixo: 'CS', numero: 17379 });
  });

  it('sugere o próximo da sequência, guardando os zeros à esquerda', () => {
    expect(proximoNumeroErp('CS17379')).toBe('CS17380');
    expect(proximoNumeroErp('PL00099')).toBe('PL00100');
    expect(proximoNumeroErp(null)).toBe('');
    expect(proximoNumeroErp('rabisco')).toBe('');
  });

  it('avisa quando o digitado anda para trás — e cala quando não dá para comparar', () => {
    expect(seguemAOrdem('CS17379', 'CS17380')).toBe(true);
    expect(seguemAOrdem('CS17379', 'CS17379')).toBe(false);
    expect(seguemAOrdem('CS17379', 'CS17300')).toBe(false);
    expect(seguemAOrdem('CS17379', 'PL17380')).toBeNull(); // outra série
    expect(seguemAOrdem(null, 'CS17380')).toBeNull();
  });
});
