import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { criarSupabaseFake, type ConsultaFeita } from './supabaseFake.js';
import {
  MAXIMO_DE_ENTREGAS,
  conferirDistribuicao,
  dataDeEnvioPorExtenso,
  dataDeEnvioValida,
  dividirEmPartesIguais,
  podeFracionarPedido,
  podeMexerNoPedido,
  podeMudarDataDeEnvio,
  repartirObservacao,
  rotuloDaEntrega,
} from '@csb/shared';
import { marcaDaEntrega } from '../apps/web/src/lib/exportOrders.js';

/**
 * FRACIONAMENTO DE PEDIDOS (migração 057; Yan, 05/11/2026).
 *
 * O exemplo dele: o pedido #57 da S H J Moda Íntima era um só no app
 * (R$ 21.227,70) e saiu em três no Control (PL02727, PL02728, PL02729), cada
 * um com a sua data de saída e a sua nota. O combinado:
 *   - cada entrega vira um pedido próprio, ligado aos outros;
 *   - há a separação automática: quantidades em partes iguais;
 *   - "todos podem, mesma regra: passou pra frente não pode ser alterado, se
 *     foi faturado não pode ser alterado";
 *   - "tem que ser avisado quando é fracionado".
 */

// ─── A regra (a mesma na tela e na API) ──────────────────────────────────────

describe('quem mexe no pedido em aberto — a regra que o fracionamento herda', () => {
  const p = (status: string, extra: Record<string, unknown> = {}) =>
    ({ status, rep_id: 'rep-1', invoiced: false, ...extra }) as never;

  it('o representante mexe no PRÓPRIO pedido enquanto está com ele; aceito pela fábrica, trava', () => {
    expect(podeMexerNoPedido(p('draft'), 'rep', 'rep-1')).toBe('ok');
    expect(podeMexerNoPedido(p('pending_rep'), 'rep', 'rep-1')).toBe('ok');
    expect(podeMexerNoPedido(p('pending_approval'), 'rep', 'rep-1')).toBe('ok');
    expect(podeMexerNoPedido(p('approved'), 'rep', 'rep-1')).toBe('tarde_demais');
    expect(podeMexerNoPedido(p('draft'), 'rep', 'outro')).toBe('forbidden');
    // O SAC (056) vende em nome próprio: a mesma mão do representante.
    expect(podeMexerNoPedido(p('draft', { rep_id: 'sac-1' }), 'sac', 'sac-1')).toBe('ok');
    expect(podeMexerNoPedido(p('approved', { rep_id: 'sac-1' }), 'sac', 'sac-1')).toBe('tarde_demais');
  });

  it('o escritório mexe até lançar no Control; lançado, faturado ou cancelado, ninguém', () => {
    for (const papel of ['financeiro', 'admin', 'manager'] as const) {
      expect(podeMexerNoPedido(p('pending_rep'), papel, 'x')).toBe('ok');
      expect(podeMexerNoPedido(p('pending_approval'), papel, 'x')).toBe('ok');
      expect(podeMexerNoPedido(p('approved'), papel, 'x')).toBe('ok');
      expect(podeMexerNoPedido(p('sent_erp'), papel, 'x')).toBe('tarde_demais');
      expect(podeMexerNoPedido(p('rejected'), papel, 'x')).toBe('tarde_demais');
      expect(podeMexerNoPedido(p('approved', { invoiced: true }), papel, 'x')).toBe('tarde_demais');
      // Rascunho alheio é a montagem privada do representante.
      expect(podeMexerNoPedido(p('draft'), papel, 'x')).toBe('tarde_demais');
      expect(podeMexerNoPedido(p('draft', { rep_id: 'x' }), papel, 'x')).toBe('ok');
    }
  });

  it('a venda interna mexe no próprio pedido até o carimbo de faturado — inclusive já lançado', () => {
    expect(podeMexerNoPedido(p('sent_erp'), 'rep', 'rep-1', true)).toBe('ok');
    expect(podeMexerNoPedido(p('sent_erp', { invoiced: true }), 'rep', 'rep-1', true)).toBe('tarde_demais');
    // No pedido dos outros ela é um representante comum.
    expect(podeMexerNoPedido(p('sent_erp', { rep_id: 'outro' }), 'rep', 'rep-1', true)).toBe('tarde_demais');
  });

  it('quem só lê, a loja e o relacionamento não mexem', () => {
    for (const papel of ['visualizador', 'store', 'relacionamento', 'guest'] as const) {
      expect(podeMexerNoPedido(p('pending_approval'), papel as never, 'x')).toBe('forbidden');
    }
    expect(podeMexerNoPedido(p('pending_approval'), undefined, 'x')).toBe('forbidden');
  });
});

