import { describe, it, expect } from 'vitest';
import {
  ORDER_STATUS,
  FAIXAS_DE_BONUS,
  contaParaAMeta,
  faixaAlcancada,
  proximaFaixa,
  posicaoNaRegua,
} from '@csb/shared';

/**
 * Bonificação mensal do representante.
 *
 * É dinheiro que a fábrica paga por fora da comissão, então a regra fica presa
 * aqui: a tela mostra o mês inteiro uma promessa, e ela tem de ser a mesma
 * conta que o fechamento vai fazer.
 */
describe('faixas de bônus', () => {
  it('paga UM degrau, o mais alto — não a soma deles', () => {
    // R$ 160 mil não paga 500 + 1.000 + 1.500 + 3.000. Paga 3.000.
    expect(faixaAlcancada(160_000)?.bonus).toBe(3_000);
    expect(faixaAlcancada(100_000)?.bonus).toBe(1_500);
  });

  it('atingir a meta na régua já conta — o aviso fala em "atingindo a meta"', () => {
    expect(faixaAlcancada(50_000)?.bonus).toBe(500);
    expect(faixaAlcancada(49_999)).toBeNull();
  });

  it('abaixo da primeira faixa não há bônus nenhum', () => {
    expect(faixaAlcancada(0)).toBeNull();
    expect(faixaAlcancada(12_345)).toBeNull();
  });

  it('a próxima faixa é a que ele ainda não alcançou', () => {
    expect(proximaFaixa(0)?.meta).toBe(50_000);
    expect(proximaFaixa(50_000)?.meta).toBe(80_000);
    expect(proximaFaixa(99_999)?.meta).toBe(100_000);
  });

  it('no teto não há próxima — e a tela precisa saber disso para não pedir mais', () => {
    expect(proximaFaixa(150_000)).toBeNull();
    expect(proximaFaixa(999_999)).toBeNull();
  });
});

describe('o que conta como pedido enviado', () => {
  it('conta o que saiu da mão dele', () => {
    expect(contaParaAMeta(ORDER_STATUS.PENDING_APPROVAL)).toBe(true);
    expect(contaParaAMeta(ORDER_STATUS.APPROVED)).toBe(true);
    expect(contaParaAMeta(ORDER_STATUS.SENT_ERP)).toBe(true);
  });

  it('não conta rascunho, triagem da loja nem recusado', () => {
    // `pending_rep` é pedido que a LOJA montou e ele ainda nem olhou: contar
    // isso deixaria a meta subir sozinha, sem ele ter feito nada.
    expect(contaParaAMeta(ORDER_STATUS.PENDING_REP)).toBe(false);
    expect(contaParaAMeta(ORDER_STATUS.DRAFT)).toBe(false);
    // O aviso manda estornar pedido cancelado; recusado nunca entra.
    expect(contaParaAMeta(ORDER_STATUS.REJECTED)).toBe(false);
  });
});

describe('posição na régua', () => {
  it('cada degrau ocupa um pedaço igual, e não o seu tamanho em reais', () => {
    // Sem isto, 80 e 100 mil ficariam colados e o trecho de 100 a 150 mil
    // sozinho ocuparia um terço da barra.
    expect(posicaoNaRegua(50_000)).toBeCloseTo(0.25);
    expect(posicaoNaRegua(80_000)).toBeCloseTo(0.5);
    expect(posicaoNaRegua(100_000)).toBeCloseTo(0.75);
    expect(posicaoNaRegua(150_000)).toBeCloseTo(1);
  });

  it('interpola dentro do degrau', () => {
    expect(posicaoNaRegua(25_000)).toBeCloseTo(0.125);
    // 65 mil é a metade do caminho entre 50 e 80 mil.
    expect(posicaoNaRegua(65_000)).toBeCloseTo(0.375);
  });

  it('não sai da régua', () => {
    expect(posicaoNaRegua(0)).toBe(0);
    expect(posicaoNaRegua(10_000_000)).toBe(1);
  });

  it('a régua tem um degrau para cada faixa do aviso', () => {
    expect(FAIXAS_DE_BONUS.map((f) => f.meta)).toEqual([50_000, 80_000, 100_000, 150_000]);
    expect(FAIXAS_DE_BONUS.map((f) => f.bonus)).toEqual([500, 1_000, 1_500, 3_000]);
  });
});
