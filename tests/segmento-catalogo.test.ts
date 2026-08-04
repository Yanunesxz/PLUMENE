import { describe, it, expect } from 'vitest';
import { segmentoDoProduto } from '../apps/web/src/modules/catalogo/PaginaCatalogo.js';

/**
 * Filtros de segmento do catálogo (Feminino / Masculino / Infantil-Juvenil).
 *
 * O ERP não tem campo de gênero — `group_name` lá é o TIPO da peça (camisola,
 * short doll, pijama, robe). Quem diz o público é o nome do produto, como no
 * catálogo impresso. Estes testes usam nomes reais da base para que uma futura
 * "melhoria" na regra não tire peça do filtro errado.
 */

const seg = (name: string) => segmentoDoProduto({ name });

describe('gênero escrito no nome', () => {
  it('adulto feminino e masculino', () => {
    expect(seg('PIJAMA LONGO MALHA FEMININO')).toBe('feminino');
    expect(seg('PIJAMA LONGO LAÇO FEMININO ADULTO')).toBe('feminino');
    expect(seg('SHORT DE MALHA MASCULINO')).toBe('masculino');
    expect(seg('PIJAMA LIGANETE MASCULINO')).toBe('masculino');
  });

  it('abreviação do catálogo (Fem. / Masc.)', () => {
    expect(seg('PIJAMA JUVENIL ALÇA FEM.')).toBe('infantil_feminino');
    expect(seg('PIJAMA REGATA INFANTIL MASC.')).toBe('infantil_masculino');
  });

  it('infantil e juvenil caem no mesmo filtro', () => {
    expect(seg('PIJAMA LONGO MALHA INFANTIL FEM.')).toBe('infantil_feminino');
    expect(seg('PIJAMA LONGO MOLETINHO JUVENIL FEM.')).toBe('infantil_feminino');
    expect(seg('PIJAMA FAMÍLIA JUVENIL MASC.')).toBe('infantil_masculino');
  });

  it('"mescla" não vira masculino', () => {
    expect(seg('PIJAMA MESCLA MASCULINO')).toBe('masculino');
    expect(seg('CAMISOLA REGATA MESCLA')).toBe('feminino');
  });
});

describe('peça que só existe na linha feminina', () => {
  it('classifica sem o gênero estar escrito', () => {
    expect(seg('CAMISOLA DE ALÇA')).toBe('feminino');
    expect(seg('SHORT DOLL REGATA MALHA')).toBe('feminino');
    expect(seg('ROBE DE SEDA')).toBe('feminino');
    expect(seg('CAMISÃO AMERICANO LISO VISCOLYCRA')).toBe('feminino');
    expect(seg('CAMISOLA GESTANTE LIGANETE')).toBe('feminino');
    expect(seg('VESTIDO SUEDE CANELADO')).toBe('feminino');
  });

  it('respeita infantil na peça feminina', () => {
    expect(seg('*PROM* SHORT DOLL DE ALÇA INFANTIL')).toBe('infantil_feminino');
  });

  it('o gênero escrito vence o tipo da peça', () => {
    expect(seg('*PROM* SHORT DOLL ALÇA MALHA ONÇA INFANTIL FEM.')).toBe('infantil_feminino');
  });
});

describe('o que não dá para afirmar fica de fora dos filtros', () => {
  it('tecido não é pista de gênero — há pijama de liganete masculino', () => {
    expect(seg('PIJAMA REGATA LIGANETE')).toBeNull();
    expect(seg('PIJAMA AMERICANO LISO')).toBeNull();
    expect(seg('PIJAMA LD ADULTO')).toBeNull();
  });

  it('pijama de família traz os dois gêneros', () => {
    expect(seg('PIJAMA FAMILIA FEM. E MASC.')).toBeNull();
  });
});