describe('quem fraciona', () => {
  it('é a regra de mexer no pedido — e a entrega não se fraciona de novo', () => {
    const base = { status: 'approved', rep_id: 'rep-1', invoiced: false } as const;
    expect(podeFracionarPedido(base, 'financeiro', 'f')).toBe('ok');
    expect(podeFracionarPedido({ ...base, split_group_id: 'g' }, 'financeiro', 'f')).toBe('ja_fracionado');
    expect(podeFracionarPedido({ ...base, invoiced: true }, 'financeiro', 'f')).toBe('tarde_demais');
    expect(podeFracionarPedido({ ...base, status: 'sent_erp' }, 'admin', 'a')).toBe('tarde_demais');
    expect(podeFracionarPedido(base, 'rep', 'rep-1')).toBe('tarde_demais');
    expect(podeFracionarPedido({ ...base, status: 'pending_approval' }, 'rep', 'rep-1')).toBe('ok');
    expect(podeFracionarPedido(base, 'visualizador', 'v')).toBe('forbidden');
    // Quem não pode mexer recebe o motivo de sempre, não "já fracionado".
    expect(podeFracionarPedido({ ...base, split_group_id: 'g' }, 'visualizador', 'v')).toBe('forbidden');
  });

  it('a data de envio muda pelo mesmo portão, e só em pedido fracionado', () => {
    const entrega = { status: 'approved', rep_id: 'rep-1', invoiced: false, split_group_id: 'g' } as const;
    expect(podeMudarDataDeEnvio(entrega, 'financeiro', 'f')).toBe('ok');
    expect(podeMudarDataDeEnvio({ ...entrega, split_group_id: null }, 'financeiro', 'f')).toBe('nao_fracionado');
    expect(podeMudarDataDeEnvio({ ...entrega, status: 'sent_erp' }, 'financeiro', 'f')).toBe('tarde_demais');
    expect(podeMudarDataDeEnvio(entrega, 'rep', 'rep-1')).toBe('tarde_demais');
  });
});

// ─── A separação automática ──────────────────────────────────────────────────

describe('quantidades em partes iguais', () => {
  const pecas = (partes: Array<Array<{ quantity: number }>>) =>
    partes.map((p) => p.reduce((s, x) => s + x.quantity, 0));

  it('grade de moda (1 P, 2 M, 2 G, 1 GG) em 3 entregas: 2 peças em cada, nenhuma vazia', () => {
    const itens = [
      { id: 'p', quantity: 1 },
      { id: 'm', quantity: 2 },
      { id: 'g', quantity: 2 },
      { id: 'gg', quantity: 1 },
    ];
    const partes = dividirEmPartesIguais(itens, 3);
    expect(pecas(partes)).toEqual([2, 2, 2]);
  });

  it('nenhuma peça some nem dobra, e as entregas diferem em no máximo uma peça', () => {
    const itens = [7, 1, 12, 5, 3, 3, 10, 2, 9, 1, 1, 4].map((quantity, i) => ({ id: `i${i}`, quantity }));
    for (let n = 2; n <= MAXIMO_DE_ENTREGAS; n++) {
      const partes = dividirEmPartesIguais(itens, n);
      expect(partes).toHaveLength(n);
      for (const item of itens) {
        const soma = partes.flat().filter((x) => x.item_id === item.id).reduce((s, x) => s + x.quantity, 0);
        expect(soma).toBe(item.quantity);
      }
      const totais = pecas(partes);
      expect(Math.max(...totais) - Math.min(...totais)).toBeLessThanOrEqual(1);
      // Quantidade zero não vira linha.
      expect(partes.flat().every((x) => x.quantity > 0)).toBe(true);
    }
  });

  it('quantidade que divide certinho vai igual para todas', () => {
    expect(dividirEmPartesIguais([{ id: 'a', quantity: 6 }], 3)).toEqual([
      [{ item_id: 'a', quantity: 2 }],
      [{ item_id: 'a', quantity: 2 }],
      [{ item_id: 'a', quantity: 2 }],
    ]);
  });
});

