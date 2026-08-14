import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';
import {
  celulaDoTamanho,
  refDaPlanilha,
  tamanhoIgnorado,
} from '../apps/web/src/lib/planilha/colunas.js';
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

  it('marca LD como ignorado, e só ele', () => {
    expect(tamanhoIgnorado('LD')).toBe(true);
    expect(tamanhoIgnorado('ld')).toBe(true);
    expect(tamanhoIgnorado('U')).toBe(false);
    expect(tamanhoIgnorado('M')).toBe(false);
  });
});

describe('referência como a planilha escreve', () => {
  it('completa com zero à esquerda e tira o E', () => {
    // A Plan2 tem "130" (numero, R$ 43,90) e "0130E" (texto, R$ 53,90), e o
    // preço do sistema é 43,90 — as linhas com "E" são outra lista. O Control
    // recusou "0130E" com "NÃO ENCONTRADO!!!" e cadastra a peça como "0130".
    expect(refDaPlanilha('0130')).toBe('0130');
    expect(refDaPlanilha('130')).toBe('0130');
    expect(refDaPlanilha('0130E')).toBe('0130');
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
    // O caso do Yan: "0130 quero 3M e 3 plus" tem de virar duas linhas. E no
    // Control a de baixo é outro PRODUTO — "0130 PLUS", como está no cadastro
    // dele: "0130" tem PP→GG, "0130 PLUS" tem 48→54.
    const { linhas } = montarLinhas([item('0130', 'M', 3), item('0130', '52', 3)]);
    expect(linhas).toHaveLength(2);
    expect(linhas.map((l) => l.ref)).toEqual(['0130', '0130 PLUS']);
    expect(linhas.map((l) => l.sistema)).toEqual(['letras', 'numerica']);
  });

  it('manda o tamanho grande em letra (XG/EG) para a linha PLUS, não só o 48', () => {
    // O que o Control recusava: "2130" com XG junto do base. A coluna Q é o "48"
    // do "2130 PLUS", outro produto — então o XG tem de sair em linha própria,
    // igual ao 48. Sem isso o 2130 saía numa linha só e o Control derrubava.
    const { linhas } = montarLinhas([item('2130', 'M', 3), item('2130', 'XG', 4)]);
    expect(linhas).toHaveLength(2);
    expect(linhas.map((l) => l.ref)).toEqual(['2130', '2130 PLUS']);
    expect(linhas[1]?.quantidades).toEqual({ Q: 4 });
    expect(linhas[1]?.pecas).toBe(4);
  });

  it('junta 48 e XG do mesmo produto na MESMA linha PLUS', () => {
    // 48 e XG caem os dois na coluna Q e são o mesmo produto plus: uma linha só.
    const { linhas } = montarLinhas([item('0130', 'XG', 2), item('0130', '48', 1)]);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]?.ref).toBe('0130 PLUS');
    expect(linhas[0]?.quantidades).toEqual({ Q: 3 });
  });

  it('lista o par junto: base e logo abaixo a linha PLUS, como no modelo da fábrica', () => {
    // O modelo preenchido intercala: 0130, 0130E, 2130, 2130E… O pedido montado
    // produto a produto jogava todos os PLUS para o fim do arquivo — e a
    // paginação saía diferente da que a fábrica espera conferir.
    const { linhas } = montarLinhas([
      item('0130', 'M', 3),
      item('2130', 'M', 3),
      item('0130', '48', 2),
      item('2130', 'XG', 4),
    ]);
    expect(linhas.map((l) => l.ref)).toEqual(['0130', '0130 PLUS', '2130', '2130 PLUS']);
  });

  it('não põe PLUS no infantil nem no juvenil', () => {
    const { linhas } = montarLinhas([item('0080', '6', 1), item('0080', '12', 1)]);
    expect(linhas.map((l) => l.ref)).toEqual(['0080', '0080']);
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

  it('LD sai da planilha sem virar aviso', () => {
    const { linhas, foraDaGrade } = montarLinhas([item('0130', 'LD', 4), item('0130', 'M', 2)]);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]?.quantidades).toEqual({ N: 2 });
    expect(foraDaGrade).toEqual([]);
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
    expect(sheet1(folhaComUmaLinha().arquivo)).toContain('<t>0130</t>');
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

  it('não confunde forma diferente com referência inexistente', () => {
    // Escrevemos "0130", a Plan2 guarda "130" e "0130E". São a mesma peça, e o
    // aviso só existe para a referência que a fábrica não tem de forma nenhuma.
    const { linhas } = montarLinhas([item('0130', 'M', 1)]);
    expect(preencherModelo(modelo(), { linhas }).refsDesconhecidas).toEqual([]);
  });

  it('não acusa a linha plus, que na Plan2 é a mesma peça', () => {
    const { linhas } = montarLinhas([item('0130', '52', 1)]);
    expect(linhas[0]?.ref).toBe('0130 PLUS');
    expect(preencherModelo(modelo(), { linhas }).refsDesconhecidas).toEqual([]);
  });

  it('não reclama de referência que existe na Plan2', () => {
    expect(folhaComUmaLinha().refsDesconhecidas).toEqual([]);
  });

  it('escreve a cor da peça na coluna OBSERVAÇÃO da linha (B)', () => {
    // A cor é o que a fábrica lê na SEPARAÇÃO — pedido do Yan (14/08/2026):
    // "quando a 0130 escolhe azul", o azul vai no campo de observação DA LINHA,
    // não só no bloco geral do rodapé.
    const { linhas } = montarLinhas([
      { sku: '0130', size: 'M', quantity: 3, unit_price: 43.9, observacao: 'Azul' },
      { sku: '0130', size: '48', quantity: 2, unit_price: 53.9, observacao: 'Azul' },
      { sku: '0854', size: 'M', quantity: 1, unit_price: 51.9 },
    ]);
    // A linha base e a PLUS carregam a cor; a peça sem cor fica sem observação.
    expect(linhas.map((l) => [l.ref, l.observacao ?? null])).toEqual([
      ['0130', 'Azul'],
      ['0130 PLUS', 'Azul'],
      ['0854', null],
    ]);

    const { arquivo } = preencherModelo(modelo(), { linhas });
    const xml = sheet1(arquivo);
    expect(xml).toMatch(/<c r="B13"[^>]*t="inlineStr"><is><t>Azul<\/t>/);
    expect(xml).toMatch(/<c r="B14"[^>]*t="inlineStr"><is><t>Azul<\/t>/);
    // B15 (0854, sem cor) fica exatamente como está no modelo.
    expect(xml).not.toMatch(/<c r="B15"[^>]*t="inlineStr">/);
  });

  it('escreve a condição de pagamento no COND PGTO (C8)', () => {
    const { linhas } = montarLinhas([item('0130', 'M', 3)]);
    const { arquivo } = preencherModelo(modelo(), {
      linhas,
      condicaoDePagamento: '30/60/90 DIAS',
    });
    const xml = sheet1(arquivo);
    // Em C8 (a área de valor ao lado do rótulo A8), como texto, estilo intacto.
    expect(xml).toMatch(/<c r="C8"[^>]*t="inlineStr"><is><t>30\/60\/90 DIAS<\/t><\/is><\/c>/);
    // O rótulo "COND PGTO" (A8) continua onde está.
    expect(xml).toMatch(/<c r="A8"[^>]*t="s">/);
  });

  it('sem condição escolhida, o COND PGTO fica em branco como sempre foi', () => {
    const xml = sheet1(folhaComUmaLinha().arquivo);
    expect(xml).not.toMatch(/<c r="C8"[^>]*t="inlineStr">/);
  });

  it('preenche o cabeçalho: data, razão social, endereço, CNPJ, e-mail e WhatsApp', () => {
    const { linhas } = montarLinhas([item('0130', 'M', 3)]);
    const { arquivo } = preencherModelo(modelo(), {
      linhas,
      data: '13/08/2026',
      cliente: {
        razaoSocial: 'DUO FACE ECOMMERCE LTDA',
        nomeFantasia: 'DUO FACE',
        endereco: 'R VOL DELMIRO SAMPAIO',
        cnpj: '52.594.226/0001-61',
        email: 'duoface@gmail.com',
        whatsapp: '(11) 1734-0709',
      },
    });
    const xml = sheet1(arquivo);
    expect(xml).toMatch(/<c r="B2"[^>]*t="inlineStr"><is><t>13\/08\/2026<\/t>/);
    expect(xml).toMatch(/<c r="C3"[^>]*t="inlineStr"><is><t>DUO FACE ECOMMERCE LTDA<\/t>/);
    expect(xml).toMatch(/<c r="N2"[^>]*t="inlineStr"><is><t>DUO FACE<\/t>/);
    expect(xml).toMatch(/<c r="C4"[^>]*t="inlineStr"><is><t>R VOL DELMIRO SAMPAIO<\/t>/);
    expect(xml).toMatch(/<c r="C7"[^>]*t="inlineStr"><is><t>52\.594\.226\/0001-61<\/t>/);
    expect(xml).toMatch(/<c r="W7"[^>]*t="inlineStr"><is><t>duoface@gmail\.com<\/t>/);
    expect(xml).toMatch(/<c r="S6"[^>]*t="inlineStr"><is><t>\(11\) 1734-0709<\/t>/);
  });

  it('escreve a observação com a marca da página no bloco do rodapé (A45)', () => {
    const { linhas } = montarLinhas([item('0130', 'M', 3)]);
    const { arquivo } = preencherModelo(modelo(), {
      linhas,
      observacao: 'PÁGINA 01. FATURAR EM 2 REMESSAS',
    });
    expect(sheet1(arquivo)).toMatch(
      /<c r="A45"[^>]*t="inlineStr"><is><t>PÁGINA 01\. FATURAR EM 2 REMESSAS<\/t>/,
    );
  });

  it('cabeçalho ausente não escreve nada — o formulário sai em branco como antes', () => {
    const xml = sheet1(folhaComUmaLinha().arquivo);
    expect(xml).not.toMatch(/<c r="C3"[^>]*t="inlineStr">/);
    expect(xml).not.toMatch(/<c r="B2"[^>]*t="inlineStr">/);
    expect(xml).not.toMatch(/<c r="A45"[^>]*t="inlineStr">/);
  });

  it('renomeia os rótulos da faixa PLUS para os nomes do Control: EG/EGG/EGGG', () => {
    // A importação de 13/08/2026: o Control tentou "48" e "XG" para o
    // "0128 PLUS" e recusou — o cadastro dele chama o tamanho de "EG". Só as
    // 4 refs numéricas usam o 48→54 da linha 12, que segue intacta.
    const xml = sheet1(folhaComUmaLinha().arquivo);
    expect(xml).toMatch(/<c r="Q11"[^>]*t="inlineStr"><is><t>EG<\/t>/);
    expect(xml).toMatch(/<c r="R11"[^>]*t="inlineStr"><is><t>EGG<\/t>/);
    expect(xml).toMatch(/<c r="S11"[^>]*t="inlineStr"><is><t>EGGG<\/t>/);
    // T11 (XG4) e a linha numérica (Q12 = "48") ficam como estão no modelo.
    expect(xml).not.toMatch(/<c r="T11"[^>]*t="inlineStr">/);
    expect(xml).not.toMatch(/<c r="Q12"[^>]*t="inlineStr">/);
  });
});
