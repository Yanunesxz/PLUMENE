import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { celulaDoTamanho, refDaPlanilha } from '../apps/web/src/lib/planilha/colunas.js';
import {
  montarLinhas,
  dividirEmFolhas,
  LINHAS_POR_FOLHA,
  type ItemParaPlanilha,
} from '../apps/web/src/lib/planilha/linhas.js';
import { preencherModelo } from '../apps/web/src/lib/planilha/modeloOficial.js';

/**
 * A planilha que vai para o Control.
 *
 * O Control importa pedido num layout só, e não perdoa: coluna trocada vira
 * tamanho errado na fábrica, referência fora da Plan2 vira pedido sem preço, e
 * uma 33ª linha simplesmente não existe. Estes testes seguram as três coisas —
 * e a última delas, que é a mais fácil de quebrar sem perceber: o arquivo tem de
 * sair com a MESMA estrutura com que entrou.
 */

const MODELO = path.resolve(
  __dirname,
  '../apps/web/public/modelos/pedido-cs-1.xlsx',
);

const item = (
  sku: string,
  size: string,
  quantity: number,
  unit_price = 43.9,
): ItemParaPlanilha => ({ sku, size, quantity, unit_price });

describe('tamanho → coluna', () => {
  it('põe a grade de letras em L→T', () => {
    expect(celulaDoTamanho('PP')).toEqual({ sistema: 'letras', coluna: 'L' });
    expect(celulaDoTamanho('GG')).toEqual({ sistema: 'letras', coluna: 'P' });
    expect(celulaDoTamanho('XG4')).toEqual({ sistema: 'letras', coluna: 'T' });
  });

  it('entende EG/EGG/EGGG como os XG da planilha', () => {
    expect(celulaDoTamanho('EG')?.coluna).toBe(celulaDoTamanho('XG')?.coluna);
    expect(celulaDoTamanho('EGG')?.coluna).toBe(celulaDoTamanho('XG2')?.coluna);
  });

  it('põe a grade plus (48→54) nas mesmas colunas dos XG, mas em outro sistema', () => {
    expect(celulaDoTamanho('48')).toEqual({ sistema: 'numerica', coluna: 'Q' });
    expect(celulaDoTamanho('54')).toEqual({ sistema: 'numerica', coluna: 'T' });
    // A colisão de coluna é justamente o motivo de a linha não poder misturar.
    expect(celulaDoTamanho('48')?.coluna).toBe(celulaDoTamanho('XG')?.coluna);
  });

  it('separa infantil de juvenil', () => {
    expect(celulaDoTamanho('2')).toEqual({ sistema: 'infantil', coluna: 'M' });
    expect(celulaDoTamanho('16')).toEqual({ sistema: 'juvenil', coluna: 'X' });
  });

  it('trata zero à esquerda como número, que é como a fábrica manda', () => {
    expect(celulaDoTamanho('08')).toEqual(celulaDoTamanho('8'));
  });

  it('devolve null para tamanho que não existe na planilha', () => {
    expect(celulaDoTamanho('U')).toBeNull();
    expect(celulaDoTamanho('LD')).toBeNull();
  });
});

describe('referência como a planilha escreve', () => {
  it('tira o zero da frente e o E do fim', () => {
    // A Plan2 tem "130" (numero, R$ 43,90) e "0130E" (texto, R$ 53,90). O preço
    // do sistema é 43,90 — vale a primeira. E o Control respondeu
    // "NÃO ENCONTRADO!!!" quando o arquivo saiu com 0130E.
    expect(refDaPlanilha('0130')).toBe('130');
    expect(refDaPlanilha('130')).toBe('130');
    expect(refDaPlanilha('0130E')).toBe('130');
    expect(refDaPlanilha('4131')).toBe('4131');
  });

  it('não inventa nada quando o SKU não é numérico', () => {
    expect(refDaPlanilha('PIJ001')).toBe('PIJ001');
  });
});