describe('a conferência da distribuição', () => {
  const itens = [
    { id: 'a', quantity: 6 },
    { id: 'b', quantity: 3 },
  ];
  const entrega = (ship_date: string, ...itensDaEntrega: Array<[string, number]>) => ({
    ship_date,
    itens: itensDaEntrega.map(([item_id, quantity]) => ({ item_id, quantity })),
  });

  it('fecha quando toda peça está em exatamente uma entrega, com data', () => {
    const r = conferirDistribuicao(itens, [
      entrega('2026-10-21', ['a', 2], ['b', 3]),
      entrega('2026-10-23', ['a', 2]),
      entrega('2026-10-27', ['a', 2]),
    ]);
    expect(r).toEqual({ ok: true, pecasPorEntrega: [5, 2, 2] });
  });

  it('recusa peça sobrando, peça faltando, entrega vazia, data em branco e item de outro pedido', () => {
    const erro = (...entregas: ReturnType<typeof entrega>[]) => {
      const r = conferirDistribuicao(itens, entregas);
      return r.ok ? 'ok' : r.erro;
    };
    expect(erro(entrega('2026-10-21', ['a', 6], ['b', 3]))).toBe('quantidade_de_entregas');
    expect(erro(entrega('2026-10-21', ['a', 3], ['b', 3]), entrega('2026-10-23', ['a', 2]))).toBe('soma_diferente');
    expect(erro(entrega('2026-10-21', ['a', 6], ['b', 3]), entrega('2026-10-23', ['a', 1]))).toBe('soma_diferente');
    expect(erro(entrega('2026-10-21', ['a', 6], ['b', 3]), entrega('2026-10-23'))).toBe('entrega_vazia');
    expect(erro(entrega('', ['a', 6]), entrega('2026-10-23', ['b', 3]))).toBe('data_invalida');
    expect(erro(entrega('2026-02-30', ['a', 6]), entrega('2026-10-23', ['b', 3]))).toBe('data_invalida');
    expect(erro(entrega('2026-10-21', ['a', 6], ['x', 1]), entrega('2026-10-23', ['b', 3]))).toBe('item_desconhecido');
    expect(erro(entrega('2026-10-21', ['a', 5.5]), entrega('2026-10-23', ['b', 3]))).toBe('quantidade_invalida');
    expect(erro(entrega('2026-10-21', ['a', 3], ['a', 3]), entrega('2026-10-23', ['b', 3]))).toBe('item_repetido');
  });
});

// ─── As cores anotadas ───────────────────────────────────────────────────────

describe('a observação de cada entrega', () => {
  const itens = [
    { id: 'm', sku: '0015', size: 'M', quantity: 6 },
    { id: 'g', sku: '0015', size: 'G', quantity: 2 },
    { id: 'n', sku: '0130', size: '48', quantity: 4 },
  ];

  it('o recado digitado vai inteiro em todas; a linha de cor é repartida com a quantidade de cada entrega', () => {
    const notas = repartirObservacao(
      'Boleto 30 dias\n\n0015 6M azul\n0015 2G rosa',
      itens,
      [
        [{ item_id: 'm', quantity: 2 }, { item_id: 'g', quantity: 2 }, { item_id: 'n', quantity: 4 }],
        [{ item_id: 'm', quantity: 2 }],
        [{ item_id: 'm', quantity: 2 }],
      ],
    );
    expect(notas).toEqual([
      'Boleto 30 dias\n\n0015 2M azul\n0015 2G rosa',
      'Boleto 30 dias\n\n0015 2M azul',
      'Boleto 30 dias\n\n0015 2M azul',
    ]);
  });

  it('duas cores no mesmo tamanho: cada entrega leva o que cabe nela, na ordem das linhas', () => {
    const notas = repartirObservacao('0015 3M azul\n0015 3M rosa', itens, [
      [{ item_id: 'm', quantity: 2 }],
      [{ item_id: 'm', quantity: 2 }],
      [{ item_id: 'm', quantity: 2 }],
    ]);
    expect(notas).toEqual(['0015 2M azul', '0015 1M azul\n0015 1M rosa', '0015 2M rosa']);
  });

  it('tamanho numérico colado na quantidade ("248" = 2 peças do 48) é lido pelos tamanhos da peça', () => {
    const notas = repartirObservacao('0130 448 preto', itens, [
      [{ item_id: 'n', quantity: 1 }],
      [{ item_id: 'n', quantity: 3 }],
    ]);
    expect(notas).toEqual(['0130 148 preto', '0130 348 preto']);
  });

  it('linha que não dá para ler vai como veio para cada entrega que tem a referência', () => {
    const notas = repartirObservacao('0015 3XG azul', itens, [
      [{ item_id: 'm', quantity: 6 }],
      [{ item_id: 'n', quantity: 4 }],
      [{ item_id: 'g', quantity: 2 }],
    ]);
    expect(notas).toEqual(['0015 3XG azul', null, '0015 3XG azul']);
  });

  it('pedido sem observação: nenhuma entrega ganha uma', () => {
    expect(repartirObservacao(null, itens, [[{ item_id: 'm', quantity: 6 }], [{ item_id: 'g', quantity: 2 }]])).toEqual([
      null,
      null,
    ]);
  });
});

