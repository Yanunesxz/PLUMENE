import { describe, it, expect } from 'vitest';
import { normalizarCodigoErp, mesmoCodigoErp } from '../apps/web/src/lib/codigoErp.js';

/**
 * A ponte do CRM com este app: o CSP 360 manda `?busca=<código do ERP>` e as
 * listas de /representantes e /customers abrem filtradas nesse código. É a
 * única peça que os dois sistemas compartilham — se a regra escorregar, o link
 * para de achar o registro CALADO (não dá erro, só não encontra). Por isso os
 * casos abaixo são o contrato, não um detalhe de implementação.
 */
describe('código do cadastro no Control (ponte CRM → app)', () => {
  it('ignora zeros à esquerda dos DOIS lados — é o mesmo cadastro', () => {
    expect(mesmoCodigoErp('00779', '779')).toBe(true); // Control preenchido, CRM não
    expect(mesmoCodigoErp('779', '00779')).toBe(true); // e o contrário também
    expect(mesmoCodigoErp('00779', '00779')).toBe(true);
    expect(mesmoCodigoErp('779', '779')).toBe(true);
    expect(normalizarCodigoErp('00779')).toBe('779');
  });

  it('compara EXATO: prefixo não casa, senão o link arrastaria meia lista', () => {
    expect(mesmoCodigoErp('779', '7')).toBe(false);
    expect(mesmoCodigoErp('7', '779')).toBe(false);
    expect(mesmoCodigoErp('779', '7790')).toBe(false);
    expect(mesmoCodigoErp('1234', '234')).toBe(false); // não é zero à esquerda
  });

  it('não se perde com espaço nas pontas nem com a caixa da letra', () => {
    expect(mesmoCodigoErp('  00779  ', ' 779 ')).toBe(true);
    expect(mesmoCodigoErp('\t779\n', '779')).toBe(true);
    expect(mesmoCodigoErp('CS779', 'cs779')).toBe(true); // há código com letra
    expect(normalizarCodigoErp(' 00779 ')).toBe('779');
  });

  it('código vazio ou nulo NUNCA casa — nem com outro vazio', () => {
    // Cadastro ainda não atrelado ao Control não pode virar resultado de um
    // link em branco: a lista inteira responderia à busca.
    expect(mesmoCodigoErp(null, '779')).toBe(false);
    expect(mesmoCodigoErp(undefined, '779')).toBe(false);
    expect(mesmoCodigoErp('', '779')).toBe(false);
    expect(mesmoCodigoErp('00779', null)).toBe(false);
    expect(mesmoCodigoErp('00779', undefined)).toBe(false);
    expect(mesmoCodigoErp('00779', '')).toBe(false);
    expect(mesmoCodigoErp('', '')).toBe(false);
    expect(mesmoCodigoErp('   ', '  ')).toBe(false);
    expect(mesmoCodigoErp(null, null)).toBe(false);
    // "0" e "000" viram vazio ao tirar os zeros: não é código de verdade.
    expect(mesmoCodigoErp('0', '0')).toBe(false);
    expect(mesmoCodigoErp('000', '0')).toBe(false);
    expect(normalizarCodigoErp(null)).toBe('');
    expect(normalizarCodigoErp('0')).toBe('');
  });
});
