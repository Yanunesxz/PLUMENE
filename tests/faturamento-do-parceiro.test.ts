import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { valorDaVenda } from '@csb/shared';
import { criarSupabaseFake } from './supabaseFake.js';

/**
 * A mão do faturamento na API de Parceiro.
 *
 * O ERP do Fábio ainda não usa esta rota — ela existe pronta para o dia em que
 * ele passar a informar o que faturou. É a peça que fecha o desenho: enquanto o
 * pedido não é faturado ele é só intenção, e é o `invoiced` que acende
 * "Aprovado" para o lojista e conta como venda no painel.
 *
 * O que estes testes trancam:
 *   1. um parceiro nunca fatura pedido de outra fábrica;
 *   2. cancelamento limpa o valor junto — senão o painel somaria nota morta;
 *   3. valor zerado ou negativo é recusado, nunca gravado;
 *   4. a rota aguenta rodar antes da migração 027.
 */

const EMPRESA = 'empresa-1';

async function servico(respostas: Record<string, unknown>) {
  const fake = criarSupabaseFake(respostas as never);
  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
  const mod = await import('../apps/api/src/modules/partner/partner.faturamento.service.js');
  return { receberFaturamento: mod.receberFaturamento, fake };
}

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.doUnmock('../apps/api/src/config/supabase.js');
});

describe('o ERP informa o que faturou', () => {
  it('grava o faturamento e o valor da nota', async () => {
    const { receberFaturamento, fake } = await servico({
      orders: [
        { data: [{ invoiced_total: null }], error: null }, // detector da 027
        { data: { id: 'o1', invoiced: false, total: 1000 }, error: null },
      ],
    });

    const r = await receberFaturamento(EMPRESA, [
      { pedido_erp: '9001', faturado: true, valor_faturado: 870.5 },
    ]);

    expect(r.atualizados).toBe(1);
    expect(r.ignorados).toEqual([]);
    const gravado = fake.ultimaGravacao('orders', 'update')?.valores as Record<string, unknown>;
    expect(gravado['invoiced']).toBe(true);
    expect(gravado['invoiced_total']).toBe(870.5);
  });

  it('sempre filtra pela empresa da chave — parceiro não fatura pedido alheio', async () => {
    const { receberFaturamento, fake } = await servico({
      orders: [
        { data: [{ invoiced_total: null }], error: null },
        { data: { id: 'o1', invoiced: false, total: 100 }, error: null },
      ],
    });

    await receberFaturamento(EMPRESA, [{ pedido_erp: '9001' }]);

    const porEmpresa = fake
      .filtrosDe('orders', 'eq')
      .filter((f) => f.args[0] === 'company_id' && f.args[1] === EMPRESA);
    expect(porEmpresa.length).toBeGreaterThan(0);
  });

  it('cancelar limpa a data e o valor — senão o painel somaria nota que não existe', async () => {
    const { receberFaturamento, fake } = await servico({
      orders: [
        { data: [{ invoiced_total: null }], error: null },
        { data: { id: 'o1', invoiced: true, total: 100 }, error: null },
      ],
    });

    await receberFaturamento(EMPRESA, [{ pedido_erp: '9001', faturado: false }]);

    const gravado = fake.ultimaGravacao('orders', 'update')?.valores as Record<string, unknown>;
    expect(gravado['invoiced']).toBe(false);
    expect(gravado['invoiced_at']).toBeNull();
    expect(gravado['invoiced_total']).toBeNull();
  });

  it('recusa valor zerado — cancelamento se diz com faturado:false, não zerando', async () => {
    const { receberFaturamento } = await servico({
      orders: [
        { data: [{ invoiced_total: null }], error: null },
        { data: { id: 'o1', invoiced: false, total: 100 }, error: null },
      ],
    });

    const r = await receberFaturamento(EMPRESA, [{ pedido_erp: '9001', valor_faturado: 0 }]);
    expect(r.atualizados).toBe(0);
    expect(r.ignorados[0]?.motivo).toContain('maior que zero');
  });

  it('recusa data inválida em vez de gravar lixo', async () => {
    const { receberFaturamento } = await servico({
      orders: [
        { data: [{ invoiced_total: null }], error: null },
        { data: { id: 'o1', invoiced: false, total: 100 }, error: null },
      ],
    });

    const r = await receberFaturamento(EMPRESA, [{ pedido_erp: '9001', faturado_em: 'ontem' }]);
    expect(r.atualizados).toBe(0);
    expect(r.ignorados[0]?.motivo).toContain('ISO');
  });

  it('reporta o pedido sem identificação em vez de estourar', async () => {
    const { receberFaturamento } = await servico({ orders: { data: null, error: null } });
    const r = await receberFaturamento(EMPRESA, [{ faturado: true }]);
    expect(r.recebidos).toBe(1);
    expect(r.atualizados).toBe(0);
    expect(r.ignorados[0]?.motivo).toContain('pedido_erp');
  });

  it('reporta pedido inexistente sem derrubar o lote inteiro', async () => {
    const { receberFaturamento } = await servico({
      orders: [
        { data: [{ invoiced_total: null }], error: null },
        { data: null, error: null },
      ],
    });
    const r = await receberFaturamento(EMPRESA, [{ pedido_erp: 'nao-existe' }]);
    expect(r.ignorados[0]?.motivo).toContain('não encontrado');
  });

  it('funciona antes da migração 027 — só ignora o valor corrigido', async () => {
    const { receberFaturamento, fake } = await servico({
      orders: [
        // Detector: a coluna ainda não existe.
        { data: null, error: { message: 'column orders.invoiced_total does not exist' } },
        { data: { id: 'o1', invoiced: false, total: 100 }, error: null },
      ],
    });

    const r = await receberFaturamento(EMPRESA, [{ pedido_erp: '9001', valor_faturado: 80 }]);

    expect(r.atualizados).toBe(1);
    const gravado = fake.ultimaGravacao('orders', 'update')?.valores as Record<string, unknown>;
    expect(gravado['invoiced']).toBe(true);
    expect('invoiced_total' in gravado).toBe(false);
  });

  it('`id` sem forma de UUID (22P02) é "pedido não encontrado", não "falha ao buscar"', async () => {
    // "falha ao buscar" manda o ERP reenviar na próxima rodada — e ele reenviaria
    // o mesmo id errado para sempre. Id malformado é 4xx de verdade.
    const { receberFaturamento } = await servico({
      orders: [
        { data: [{ invoiced_total: null }], error: null },
        { data: null, error: { message: 'invalid input syntax for type uuid: "abc"', code: '22P02' } },
      ],
    });

    const r = await receberFaturamento(EMPRESA, [{ id: 'abc' }]);

    expect(r.atualizados).toBe(0);
    expect(r.ignorados).toEqual([{ pedido: 'abc', motivo: 'pedido não encontrado nesta empresa' }]);
  });
});

