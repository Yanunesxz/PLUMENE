import { describe, it, expect } from 'vitest';
import { segmentoDoProduto, SEGMENTOS } from '../apps/web/src/modules/catalogo/PaginaCatalogo.js';

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

describe('nome sem gênero = feminino', () => {
  /**
   * A fábrica só escreve o gênero quando a peça é masculina. Os nomes abaixo
   * são os 21 que antes ficavam fora dos quatro filtros: cada um foi conferido
   * na foto do catálogo, e todos são femininos. Se a regra mudar e algum deles
   * sair de "feminino", é regressão — some do catálogo do jeito que sumiu antes.
   */
  it('pijama adulto genérico', () => {
    expect(seg('PIJAMA REGATA LIGANETE')).toBe('feminino');
    expect(seg('PIJAMA MANGA CURTA COM CALÇA LIGANETE')).toBe('feminino');
    expect(seg('PIJAMA ABERTO LIGANETE')).toBe('feminino');
    expect(seg('PIJAMA AMERICANO LISO')).toBe('feminino');
    expect(seg('PIJAMA AMERICANO CURTO')).toBe('feminino');
    expect(seg('PIJAMA REGATA RENDA')).toBe('feminino');
    expect(seg('PIJAMA REGATA PESCADOR')).toBe('feminino');
    expect(seg('PIJAMA DE CALÇA CANELADO LISO')).toBe('feminino');
  });

  it('peça que só existe na linha feminina', () => {
    expect(seg('CAMISOLA DE ALÇA')).toBe('feminino');
    expect(seg('SHORT DOLL REGATA MALHA')).toBe('feminino');
    expect(seg('ROBE DE SEDA')).toBe('feminino');
    expect(seg('CAMISÃO AMERICANO LISO VISCOLYCRA')).toBe('feminino');
  });

  it('CONJUNTO SHORT TEEN é juvenil feminino — a grade 10-16 e a foto confirmam', () => {
    expect(seg('CONJUNTO SHORT TEEN')).toBe('infantil_feminino');
  });
});

describe('nenhuma peça fica fora dos filtros', () => {
  const chaves = SEGMENTOS.map((s) => s.key);

  it('todo nome cai em um dos quatro', () => {
    const nomes = [
      'PIJAMA LD ADULTO',
      'PIJAMA LONGO MOLETINHO ESTAMPADO',
      'CONJUNTO SHORT TEEN',
      'PIJAMA FAMÍLIA MASCULINO',
      'PIJAMA FAMÍLIA INFANTIL FEMININO',
      '',
    ];
    for (const nome of nomes) expect(chaves).toContain(seg(nome));
  });

  it('as referências sem foto continuam encontráveis — foi o que sumiu antes', () => {
    expect(seg('PIJAMA FAMÍLIA MASCULINO')).toBe('masculino');
    expect(seg('PIJAMA FAMÍLIA INFANTIL MASCULINO')).toBe('infantil_masculino');
    expect(seg('PIJAMA FAMÍLIA JUVENIL MASCULINO')).toBe('infantil_masculino');
    expect(seg('PIJAMA LONGO FAMILIA INFANTIL MASCULINO')).toBe('infantil_masculino');
    expect(seg('PIJAMA DE ALÇA SUEDE FEMININO')).toBe('feminino');
  });
});