describe('os rótulos', () => {
  it('"Entrega 1/3" no selo e "Entrega 1 de 3" na frase — nunca "pt"', () => {
    expect(rotuloDaEntrega(1, 3)).toBe('Entrega 1/3');
    expect(rotuloDaEntrega(2, 3, 'longo')).toBe('Entrega 2 de 3');
    expect(rotuloDaEntrega(null, null)).toBe('Entrega');
  });

  it('a data de envio é data de calendário, sem fuso no meio', () => {
    expect(dataDeEnvioPorExtenso('2026-10-21')).toBe('21/10/2026');
    expect(dataDeEnvioPorExtenso(null)).toBe('');
    expect(dataDeEnvioValida('2026-10-21')).toBe(true);
    expect(dataDeEnvioValida('2026-02-30')).toBe(false);
    expect(dataDeEnvioValida('21/10/2026')).toBe(false);
  });

  it('a planilha do Control leva a entrega e a data de envio no rodapé — e nada no pedido comum', () => {
    expect(marcaDaEntrega({ split_group_id: 'g', split_index: 2, split_count: 3, ship_date: '2026-10-23' })).toBe(
      'ENTREGA 2/3 - ENVIO 23/10/2026.',
    );
    expect(marcaDaEntrega({ split_group_id: 'g', split_index: 1, split_count: 3, ship_date: null })).toBe('ENTREGA 1/3.');
    expect(marcaDaEntrega({})).toBe('');
  });
});

// ─── A API ───────────────────────────────────────────────────────────────────

const EMPRESA = 'empresa-1';
const SEGREDO = 'segredo-de-teste-nao-usar-em-producao'; // igual ao tests/setup.ts
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
function assinar(payload: Record<string, unknown>): string {
  const cabecalho = b64({ alg: 'HS256', typ: 'JWT' });
  const agora = Math.floor(Date.now() / 1000);
  const corpo = b64({ ...payload, iat: agora, exp: agora + 3600 });
  const assinatura = crypto.createHmac('sha256', SEGREDO).update(`${cabecalho}.${corpo}`).digest('base64url');
  return `${cabecalho}.${corpo}.${assinatura}`;
}
const base = { email: 'x@csb.com', company_id: EMPRESA, price_table_id: 'tabela-1' };
const TOKEN_FINANCEIRO = assinar({ ...base, sub: 'larissa', name: 'LARISSA', role: 'financeiro' });
const TOKEN_REP = assinar({ ...base, sub: 'rep-1', name: 'REINALDO', role: 'rep' });
const TOKEN_VENDA_INTERNA = assinar({ ...base, sub: 'rep-1', name: 'SIMONE', role: 'rep', venda_interna: true });
const TOKEN_VISUALIZADOR = assinar({ ...base, sub: 'vis-1', name: 'JOAO', role: 'visualizador' });

const CRIADO_EM = '2026-09-29T14:00:00.000Z';
const PEDIDO = {
  id: 'o1',
  company_id: EMPRESA,
  rep_id: 'rep-1',
  customer_id: 'cliente-1',
  status: 'approved',
  invoiced: false,
  order_number: 57,
  total: 108,
  discount_percent: 10,
  notes: 'Boleto 30 dias\n\n0015 6M azul',
  price_table_id: 'tabela-1',
  payment_condition_id: 'cond-1',
  source: 'rep',
  created_by: 'rep-1',
  approved_by: 'larissa',
  created_at: CRIADO_EM,
  erp_order_id: null,
  local_id: 'aparelho-1',
  split_group_id: null,
  items: [
    { id: 'i1', order_id: 'o1', product_id: 'p1', variant_id: 'v1', quantity: 6, unit_price: 10, total: 60, product: { sku: '0015' }, variant: { size: 'M' } },
    { id: 'i2', order_id: 'o1', product_id: 'p2', variant_id: 'v2', quantity: 3, unit_price: 20, total: 60, product: { sku: '0020' }, variant: { size: 'G' } },
  ],
};

/** Três entregas: a 1 fica com 2 do M e os 3 do G; a 2 e a 3, com 2 do M cada. */
const TRES_ENTREGAS = {
  entregas: [
    { ship_date: '2026-10-21', itens: [{ item_id: 'i1', quantity: 2 }, { item_id: 'i2', quantity: 3 }] },
    { ship_date: '2026-10-23', itens: [{ item_id: 'i1', quantity: 2 }] },
    { ship_date: '2026-10-27', itens: [{ item_id: 'i1', quantity: 2 }] },
  ],
};

