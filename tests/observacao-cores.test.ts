import { describe, it, expect } from 'vitest';
import { observacaoDeCores, juntarObservacao } from '../apps/web/src/lib/observacaoCores.js';

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
