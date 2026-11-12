import { describe, it, expect } from 'vitest';
import {
  CASHBACK_PERCENTUAL,
  CASHBACK_VALIDADE_DIAS,
  creditoDoPedido,
  ehLinhaDoCashback,
  linhaDoCashback,
  montarExtrato,
  observacaoComCashback,
  observacaoGeralParaOControl,
  observacaoSemCashback,
  podeUsarCashback,
  reaisNaObservacao,
  veAreaDeCashback,
  vencimentoDoCredito,
  type CreditoDeCashback,
  type PedidoParaCashback,
  type UsoDeCashback,
} from '@csb/shared';

/**
 * CASHBACK DA VENDA INTERNA (migração 058; Yan, 12/11/2026):
 *   - "só vendedores internos que passam para os clientes, o valor do cashback
 *     aparece para os dois";
 *   - 3% do valor FATURADO, "acima de qualquer valor";
 *   - "abate no próximo pedido" e "aparece na obs do pedido assim: utilizado
 *     tantos reais do cashback";
 *   - "o cashback de um pedido de 1000 só é válido até 90 dias depois daquele
 *     pedido, e tem que avisar isso".
 */

const SIMONE = 'rep-venda-interna';
const COMUM = 'rep-comum';
const internos = new Set([SIMONE]);

function pedido(over: Partial<PedidoParaCashback> = {}): PedidoParaCashback {
  return {
    status: 'approved',
    invoiced: true,
    invoiced_at: '2026-11-12T15:00:00Z',
    invoiced_total: 1000,
    total: 1100,
    inactive: false,
    rep_id: SIMONE,
    ...over,
  };
}

function credito(id: string, faturadoEm: string, valor: number): CreditoDeCashback {
  return {
    order_id: id,
    order_number: null,
    faturado_em: faturadoEm,
    valor_faturado: valor / 0.03,
    valor,
    vence_em: vencimentoDoCredito(faturadoEm),
  };
}

function uso(id: string, usadoEm: string, valor: number): UsoDeCashback {
  return { id, order_id: `pedido-${id}`, order_number: null, valor, usado_em: usadoEm, usado_por_nome: 'Simone' };
}

describe('quanto o pedido gera', () => {
  it('3% do valor da NOTA, não do total do pedido', () => {
    expect(CASHBACK_PERCENTUAL).toBe(3);
    expect(creditoDoPedido(pedido(), { inicio: null, vendaInterna: internos })).toBe(30);
  });

  it('sem o valor da nota, usa o total do pedido', () => {
    expect(creditoDoPedido(pedido({ invoiced_total: null }), { inicio: null, vendaInterna: internos })).toBe(33);
  });

  it('arredonda no centavo', () => {
    expect(creditoDoPedido(pedido({ invoiced_total: 333.33 }), { inicio: null, vendaInterna: internos })).toBe(10);
    expect(creditoDoPedido(pedido({ invoiced_total: 1234.56 }), { inicio: null, vendaInterna: internos })).toBe(37.04);
  });

  it('só pedido da venda interna gera', () => {
    expect(creditoDoPedido(pedido({ rep_id: COMUM }), { inicio: null, vendaInterna: internos })).toBeNull();
  });

  it('só pedido faturado gera — aprovado sem o carimbo não', () => {
    expect(creditoDoPedido(pedido({ invoiced: false }), { inicio: null, vendaInterna: internos })).toBeNull();
    expect(creditoDoPedido(pedido({ invoiced_at: null }), { inicio: null, vendaInterna: internos })).toBeNull();
  });

  it('cancelado ou inativo (055) não gera', () => {
    expect(creditoDoPedido(pedido({ status: 'rejected' }), { inicio: null, vendaInterna: internos })).toBeNull();
    expect(creditoDoPedido(pedido({ inactive: true }), { inicio: null, vendaInterna: internos })).toBeNull();
  });

  it('faturado antes do início do programa não gera', () => {
    const ctx = { inicio: '2026-11-13T00:00:00Z', vendaInterna: internos };
    expect(creditoDoPedido(pedido(), ctx)).toBeNull();
    expect(creditoDoPedido(pedido({ invoiced_at: '2026-11-13T10:00:00Z' }), ctx)).toBe(30);
  });
});

describe('o vencimento de 90 dias', () => {
  it('conta do faturamento', () => {
    expect(CASHBACK_VALIDADE_DIAS).toBe(90);
    expect(vencimentoDoCredito('2026-11-12T15:00:00.000Z')).toBe('2027-02-10T15:00:00.000Z');
  });

  it('o pedido de R$ 1000: R$ 30 valendo até o 90º dia, e perdido depois', () => {
    const c = [credito('a', '2026-11-12T15:00:00Z', 30)];
    const dentro = montarExtrato(c, [], new Date('2027-02-10T14:59:00Z'));
    expect(dentro.saldo).toBe(30);
    expect(dentro.proximo_vencimento).toEqual({ valor: 30, vence_em: '2027-02-10T15:00:00.000Z', dias: 1 });
    expect(dentro.vencendo_logo).toBe(30);

    const fora = montarExtrato(c, [], new Date('2027-02-10T15:00:00Z'));
    expect(fora.saldo).toBe(0);
    expect(fora.total_vencido).toBe(30);
    expect(fora.creditos[0]).toMatchObject({ vencido: true, perdido: 30, restante: 0 });
    expect(fora.proximo_vencimento).toBeNull();
  });

  it('avisa (vencendo_logo) só com 15 dias ou menos', () => {
    const c = [credito('a', '2026-11-12T15:00:00Z', 30)];
    expect(montarExtrato(c, [], new Date('2027-01-20T15:00:00Z')).vencendo_logo).toBe(0);
    expect(montarExtrato(c, [], new Date('2027-01-27T15:00:00Z')).vencendo_logo).toBe(30);
  });
});