interface Cenario {
  pedido?: Record<string, unknown>;
  /** A 057 ainda não rodou: a sonda da coluna responde 42703. */
  semMigracao?: boolean;
  /** O UPDATE condicional não acha o pedido (ele andou no meio). */
  pedidoAndou?: boolean;
  /** O INSERT das entregas novas falha. */
  falhaNasNovas?: boolean;
}

async function subirApp(cenario: Cenario = {}) {
  const pedido = { ...PEDIDO, ...cenario.pedido };
  const fake = criarSupabaseFake({
    orders: (c: ConsultaFeita) => {
      const colunas = String(c.filtros.find((f) => f.metodo === 'select')?.args[0] ?? '');
      if (c.operacao === 'select') {
        // A sonda do detectar(): "a coluna existe?"
        if (colunas === 'split_group_id') {
          return cenario.semMigracao
            ? { data: null, error: { message: 'column orders.split_group_id does not exist', code: '42703' } }
            : { data: [], error: null };
        }
        // As entregas do grupo, para o detalhe.
        if (colunas.startsWith('id, order_number, split_index')) {
          return {
            data: [
              { id: 'o1', order_number: 57, split_index: 1, ship_date: '2026-10-21', status: 'sent_erp', invoiced: true, total: 72, erp_order_id: 'PL02727' },
              { id: 'o2', order_number: 58, split_index: 2, ship_date: '2026-10-23', status: 'approved', invoiced: false, total: 18, erp_order_id: null },
            ],
            error: null,
          };
        }
        return { data: pedido, error: null };
      }
      if (c.operacao === 'update') {
        if (cenario.pedidoAndou) return { data: null, error: null };
        return { data: { ...pedido, ...(c.valores as object), items: undefined }, error: null };
      }
      if (c.operacao === 'insert') {
        if (cenario.falhaNasNovas) return { data: null, error: { message: 'boom' } };
        const linhas = c.valores as Array<Record<string, unknown>>;
        return { data: linhas.map((l, i) => ({ id: `nova-${i + 2}`, order_number: 58 + i, ...l })), error: null };
      }
      return { data: null, error: null };
    },
  } as never);
  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
  const { buildApp } = await import('../apps/api/src/app.js');
  const app = await buildApp();
  await app.ready();
  return { app, fake };
}

const fracionar = (token: string, payload: unknown = TRES_ENTREGAS) => ({
  method: 'POST' as const,
  url: '/orders/o1/fracionar',
  headers: { authorization: `Bearer ${token}` },
  payload: payload as Record<string, unknown>,
});

beforeEach(() => {
  vi.resetModules();
});

