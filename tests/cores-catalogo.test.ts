import { describe, it, expect } from 'vitest';
import { nomeDaCor, montarCores } from '../_tools/catalogo-cores/cores.mjs';

/**
 * Nome da cor a partir do hex da bolinha do catálogo.
 *
 * O catálogo dá número e bolinha, nunca nome. O número é o que a fábrica confere
 * na separação; o nome é para o lojista dizer "quero 3 na azul". Um nome
 * grosseiramente errado ("vermelho" para uma peça rosa) gera discussão no
 * WhatsApp que o número resolveria.
 */
describe('nome da cor pelo hex', () => {
  it('não chama rosa forte de vermelho', () => {
    // Caso real do catálogo: a distância em RGB classificava como "vermelho".
    expect(nomeDaCor('#DA0769')).toBe('rosa');
    expect(nomeDaCor('#D15D8B')).toBe('rosa');
  });

  it('reconhece o azul marinho, que é a cor mais comum da grade', () => {
    expect(nomeDaCor('#243652')).toBe('azul marinho');
    expect(nomeDaCor('#162947')).toBe('azul marinho');
  });

  it('separa neutro de colorido pela saturação, não pelo tom', () => {
    expect(nomeDaCor('#000000')).toBe('preto');
    expect(nomeDaCor('#FFFFFF')).toBe('branco');
    expect(nomeDaCor('#8E8E8D')).toBe('cinza');
  });

  it('trata marrom e nude, que no catálogo são laranja escuro e dessaturado', () => {
    expect(nomeDaCor('#7D5444')).toBe('marrom');
    expect(nomeDaCor('#825746')).toBe('marrom');
    expect(nomeDaCor('#D9B5A1')).toBe('nude');
  });

  it('não chama de vermelho um tom claro — o pijama rosa é o caso comum', () => {
    // #E0858E e #E0A198 ficam na fronteira rosa/salmão; o que não pode é
    // qualquer um dos dois sair como "vermelho".
    expect(['rosa', 'salmão']).toContain(nomeDaCor('#E0858E'));
    expect(['rosa', 'salmão']).toContain(nomeDaCor('#E0A198'));
  });

  it('chama de oliva o verde acinzentado do moletinho', () => {
    expect(nomeDaCor('#847F67')).toBe('oliva');
  });
});

describe('regras de rotulagem do catálogo', () => {
  it('produto com uma cor só se chama "Cor única"', () => {
    const r = montarCores([{ codigo: '01', hex: '#243652', variadas: false, ordem: 0 }]);
    expect(r).toHaveLength(1);
    expect(r[0].nome).toBe('Cor única');
  });

  it('produto cuja única bolinha é a VARIADAS vira "Cores variadas"', () => {
    const r = montarCores([{ codigo: '01', hex: null, variadas: true, ordem: 0 }]);
    expect(r[0].nome).toBe('Cores variadas');
  });

  it('em grade com várias cores, a bolinha rotulada é "Variadas" — nunca "sortidas"', () => {
    const r = montarCores([
      { codigo: '01', hex: '#243652', variadas: false, ordem: 0 },
      { codigo: '02', hex: '#847F67', variadas: false, ordem: 1 },
      { codigo: '03', hex: '#8E8E8D', variadas: true, ordem: 2 },
    ]);
    expect(r.map((c) => c.nome)).toEqual(['azul marinho', 'oliva', 'Variadas']);
    expect(JSON.stringify(r).toLowerCase()).not.toContain('sortid');
  });

  it('não inventa Variadas onde o catálogo não rotulou', () => {
    const r = montarCores([
      { codigo: '01', hex: '#243652', variadas: false, ordem: 0 },
      { codigo: '02', hex: '#847F67', variadas: false, ordem: 1 },
    ]);
    expect(r.some((c) => c.variadas)).toBe(false);
    expect(r.map((c) => c.nome)).toEqual(['azul marinho', 'oliva']);
  });

  it('a bolinha VARIADAS não guarda hex — a cor dela não significa nada', () => {
    const r = montarCores([
      { codigo: '01', hex: '#243652', variadas: false, ordem: 0 },
      { codigo: '02', hex: '#8E8E8D', variadas: true, ordem: 1 },
    ]);
    expect(r[1].hex).toBeNull();
  });
});