/**
 * Os seis motivos de `ignorados` são contrato publicado (docs/API-PARCEIRO.md e
 * api-parceiro.html): o parser do Fábio decide por eles. Texto exato, com acento.
 */
describe('os seis motivos de ignorado, letra por letra', () => {
  const PEDIDO = { data: { id: 'o1', invoiced: false, total: 100 }, error: null };
  const SONDA = { data: [{ invoiced_total: null }], error: null };
  // Linha de enchimento: o dublê pré-busca a próxima resposta a cada consulta.
  // No "erro ao gravar" a foto da 044 (guardarOriginal) também lê `orders`.
  const VAZIO = { data: [], error: null };

  it.each<[string, Record<string, unknown>, RegExp | string, Array<{ data: unknown; error: unknown }>]>([
    ['sem identificação', {}, 'informe "pedido_erp" ou "id"', [SONDA]],
    ['erro na busca', { pedido_erp: 'CS17379' }, /^falha ao buscar: timeout$/, [SONDA, { data: null, error: { message: 'timeout' } }]],
    ['pedido inexistente', { pedido_erp: 'CS17379' }, 'pedido não encontrado nesta empresa', [SONDA, { data: null, error: null }]],
    ['data inválida', { pedido_erp: 'CS17379', faturado_em: 'ontem' }, '"faturado_em" não é uma data ISO', [SONDA, PEDIDO]],
    ['valor zerado', { pedido_erp: 'CS17379', valor_faturado: 0 }, '"valor_faturado" precisa ser maior que zero', [SONDA, PEDIDO]],
    ['erro ao gravar', { pedido_erp: 'CS17379' }, /^falha ao gravar: caiu$/, [SONDA, VAZIO, PEDIDO, VAZIO, PEDIDO, VAZIO, { data: null, error: { message: 'caiu' } }]],
  ])('%s', async (_nome, item, motivo, orders) => {
    const { receberFaturamento } = await servico({ orders });

    const r = await receberFaturamento(EMPRESA, [item]);

    expect(r.ignorados).toHaveLength(1);
    if (typeof motivo === 'string') expect(r.ignorados[0]!.motivo).toBe(motivo);
    else expect(r.ignorados[0]!.motivo).toMatch(motivo);
  });
});

describe('quanto o pedido vale como venda', () => {
  it('vale a NOTA quando o ERP informou', () => {
    expect(valorDaVenda({ total: 1000, invoiced_total: 870.5 })).toBe(870.5);
  });

  it('cai para o total do pedido enquanto o ERP não informa', () => {
    expect(valorDaVenda({ total: 1000, invoiced_total: null })).toBe(1000);
    expect(valorDaVenda({ total: 1000 })).toBe(1000);
  });

  it('a nota costuma ser MENOR — o que faltou no estoque não é faturado', () => {
    const pedido = { total: 1000, invoiced_total: 870.5 };
    expect(valorDaVenda(pedido)).toBeLessThan(pedido.total);
  });

  it('pedido sem total nenhum vale zero, não NaN', () => {
    expect(valorDaVenda({})).toBe(0);
  });
});
