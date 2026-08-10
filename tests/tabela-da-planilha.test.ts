import { describe, it, expect } from 'vitest';
import { numeroDaTabela } from '../apps/web/src/lib/planilha/tabela.js';
import type { PriceTable } from '@csb/shared';

/**
 * De qual das três planilhas oficiais é cada tabela de preço.
 *
 * Errar aqui é caro e silencioso: o pedido sai no modelo da tabela errada, e
 * como o preço vem do VLOOKUP na Plan2 daquele modelo, a fábrica recebe o
 * pedido com o preço de outra região.
 *
 * Os nomes usados nos testes são os de produção — conferidos no banco em
 * 10/08/2026, com `erp_code` vazio nas quatro.
 */

const tabela = (name: string, erp_code: string | null = null): PriceTable => ({
  id: name,
  company_id: 'empresa',
  erp_code,
  name,
  price_column: 1,
});

describe('qual planilha oficial é esta tabela', () => {
  it('lê os nomes que existem em produção', () => {
    expect(numeroDaTabela(tabela('TABELA 01 - 2027'))).toBe(1);
    expect(numeroDaTabela(tabela('TABELA 02 - 2027'))).toBe(2);
    expect(numeroDaTabela(tabela('TABELA 03 - 2027'))).toBe(3);
  });

  it('não confunde o ano com o número da tabela', () => {
    // "2027" tem um 2; ancorar na palavra TABELA é o que impede o falso positivo.
    expect(numeroDaTabela(tabela('TABELA 01 - 2027'))).not.toBe(2);
    expect(numeroDaTabela(tabela('CATALOGO 2027'))).toBeNull();
  });

  it('não trata "TABELA PADRAO" como uma das três', () => {
    expect(numeroDaTabela(tabela('TABELA PADRAO'))).toBeNull();
  });

  it('não lê "TABELA 10" como tabela 1', () => {
    expect(numeroDaTabela(tabela('TABELA 10'))).toBeNull();
  });

  it('prefere o erp_code quando ele existe', () => {
    expect(numeroDaTabela(tabela('TABELA 01 - 2027', '3'))).toBe(3);
    expect(numeroDaTabela(tabela('nome sem numero', '02'))).toBe(2);
  });

  it('aceita os nomes curtos e sem acento que a fábrica também usa', () => {
    expect(numeroDaTabela(tabela('Tabela 1'))).toBe(1);
    expect(numeroDaTabela(tabela('TABELA2'))).toBe(2);
  });
});