// Sobe o app inteiro: a primeira requisição passa dos 5 s padrão sob carga.
describe('POST /orders/:id/fracionar', { timeout: 20_000 }, () => {
  it('o financeiro fraciona o pedido aprovado em 3 entregas: o de origem vira a entrega 1 e nascem dois pedidos', async () => {
    const { app, fake } = await subirApp();
    const res = await app.inject(fracionar(TOKEN_FINANCEIRO));
    await app.close();

    expect(res.statusCode).toBe(200);

    // 1. O pedido de origem: marcado como entrega 1, com o total e as cores dela.
    const marca = fake.gravacoes.find((g) => g.tabela === 'orders' && g.operacao === 'update')!.valores as Record<string, unknown>;
    expect(marca).toMatchObject({
      split_group_id: 'o1',
      split_index: 1,
      split_count: 3,
      ship_date: '2026-10-21',
      split_by: 'larissa',
      // (2 × 10 + 3 × 20) com 10% de desconto.
      total: 72,
      notes: 'Boleto 30 dias\n\n0015 2M azul',
    });
    // Só se o pedido continua como foi lido: não fracionado, no mesmo status, sem nota.
    expect(fake.filtrosDe('orders', 'is').some((f) => f.args[0] === 'split_group_id' && f.args[1] === null)).toBe(true);
    expect(fake.filtrosDe('orders', 'eq').some((f) => f.args[0] === 'status' && f.args[1] === 'approved')).toBe(true);

    // 2. As entregas novas: herdam cliente, representante, tabela, condição,
    //    desconto e a DATA do pedido (a meta do mês não muda de lugar).
    const novas = fake.ultimaGravacao('orders', 'insert')!.valores as Array<Record<string, unknown>>;
    expect(novas).toHaveLength(2);
    expect(novas.map((n) => [n.split_index, n.ship_date, n.total])).toEqual([
      [2, '2026-10-23', 18],
      [3, '2026-10-27', 18],
    ]);
    for (const nova of novas) {
      expect(nova).toMatchObject({
        company_id: EMPRESA,
        rep_id: 'rep-1',
        customer_id: 'cliente-1',
        status: 'approved',
        price_table_id: 'tabela-1',
        payment_condition_id: 'cond-1',
        discount_percent: 10,
        created_at: CRIADO_EM,
        approved_by: 'larissa',
        split_group_id: 'o1',
        split_count: 3,
        notes: 'Boleto 30 dias\n\n0015 2M azul',
      });
      // O que é SÓ do pedido de origem não vai junto.
      for (const coluna of ['id', 'order_number', 'local_id', 'erp_order_id', 'invoiced', 'items']) {
        expect(nova).not.toHaveProperty(coluna);
      }
    }
    // A soma das entregas é o pedido de antes.
    expect(72 + 18 + 18).toBe(PEDIDO.total);

    // 3. As peças: as das entregas novas nascem com o preço do pedido…
    const pecasNovas = fake.gravacoes.find((g) => g.tabela === 'order_items' && g.operacao === 'insert')!.valores;
    expect(pecasNovas).toEqual([
      { order_id: 'nova-2', product_id: 'p1', variant_id: 'v1', quantity: 2, unit_price: 10, total: 20 },
      { order_id: 'nova-3', product_id: 'p1', variant_id: 'v1', quantity: 2, unit_price: 10, total: 20 },
    ]);
    // …e o pedido de origem encolhe: só a linha que mudou é regravada.
    expect(fake.ultimaGravacao('order_items', 'upsert')!.valores).toEqual([
      { id: 'i1', order_id: 'o1', product_id: 'p1', variant_id: 'v1', quantity: 2, unit_price: 10, total: 20 },
    ]);
    expect(fake.ultimaGravacao('order_items', 'delete')).toBeUndefined();

    const corpo = res.json() as { data: { entregas: Array<{ id: string; split_index: number }> } };
    expect(corpo.data.entregas.map((e) => [e.id, e.split_index])).toEqual([
      ['o1', 1],
      ['nova-2', 2],
      ['nova-3', 3],
    ]);
  });

  it('a ordem das gravações nunca deixa peça sem dono: as entregas novas nascem ANTES de o pedido encolher', async () => {
    const { app, fake } = await subirApp();
    await app.inject(fracionar(TOKEN_FINANCEIRO));
    await app.close();

    const ordem = fake.gravacoes
      .filter((g) => g.tabela === 'orders' || g.tabela === 'order_items')
      .map((g) => `${g.tabela}.${g.operacao}`);
    expect(ordem).toEqual(['orders.update', 'orders.insert', 'order_items.insert', 'order_items.upsert']);
  });

  it('linha que vai inteira para outra entrega sai do pedido de origem', async () => {
    const { app, fake } = await subirApp();
    const res = await app.inject(
      fracionar(TOKEN_FINANCEIRO, {
        entregas: [
          { ship_date: '2026-10-21', itens: [{ item_id: 'i1', quantity: 6 }] },
          { ship_date: '2026-10-23', itens: [{ item_id: 'i2', quantity: 3 }] },
        ],
      }),
    );
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(fake.ultimaGravacao('order_items', 'upsert')).toBeUndefined();
    expect(fake.ultimaGravacao('order_items', 'delete')).toBeDefined();
    expect(fake.filtrosDe('order_items', 'in').some((f) => f.args[0] === 'id' && JSON.stringify(f.args[1]) === '["i2"]')).toBe(true);
    // A cor anotada vai só para a entrega que ficou com a peça.
    const novas = fake.ultimaGravacao('orders', 'insert')!.valores as Array<Record<string, unknown>>;
    expect(novas[0]!.notes).toBe('Boleto 30 dias');
  });

  it('o representante fraciona o próprio pedido enquanto está com ele; aceito pela fábrica, 409', async () => {
    const naFila = await subirApp({ pedido: { status: 'pending_approval' } });
    const ok = await naFila.app.inject(fracionar(TOKEN_REP));
    await naFila.app.close();
    expect(ok.statusCode).toBe(200);
    const novas = naFila.fake.ultimaGravacao('orders', 'insert')!.valores as Array<Record<string, unknown>>;
    expect(novas.every((n) => n.status === 'pending_approval')).toBe(true);

    vi.resetModules();
    const aceito = await subirApp();
    const tarde = await aceito.app.inject(fracionar(TOKEN_REP));
    await aceito.app.close();
    expect(tarde.statusCode).toBe(409);
    expect((tarde.json() as { code: string }).code).toBe('ORDER_JA_ENVIADO');
    expect(aceito.fake.gravacoes.filter((g) => g.tabela === 'orders' || g.tabela === 'order_items')).toEqual([]);
  });

  it('a venda interna fraciona o próprio pedido já lançado: as entregas novas nascem APROVADAS e a foto do Control sai antes', async () => {
    const { app, fake } = await subirApp({ pedido: { status: 'sent_erp', erp_order_id: 'PL02727' } });
    const res = await app.inject(fracionar(TOKEN_VENDA_INTERNA));
    await app.close();

    expect(res.statusCode).toBe(200);
    const novas = fake.ultimaGravacao('orders', 'insert')!.valores as Array<Record<string, unknown>>;
    // Lançado no Control é o pedido de ORIGEM; a entrega nova ainda vai ser.
    expect(novas.every((n) => n.status === 'approved')).toBe(true);
    // A foto do que a fábrica tem na mão (046): tirada antes de o pedido encolher.
    const foto = fake.gravacoes.findIndex((g) => g.tabela === 'order_erp_sync' && g.operacao === 'insert');
    const marca = fake.gravacoes.findIndex((g) => g.tabela === 'orders' && g.operacao === 'update');
    expect(foto).toBeGreaterThanOrEqual(0);
    expect(foto).toBeLessThan(marca);
  });

  it('faturado, lançado (para o financeiro) e já fracionado não fracionam — 409, nada gravado', async () => {
    const casos: Array<[Record<string, unknown>, string]> = [
      [{ invoiced: true }, 'ORDER_JA_ENVIADO'],
      [{ status: 'sent_erp' }, 'ORDER_JA_ENVIADO'],
      [{ split_group_id: 'o0', split_index: 2, split_count: 3 }, 'JA_FRACIONADO'],
    ];
    for (const [pedido, codigo] of casos) {
      vi.resetModules();
      const { app, fake } = await subirApp({ pedido });
      const res = await app.inject(fracionar(TOKEN_FINANCEIRO));
      await app.close();
      expect(res.statusCode).toBe(409);
      expect((res.json() as { code: string }).code).toBe(codigo);
      expect(fake.gravacoes.filter((g) => g.tabela === 'orders' || g.tabela === 'order_items')).toEqual([]);
    }
  });

  it('distribuição que não fecha — 400 com a frase da tela, nada gravado', async () => {
    const { app, fake } = await subirApp();
    const res = await app.inject(
      fracionar(TOKEN_FINANCEIRO, {
        entregas: [
          { ship_date: '2026-10-21', itens: [{ item_id: 'i1', quantity: 2 }, { item_id: 'i2', quantity: 3 }] },
          { ship_date: '2026-10-23', itens: [{ item_id: 'i1', quantity: 2 }] },
        ],
      }),
    );
    await app.close();

    expect(res.statusCode).toBe(400);
    const corpo = res.json() as { code: string; error: string };
    expect(corpo.code).toBe('DISTRIBUICAO_INVALIDA');
    expect(corpo.error).toMatch(/não bate com as peças do pedido/);
    expect(fake.gravacoes.filter((g) => g.tabela === 'orders' || g.tabela === 'order_items')).toEqual([]);
  });

  it('entrega sem data — 400 dizendo QUAL entrega', async () => {
    const { app } = await subirApp();
    const res = await app.inject(
      fracionar(TOKEN_FINANCEIRO, {
        entregas: [TRES_ENTREGAS.entregas[0], { ...TRES_ENTREGAS.entregas[1]!, ship_date: '' }, TRES_ENTREGAS.entregas[2]],
      }),
    );
    await app.close();
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('A entrega 2 está sem a data de envio.');
  });

  it('sem a 057 no banco — 503 MIGRACAO_PENDENTE, nada gravado', async () => {
    const { app, fake } = await subirApp({ semMigracao: true });
    const res = await app.inject(fracionar(TOKEN_FINANCEIRO));
    await app.close();

    expect(res.statusCode).toBe(503);
    expect((res.json() as { code: string }).code).toBe('MIGRACAO_PENDENTE');
    expect(fake.gravacoes).toEqual([]);
  });

  it('o pedido andou entre a leitura e a gravação — 409 PEDIDO_MUDOU, nenhuma entrega nasce', async () => {
    const { app, fake } = await subirApp({ pedidoAndou: true });
    const res = await app.inject(fracionar(TOKEN_FINANCEIRO));
    await app.close();

    expect(res.statusCode).toBe(409);
    expect((res.json() as { code: string }).code).toBe('PEDIDO_MUDOU');
    expect(fake.ultimaGravacao('orders', 'insert')).toBeUndefined();
    expect(fake.ultimaGravacao('order_items')).toBeUndefined();
  });

  it('falhou ao criar as entregas: a marca do pedido de origem é DESFEITA e as peças não são tocadas', async () => {
    const { app, fake } = await subirApp({ falhaNasNovas: true });
    const res = await app.inject(fracionar(TOKEN_FINANCEIRO));
    await app.close();

    expect(res.statusCode).toBe(500);
    expect((res.json() as { code: string }).code).toBe('FRACIONAMENTO_FALHOU');
    const desfeito = fake.ultimaGravacao('orders', 'update')!.valores as Record<string, unknown>;
    expect(desfeito).toMatchObject({
      split_group_id: null,
      split_index: null,
      split_count: null,
      ship_date: null,
      total: PEDIDO.total,
      notes: PEDIDO.notes,
    });
    expect(fake.ultimaGravacao('order_items')).toBeUndefined();
  });

  it('o visualizador não fraciona — 403 já na rota', async () => {
    const { app, fake } = await subirApp();
    const res = await app.inject(fracionar(TOKEN_VISUALIZADOR));
    await app.close();

    expect(res.statusCode).toBe(403);
    expect(fake.gravacoes).toEqual([]);
  });
});

