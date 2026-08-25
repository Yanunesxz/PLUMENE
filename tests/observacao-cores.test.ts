import { describe, it, expect } from 'vitest';
// O módulo mora no pacote compartilhado: a planilha (web) e a API de Parceiro
// leem as mesmas linhas de cor das notas do pedido.
import { observacaoDeCores, juntarObservacao, semLinhasDeCor, coresPorSku } from '../packages/shared/src/pedidos/observacaoCores.js';

/**
 * A cor escolhida não cabe no item do pedido: o ERP recebe tudo como sortido
 * (COR '00001' fixo no Firebird). Ela viaja na observação, e é por ela que a
 * fábrica separa. Formato errado aqui = peça errada despachada.
 */
describe('observação com as cores escolhidas', () => {
  it('escreve uma linha por cor, com o NOME e sem o número da bolinha', () => {
    const obs = observacaoDeCores([
      { sku: '0015', size: 'M', quantidade: 3, color_code: '02', color_name: 'azul' },
      { sku: '0015', size: 'M', quantidade: 3, color_code: '01', color_name: 'rosa' },
    ]);
    expect(obs).toBe('0015 3M azul\n0015 3M rosa');
  });

  it('não vaza o número da bolinha em lugar nenhum do texto', () => {
    const obs = observacaoDeCores([
      { sku: '0171', size: 'M', quantidade: 1, color_code: '03', color_name: 'marrom' },
    ]);
    expect(obs).toBe('0171 1M marrom');
    expect(obs).not.toContain('03');
  });

  it('soma a mesma peça/tamanho/cor marcada duas vezes', () => {
    // O lojista voltou na azul depois de passar pela rosa. Duas linhas "3M azul"
    // fariam quem separa contar errado.
    const obs = observacaoDeCores([
      { sku: '0015', size: 'M', quantidade: 3, color_code: '02', color_name: 'azul' },
      { sku: '0015', size: 'M', quantidade: 2, color_code: '02', color_name: 'azul' },
    ]);
    expect(obs).toBe('0015 5M azul');
  });

  it('ignora peça sem cor cadastrada — a linha não informaria nada', () => {
    const obs = observacaoDeCores([
      { sku: '0090', size: 'G', quantidade: 4, color_code: null, color_name: null },
      { sku: '0015', size: 'P', quantidade: 1, color_code: '01', color_name: 'rosa' },
    ]);
    expect(obs).toBe('0015 1P rosa');
  });

  it('mantém "Variadas" como nome, nunca "sortidas"', () => {
    const obs = observacaoDeCores([
      { sku: '0171', size: 'GG', quantidade: 2, color_code: '04', color_name: 'Variadas' },
    ]);
    expect(obs).toBe('0171 2GG Variadas');
    expect(obs.toLowerCase()).not.toContain('sortid');
  });

  it('preserva o que a pessoa digitou e acrescenta as cores embaixo', () => {
    expect(juntarObservacao('entregar até sexta', '0015 3M azul')).toBe(
      'entregar até sexta\n\n0015 3M azul',
    );
  });

  it('sem cor e sem texto, não inventa observação vazia', () => {
    expect(juntarObservacao(undefined, '')).toBeUndefined();
    expect(juntarObservacao('   ', '')).toBeUndefined();
  });
});

describe('semLinhasDeCor — o rodapé da planilha fica só com o que o rep digitou', () => {
  const skus = new Set(['0015', '0130']);

  it('tira as linhas de cor e preserva o texto do representante', () => {
    const notas = 'FATURAR EM 2 REMESSAS\nBOLETOS ATÉ R$ 1.000\n\n0015 3M azul\n0130 2G rosa';
    expect(semLinhasDeCor(notas, skus)).toBe('FATURAR EM 2 REMESSAS\nBOLETOS ATÉ R$ 1.000');
  });

  it('é o inverso exato do que observacaoDeCores escreve', () => {
    const cores = observacaoDeCores([
      { sku: '0015', size: 'M', quantity: 3, color_code: '02', color_name: 'azul' },
    ]);
    const notas = juntarObservacao('entregar até sexta', cores)!;
    expect(semLinhasDeCor(notas, skus)).toBe('entregar até sexta');
  });

  it('não apaga frase do rep que só MENCIONA uma referência', () => {
    const notas = '0015 vai na segunda remessa';
    // "vai" não é quantidade+tamanho — a linha é recado, não cor.
    expect(semLinhasDeCor(notas, skus)).toBe('0015 vai na segunda remessa');
  });

  it('só as cores, sem texto do rep, vira rodapé vazio', () => {
    expect(semLinhasDeCor('0015 3M azul\n0130 2G rosa', skus)).toBe('');
    expect(semLinhasDeCor(null, skus)).toBe('');
  });
});

describe('coresPorSku — a cor escolhida nas bolinhas volta das notas para a linha', () => {
  const skus = new Set(['0706', '0015']);

  it('uma cor só vira o nome dela, limpo', () => {
    // O caso do pedido 14572: 0706 6M azul + 6G azul → a linha diz "azul".
    const notas = '0706 6M azul\n0706 6G azul';
    expect(coresPorSku(notas, skus).get('0706')).toBe('azul');
  });

  it('cores diferentes por tamanho saem detalhadas', () => {
    const notas = '0015 3M azul\n0015 2G rosa';
    expect(coresPorSku(notas, skus).get('0015')).toBe('3M azul / 2G rosa');
  });

  it('recado do rep e ref sem linha de cor não entram', () => {
    const resumo = coresPorSku('entregar até sexta\n0706 vai na segunda remessa', skus);
    expect(resumo.size).toBe(0);
  });

  it('fecha o ciclo: o que observacaoDeCores escreve, coresPorSku lê de volta', () => {
    const cores = observacaoDeCores([
      { sku: '0706', size: 'M', quantity: 6, color_code: '01', color_name: 'azul' },
      { sku: '0706', size: 'G', quantity: 6, color_code: '01', color_name: 'azul' },
    ]);
    const notas = juntarObservacao('FATURAR EM 2 REMESSAS', cores)!;
    expect(coresPorSku(notas, skus).get('0706')).toBe('azul');
    expect(semLinhasDeCor(notas, skus)).toBe('FATURAR EM 2 REMESSAS');
  });
});