describe('linhas do pedido', () => {
  it('junta os tamanhos da mesma referência numa linha só', () => {
    const { linhas } = montarLinhas([item('0130', 'P', 2), item('0130', 'M', 3)]);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]?.quantidades).toEqual({ M: 2, N: 3 });
    expect(linhas[0]?.pecas).toBe(5);
  });

  it('gasta DUAS linhas quando a referência pega letras e plus', () => {
    // O caso do Yan: "0130 quero 3M e 3 plus" tem de virar duas linhas.
    const { linhas } = montarLinhas([item('0130', 'M', 3), item('0130', '52', 3)]);
    expect(linhas).toHaveLength(2);
    expect(linhas.map((l) => l.ref)).toEqual(['130', '130']);
    expect(linhas.map((l) => l.sistema)).toEqual(['letras', 'numerica']);
  });

  it('soma 44 e 46 na coluna única "44/46"', () => {
    const { linhas } = montarLinhas([item('0703', '44', 2), item('0703', '46', 1)]);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]?.quantidades).toEqual({ P: 3 });
  });

  it('não deixa item sumir calado quando o tamanho não cabe', () => {
    const { linhas, foraDaGrade } = montarLinhas([item('0130', 'U', 4)]);
    expect(linhas).toHaveLength(0);
    expect(foraDaGrade).toEqual([{ sku: '0130', size: 'U', quantity: 4 }]);
  });

  it('ignora quantidade zero', () => {
    expect(montarLinhas([item('0130', 'M', 0)]).linhas).toHaveLength(0);
  });
});

describe('quebra em folhas de 32', () => {
  const linhasDe = (quantas: number) =>
    montarLinhas(
      Array.from({ length: quantas }, (_, i) => item(String(100 + i), 'M', 1)),
    ).linhas;

  it('32 referências cabem num arquivo só', () => {
    expect(dividirEmFolhas(linhasDe(LINHAS_POR_FOLHA))).toHaveLength(1);
  });

  it('a 33ª abre o segundo arquivo', () => {
    const folhas = dividirEmFolhas(linhasDe(LINHAS_POR_FOLHA + 1));
    expect(folhas).toHaveLength(2);
    expect(folhas[0]).toHaveLength(32);
    expect(folhas[1]).toHaveLength(1);
  });

  it('pedido vazio não gera arquivo', () => {
    expect(dividirEmFolhas([])).toHaveLength(0);
  });
});

describe('preenchimento do modelo oficial', () => {
  const modelo = () => new Uint8Array(readFileSync(MODELO));

  const folhaComUmaLinha = () => {
    const { linhas } = montarLinhas([item('0130', 'M', 3, 53.9)]);
    return preencherModelo(modelo(), { linhas, numeroDoPedido: '14534' });
  };

  const sheet1 = (arquivo: Uint8Array) =>
    new TextDecoder().decode(unzipSync(arquivo)['xl/worksheets/sheet1.xml']!);

  it('escreve a referência na primeira linha da grade', () => {
    expect(sheet1(folhaComUmaLinha().arquivo)).toContain('<c r="A13" s="56"><v>130</v></c>');
  });

  it('põe a quantidade na coluna do tamanho', () => {
    expect(sheet1(folhaComUmaLinha().arquivo)).toContain('<c r="N13" s="41"><v>3</v></c>');
  });

  it('mantém a fórmula de UNIT e só atualiza o valor guardado', () => {
    const xml = sheet1(folhaComUmaLinha().arquivo);
    expect(xml).toContain('IFERROR(VLOOKUP(A13');
    expect(xml).toMatch(/<c r="AA13"[^>]*>.*?<\/f><v>53\.90<\/v><\/c>/s);
  });

  it('fecha o total do rodapé com o que está na grade', () => {
    const xml = sheet1(folhaComUmaLinha().arquivo);
    // 3 peças × 53,90
    expect(xml).toMatch(/<c r="AB48"[^>]*>.*?<v>161\.70<\/v><\/c>/s);
  });

  it('NÃO muda a estrutura: mesmas partes, logo e estilos byte a byte', () => {
    const original = unzipSync(modelo());
    const gerado = unzipSync(folhaComUmaLinha().arquivo);

    expect(Object.keys(gerado).sort()).toEqual(Object.keys(original).sort());

    // Tudo que não é a folha do pedido tem de voltar idêntico — é isso que
    // preserva a logo, a Plan2 com os preços e a área de impressão.
    for (const parte of Object.keys(original)) {
      if (parte === 'xl/worksheets/sheet1.xml') continue;
      expect(Buffer.from(gerado[parte]!)).toEqual(Buffer.from(original[parte]!));
    }
  });

  it('avisa quando a referência não existe na Plan2', () => {
    const { linhas } = montarLinhas([item('9999', 'M', 1)]);
    const { refsDesconhecidas } = preencherModelo(modelo(), { linhas });
    expect(refsDesconhecidas).toEqual(['9999']);
  });

  it('não reclama de referência que existe na Plan2', () => {
    expect(folhaComUmaLinha().refsDesconhecidas).toEqual([]);
  });
});