describe('o uso consome o crédito que vence antes', () => {
  const c = [credito('velho', '2026-11-01T12:00:00Z', 30), credito('novo', '2026-12-01T12:00:00Z', 60)];

  it('tira do mais velho primeiro e o saldo é o resto', () => {
    const e = montarExtrato(c, [uso('u1', '2026-12-05T12:00:00Z', 40)], new Date('2026-12-06T12:00:00Z'));
    expect(e.saldo).toBe(50);
    expect(e.total_usado).toBe(40);
    const velho = e.creditos.find((x) => x.order_id === 'velho');
    const novo = e.creditos.find((x) => x.order_id === 'novo');
    expect(velho).toMatchObject({ usado: 30, restante: 0 });
    expect(novo).toMatchObject({ usado: 10, restante: 50 });
    // O próximo a vencer agora é o novo.
    expect(e.proximo_vencimento?.valor).toBe(50);
  });

  it('o que sobrou do velho vence; o uso feito antes salvou a parte usada', () => {
    const e = montarExtrato(c, [uso('u1', '2026-11-20T12:00:00Z', 10)], new Date('2027-02-01T12:00:00Z'));
    // 01/02/2027: o velho (vence 30/01/2027) venceu com 20 sobrando; o novo segue inteiro.
    expect(e.total_vencido).toBe(20);
    expect(e.saldo).toBe(60);
  });

  it('o uso não pega crédito que ainda não existia na hora', () => {
    const e = montarExtrato(c, [uso('u1', '2026-11-20T12:00:00Z', 30)], new Date('2026-12-06T12:00:00Z'));
    expect(e.creditos.find((x) => x.order_id === 'novo')).toMatchObject({ usado: 0, restante: 60 });
  });

  it('uso maior que o disponível não vira saldo negativo', () => {
    const e = montarExtrato([credito('a', '2026-11-01T12:00:00Z', 30)], [uso('u1', '2026-11-05T12:00:00Z', 50)], new Date('2026-11-06T12:00:00Z'));
    expect(e.saldo).toBe(0);
    expect(e.total_usado).toBe(50);
  });

  it('centavos não acumulam erro', () => {
    const muitos = Array.from({ length: 10 }, (_, i) => credito(`c${i}`, '2026-11-01T12:00:00Z', 0.1));
    expect(montarExtrato(muitos, [uso('u', '2026-11-02T12:00:00Z', 0.3)], new Date('2026-11-03T12:00:00Z')).saldo).toBe(0.7);
  });
});

describe('a linha na observação', () => {
  it('é a frase do Yan, em reais e sem espaço especial', () => {
    expect(linhaDoCashback(30)).toBe('Utilizado R$ 30,00 do cashback');
    expect(linhaDoCashback(1234.5)).toBe('Utilizado R$ 1.234,50 do cashback');
    expect(reaisNaObservacao(1234567.891)).toBe('R$ 1.234.567,89');
    expect(ehLinhaDoCashback('Utilizado R$ 1.234,50 do cashback')).toBe(true);
    expect(ehLinhaDoCashback('Utilizado o boleto')).toBe(false);
  });

  it('entra no fim, sem apagar o recado nem as cores, e troca a anterior', () => {
    const notas = 'Boleto 30/60\n\n0015 3M pink';
    const com = observacaoComCashback(notas, 30);
    expect(com).toBe('Boleto 30/60\n\n0015 3M pink\nUtilizado R$ 30,00 do cashback');
    expect(observacaoComCashback(com, 12.5)).toBe('Boleto 30/60\n\n0015 3M pink\nUtilizado R$ 12,50 do cashback');
    expect(observacaoComCashback(null, 30)).toBe('Utilizado R$ 30,00 do cashback');
  });

  it('desfazer tira só a linha do cashback', () => {
    expect(observacaoSemCashback('Boleto 30/60\nUtilizado R$ 30,00 do cashback')).toBe('Boleto 30/60');
    expect(observacaoSemCashback('Utilizado R$ 30,00 do cashback')).toBe('');
  });

  it('vai ao Control: a observação geral da planilha/API mantém a linha', () => {
    const notas = observacaoComCashback('Boleto 30/60\n0015 3M pink', 30);
    const geral = observacaoGeralParaOControl(notas, new Set(['0015']));
    expect(geral.texto).toBe('Boleto 30/60\nUtilizado R$ 30,00 do cashback');
  });
});

describe('quem vê e quem usa', () => {
  it('a área: venda interna e escritório; o rep comum e a loja não', () => {
    expect(veAreaDeCashback('rep', true)).toBe(true);
    expect(veAreaDeCashback('rep', false)).toBe(false);
    for (const papel of ['admin', 'manager', 'financeiro', 'visualizador'] as const) {
      expect(veAreaDeCashback(papel, false)).toBe(true);
    }
    expect(veAreaDeCashback('store', false)).toBe(false);
    expect(veAreaDeCashback('sac', false)).toBe(false);
  });

  it('usar: venda interna, financeiro e admin — gerente e visualizador só leem', () => {
    expect(podeUsarCashback('rep', true)).toBe(true);
    expect(podeUsarCashback('rep', false)).toBe(false);
    expect(podeUsarCashback('financeiro', false)).toBe(true);
    expect(podeUsarCashback('admin', false)).toBe(true);
    expect(podeUsarCashback('manager', false)).toBe(false);
    expect(podeUsarCashback('visualizador', false)).toBe(false);
  });
});