describe('PATCH /orders/:id/data-de-envio', { timeout: 20_000 }, () => {
  const mudar = (token: string, ship_date = '2026-11-03') => ({
    method: 'PATCH' as const,
    url: '/orders/o1/data-de-envio',
    headers: { authorization: `Bearer ${token}` },
    payload: { ship_date },
  });

  it('o financeiro muda a data de uma entrega ainda não lançada: grava só a data', async () => {
    const { app, fake } = await subirApp({
      pedido: { split_group_id: 'o1', split_index: 1, split_count: 3, ship_date: '2026-10-21' },
    });
    const res = await app.inject(mudar(TOKEN_FINANCEIRO));
    await app.close();

    expect(res.statusCode).toBe(200);
    const gravado = fake.ultimaGravacao('orders', 'update')!.valores as Record<string, unknown>;
    expect(Object.keys(gravado).sort()).toEqual(['ship_date', 'updated_at']);
    expect(gravado.ship_date).toBe('2026-11-03');
  });

  it('pedido que não é fracionado não tem data de envio — 409; data torta — 400', async () => {
    const { app, fake } = await subirApp();
    const res = await app.inject(mudar(TOKEN_FINANCEIRO));
    const torta = await app.inject(mudar(TOKEN_FINANCEIRO, '03/11/2026'));
    await app.close();

    expect(res.statusCode).toBe(409);
    expect((res.json() as { code: string }).code).toBe('NAO_FRACIONADO');
    expect(torta.statusCode).toBe(400);
    expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();
  });
});

