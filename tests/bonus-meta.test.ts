import { describe, it, expect } from 'vitest';
import {
  ORDER_STATUS,
  FAIXAS_PADRAO,
  competenciaDe,
  contaParaAMeta,
  faixaAlcancada,
  faixasVigentes,
  normalizarFaixas,
  posicaoNaRegua,
  proximaFaixa,
} from '@csb/shared';

/** As faixas do aviso impresso, usadas como cenário na maioria dos testes. */
const AVISO = [...FAIXAS_PADRAO];

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
    expect(faixaAlcancada(160_000, AVISO)?.bonus).toBe(3_000);
    expect(faixaAlcancada(100_000, AVISO)?.bonus).toBe(1_500);
  });

  it('atingir a meta na régua já conta — o aviso fala em "atingindo a meta"', () => {
    expect(faixaAlcancada(50_000, AVISO)?.bonus).toBe(500);
    expect(faixaAlcancada(49_999, AVISO)).toBeNull();
  });

  it('abaixo da primeira faixa não há bônus nenhum', () => {
    expect(faixaAlcancada(0, AVISO)).toBeNull();
    expect(faixaAlcancada(12_345, AVISO)).toBeNull();
  });

  it('a próxima faixa é a que ele ainda não alcançou', () => {
    expect(proximaFaixa(0, AVISO)?.meta).toBe(50_000);
    expect(proximaFaixa(50_000, AVISO)?.meta).toBe(80_000);
    expect(proximaFaixa(99_999, AVISO)?.meta).toBe(100_000);
  });

  it('no teto não há próxima — e a tela precisa saber disso para não pedir mais', () => {
    expect(proximaFaixa(150_000, AVISO)).toBeNull();
    expect(proximaFaixa(999_999, AVISO)).toBeNull();
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
    expect(posicaoNaRegua(50_000, AVISO)).toBeCloseTo(0.25);
    expect(posicaoNaRegua(80_000, AVISO)).toBeCloseTo(0.5);
    expect(posicaoNaRegua(100_000, AVISO)).toBeCloseTo(0.75);
    expect(posicaoNaRegua(150_000, AVISO)).toBeCloseTo(1);
  });

  it('interpola dentro do degrau', () => {
    expect(posicaoNaRegua(25_000, AVISO)).toBeCloseTo(0.125);
    // 65 mil é a metade do caminho entre 50 e 80 mil.
    expect(posicaoNaRegua(65_000, AVISO)).toBeCloseTo(0.375);
  });

  it('não sai da régua', () => {
    expect(posicaoNaRegua(0, AVISO)).toBe(0);
    expect(posicaoNaRegua(10_000_000, AVISO)).toBe(1);
  });

  it('o aviso impresso continua sendo o rascunho do cadastro', () => {
    expect(FAIXAS_PADRAO.map((f) => f.meta)).toEqual([50_000, 80_000, 100_000, 150_000]);
    expect(FAIXAS_PADRAO.map((f) => f.bonus)).toEqual([500, 1_000, 1_500, 3_000]);
  });
});

/**
 * As faixas não são as mesmas para todo mundo: cada representante tem as dele,
 * e elas mudam de mês para mês. Quem cadastra é o gerente.
 */
describe('faixas cadastradas pelo gerente', () => {
  it('a régua funciona com qualquer quantidade de faixas, não só quatro', () => {
    const duas = [
      { meta: 30_000, bonus: 300 },
      { meta: 60_000, bonus: 900 },
    ];
    expect(posicaoNaRegua(30_000, duas)).toBeCloseTo(0.5);
    expect(faixaAlcancada(45_000, duas)?.bonus).toBe(300);
    expect(proximaFaixa(45_000, duas)?.meta).toBe(60_000);
  });

  it('sem faixa cadastrada não há régua nem promessa de bônus', () => {
    expect(faixaAlcancada(999_999, [])).toBeNull();
    expect(proximaFaixa(0, [])).toBeNull();
    expect(posicaoNaRegua(50_000, [])).toBe(0);
  });

  it('ordena o que o gerente digitou fora de ordem', () => {
    const bagunca = [
      { meta: 100_000, bonus: 1_500 },
      { meta: 40_000, bonus: 400 },
    ];
    expect(normalizarFaixas(bagunca).map((f) => f.meta)).toEqual([40_000, 100_000]);
  });

  it('joga fora linha em branco, valor zerado e meta repetida', () => {
    const sujo = [
      { meta: 50_000, bonus: 500 },
      { meta: 0, bonus: 0 },
      { meta: undefined, bonus: 100 },
      // Meta repetida deixaria duas bolinhas no mesmo ponto da régua, e a
      // segunda nunca seria alcançável.
      { meta: 50_000, bonus: 900 },
    ];
    expect(normalizarFaixas(sujo)).toEqual([{ meta: 50_000, bonus: 500 }]);
  });

  it('não passa de quatro faixas — é o que cabe na régua do celular', () => {
    const cinco = [10, 20, 30, 40, 50].map((n) => ({ meta: n * 1000, bonus: n }));
    expect(normalizarFaixas(cinco)).toHaveLength(4);
  });
});

describe('qual meta vale em cada mês', () => {
  const metas = [
    { competencia: '2026-06-01', faixas: [{ meta: 40_000, bonus: 400 }] },
    { competencia: '2026-08-01', faixas: [{ meta: 60_000, bonus: 800 }] },
  ];

  it('vale a do próprio mês quando ele foi cadastrado', () => {
    expect(faixasVigentes(metas, '2026-08-01')[0]?.meta).toBe(60_000);
  });

  it('mês sem cadastro herda o último anterior — a bonificação fica meses igual', () => {
    expect(faixasVigentes(metas, '2026-07-01')[0]?.meta).toBe(40_000);
    expect(faixasVigentes(metas, '2026-12-01')[0]?.meta).toBe(60_000);
  });

  it('cadastro futuro não vale para trás', () => {
    // O gerente adianta setembro em agosto; agosto continua com o de agosto.
    const comFuturo = [...metas, { competencia: '2026-09-01', faixas: [{ meta: 99_000, bonus: 1 }] }];
    expect(faixasVigentes(comFuturo, '2026-08-01')[0]?.meta).toBe(60_000);
  });

  it('antes do primeiro cadastro não há meta nenhuma', () => {
    expect(faixasVigentes(metas, '2026-01-01')).toEqual([]);
  });

  it('a competência é sempre o primeiro dia do mês', () => {
    expect(competenciaDe(new Date(2026, 7, 23))).toBe('2026-08-01');
    expect(competenciaDe(new Date(2026, 11, 1))).toBe('2026-12-01');
  });
});
