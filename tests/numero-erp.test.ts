import { describe, it, expect } from 'vitest';
import {
  normalizarNumeroErp,
  numeroErpValido,
  lerNumeroErp,
  proximoNumeroErp,
  seguemAOrdem,
} from '@csb/shared';

/**
 * O número do pedido no Control: duas letras e a numeração ("SX14627"). Quem
 * cunha é o ERP; o app guarda, sugere o próximo e avisa quando sai da ordem.
 */
describe('número do pedido no Control', () => {
  it('reconhece o padrão da fábrica, limpando espaço e caixa', () => {
    expect(numeroErpValido('SX14627')).toBe(true);
    expect(numeroErpValido('sx 14627')).toBe(true);
    expect(numeroErpValido('CS-14627')).toBe(true);
    expect(numeroErpValido('14627')).toBe(false); // sem as letras
    expect(numeroErpValido('SXA14627')).toBe(false); // três letras
    expect(numeroErpValido('')).toBe(false);
    expect(normalizarNumeroErp(' sx 14627 ')).toBe('SX14627');
    expect(lerNumeroErp('SX14627')).toEqual({ prefixo: 'SX', numero: 14627 });
  });

  it('sugere o próximo da sequência, guardando os zeros à esquerda', () => {
    expect(proximoNumeroErp('SX14627')).toBe('SX14628');
    expect(proximoNumeroErp('SX00099')).toBe('SX00100');
    expect(proximoNumeroErp(null)).toBe('');
    expect(proximoNumeroErp('rabisco')).toBe('');
  });

  it('avisa quando o digitado anda para trás — e cala quando não dá para comparar', () => {
    expect(seguemAOrdem('SX14627', 'SX14628')).toBe(true);
    expect(seguemAOrdem('SX14627', 'SX14627')).toBe(false);
    expect(seguemAOrdem('SX14627', 'SX14600')).toBe(false);
    expect(seguemAOrdem('SX14627', 'CS14628')).toBeNull(); // outra série
    expect(seguemAOrdem(null, 'SX14628')).toBeNull();
  });
});