describe('GET /orders/:id de um pedido fracionado', { timeout: 20_000 }, () => {
  it('traz o bloco `fracionamento`: em que entrega está e as entregas do grupo, na ordem', async () => {
    const { app } = await subirApp({
      pedido: {
        split_group_id: 'o1',
        split_index: 1,
        split_count: 3,
        ship_date: '2026-10-21',
        split_at: '2026-11-05T12:00:00.000Z',
        split_by: null,
      },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/orders/o1',
      headers: { authorization: `Bearer ${TOKEN_FINANCEIRO}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const { fracionamento } = (res.json() as { data: { fracionamento: Record<string, unknown> } }).data;
    expect(fracionamento).toMatchObject({
      grupo: 'o1',
      indice: 1,
      total_de_entregas: 3,
      ship_date: '2026-10-21',
      fracionado_em: '2026-11-05T12:00:00.000Z',
    });
    expect(fracionamento.entregas).toEqual([
      { id: 'o1', order_number: 57, indice: 1, ship_date: '2026-10-21', status: 'sent_erp', invoiced: true, total: 72, erp_order_id: 'PL02727' },
      { id: 'o2', order_number: 58, indice: 2, ship_date: '2026-10-23', status: 'approved', invoiced: false, total: 18, erp_order_id: null },
    ]);
  });

  it('pedido comum não ganha o bloco', async () => {
    const { app } = await subirApp();
    const res = await app.inject({
      method: 'GET',
      url: '/orders/o1',
      headers: { authorization: `Bearer ${TOKEN_FINANCEIRO}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: Record<string, unknown> }).data).not.toHaveProperty('fracionamento');
  });
});
