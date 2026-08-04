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
    expect(nomeDaCor('#DA0769')).toBe('pink');
    expect(nomeDaCor('#D15D8B')).toBe('pink');
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

  it('chama de oliva o cáqui do moletinho, e de verde o verde de verdade', () => {
    // O cáqui tem croma quase nenhum: sem a exceção ele cai no balaio do cinza.
    expect(nomeDaCor('#847F67')).toBe('oliva');
    // E o verde fechado é verde — chamá-lo de oliva ao lado do cáqui confundia.
    expect(nomeDaCor('#2C3421')).toBe('verde escuro');
    expect(nomeDaCor('#A1B2A7')).toBe('verde acinzentado');
  });

  it('não confunde o mescla quente com rosa', () => {
    // #B59E9E é o cinza do moletom listrado; a 0,12 de saturação saía "rosa".
    expect(nomeDaCor('#B59E9E')).toBe('cinza');
  });
});

/** Uma opção do catálogo, no formato que o extrator devolve. */
const opcao = (codigo: string, hex: string | null, extra = {}) => ({
  codigo,
  hex,
  hex_par: null,
  estampa: false,
  estampa_par: null,
  selo: null,
  badge: false,
  ordem: 0,
  ...extra,
});
const selo = (codigo: string, tipo: 'variadas' | 'unica') =>
  opcao(codigo, null, { selo: tipo, badge: true });

describe('regras de rotulagem do catálogo', () => {
  it('produto com uma cor só se chama "Cor única"', () => {
    const r = montarCores([opcao('01', '#243652')]);
    expect(r).toHaveLength(1);
    expect(r[0].nome).toBe('Cor única');
  });

  it('produto cuja única bolinha é a VARIADAS vira "Cores variadas"', () => {
    const r = montarCores([selo('VAR', 'variadas')]);
    expect(r[0].nome).toBe('Cores variadas');
  });

  it('em grade com várias cores, a bolinha rotulada é "Variadas" — nunca "sortidas"', () => {
    const r = montarCores([
      opcao('01', '#243652'),
      opcao('02', '#847F67'),
      selo('03', 'variadas'),
    ]);
    expect(r.map((c) => c.nome)).toEqual(['azul marinho', 'oliva', 'Variadas']);
    expect(JSON.stringify(r).toLowerCase()).not.toContain('sortid');
  });

  it('não inventa Variadas onde o catálogo não rotulou', () => {
    const r = montarCores([opcao('01', '#243652'), opcao('02', '#847F67')]);
    expect(r.some((c) => c.variadas)).toBe(false);
    expect(r.map((c) => c.nome)).toEqual(['azul marinho', 'oliva']);
  });

  it('a bolinha-selo não guarda hex — o cinza dela no papel é decorativo', () => {
    const r = montarCores([opcao('01', '#243652'), selo('02', 'variadas')]);
    expect(r[1].hex).toBeNull();
  });
});

describe('a cor do catálogo são DUAS bolinhas', () => {
  it('quem batiza a opção é o liso, não a estampa', () => {
    // 0800: rosa liso + listrado. A média do listrado é um cinza sujo que não
    // descreve peça nenhuma — quem nomeia é a bolinha lisa.
    const r = montarCores([
      opcao('01', '#B59BB7', { hex_par: '#D793B8', estampa: true }),
      opcao('02', '#4B62AB', { hex_par: '#9183A1', estampa: false }),
    ]);
    expect(r[0].nome).toBe('pink');
    expect(r[0].hex).toBe('#D793B8'); // a bolinha da tela é a que dá o nome
    expect(r[0].hex_par).toBe('#B59BB7');
    expect(r[0].estampa).toBe(true);
  });

  it('duas opções nunca saem com o mesmo nome dentro do produto', () => {
    // 0760: as opções 01 e 04 têm a MESMA bolinha da frente e só se distinguem
    // pela de trás. A observação do pedido leva só o nome — "rosa" duas vezes
    // não diz à fábrica qual peça separar.
    const r = montarCores([
      opcao('01', '#E998B1', { hex_par: '#7DCAD3' }),
      opcao('02', '#2E5881'),
      opcao('03', '#E43942'),
      opcao('04', '#E998B1', { hex_par: '#19408C' }),
    ]);
    const nomes = r.map((c) => c.nome);
    expect(new Set(nomes).size).toBe(nomes.length);
    expect(nomes[0]).toContain('turquesa');
    expect(nomes[3]).toContain('azul');
  });

  it('quando o par não desempata, separa a família por tom', () => {
    const r = montarCores([
      opcao('01', '#726D6B'),
      opcao('02', '#A1B2A7'),
      opcao('03', '#CFCECB'),
      opcao('04', '#B4B2B0'),
    ]);
    const nomes = r.map((c) => c.nome);
    expect(new Set(nomes).size).toBe(nomes.length);
  });
});
