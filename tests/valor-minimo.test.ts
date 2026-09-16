import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { criarSupabaseFake, type RespostaTabela } from './supabaseFake.js';
import { avisoDeValorMinimo, minimoDaCondicao, reaisDoAviso } from '@csb/shared';

/**
 * Pedido mínimo da condição de pagamento (migração 049,
 * `payment_conditions.valor_minimo`).
 *
 * O que estes testes trancam:
 *  • a API de condições do app devolve `valor_minimo` quando a coluna existe,
 *    em número, e devolve a lista de hoje (sem o campo) quando não existe;
 *  • a função pura do aviso só fala quando o total fica ABAIXO do mínimo, com
 *    a frase combinada, comparando em centavos;
 *  • o mínimo só avisa: o servidor não recusa condição nem pedido por ele.
 *
 * Dados fictícios de propósito.
 */

const EMPRESA = 'empresa-teste';
const SUPABASE = '../apps/api/src/config/supabase.js';
const SERVICE = '../apps/api/src/modules/orders/paymentConditions.service.js';

/** O dublê adianta uma resposta a cada consulta: esta ocupa o espaço entre duas. */
const ENCHIMENTO: RespostaTabela = { data: null, error: null };
const OK: RespostaTabela = { data: [], error: null };
const SEM_COLUNA: RespostaTabela = {
  data: null,
  error: { code: '42703', message: 'column payment_conditions.valor_minimo does not exist' },
};

type Service = typeof import('../apps/api/src/modules/orders/paymentConditions.service.js');

async function carregar(respostas: Record<string, RespostaTabela | RespostaTabela[]>) {
  const fake = criarSupabaseFake(respostas);
  vi.doMock(SUPABASE, () => ({ supabase: fake.cliente }));
  const service = (await import(SERVICE)) as Service;
  return { service, fake };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock(SUPABASE);
});

// ─── A função pura do aviso ──────────────────────────────────────────────────

describe('avisoDeValorMinimo', () => {
  it('total abaixo do mínimo: avisa com a frase combinada', () => {
    const aviso = avisoDeValorMinimo({ valor_minimo: 500 }, 320.5);

    expect(aviso).toEqual({
      minimo: 500,
      total: 320.5,
      mensagem: 'Esta condição pede pedido mínimo de R$ 500,00; o total está em R$ 320,50',
    });
  });

  it('total igual ou acima do mínimo: nada a avisar', () => {
    expect(avisoDeValorMinimo({ valor_minimo: 500 }, 500)).toBeNull();
    expect(avisoDeValorMinimo({ valor_minimo: 500 }, 1200)).toBeNull();
  });

  it('compara em centavos — a soma em ponto flutuante não inventa aviso de R$ 500,00 contra R$ 500,00', () => {
    expect(avisoDeValorMinimo({ valor_minimo: 500 }, 499.999999)).toBeNull();
    expect(avisoDeValorMinimo({ valor_minimo: 0.3 }, 0.1 + 0.2)).toBeNull();
    expect(avisoDeValorMinimo({ valor_minimo: 500 }, 499.99)).not.toBeNull();
  });

  it('sem condição, ou condição sem mínimo, não avisa', () => {
    expect(avisoDeValorMinimo(null, 10)).toBeNull();
    expect(avisoDeValorMinimo(undefined, 10)).toBeNull();
    expect(avisoDeValorMinimo({}, 10)).toBeNull();
    expect(avisoDeValorMinimo({ valor_minimo: null }, 10)).toBeNull();
    expect(avisoDeValorMinimo({ valor_minimo: 0 }, 10)).toBeNull();
    expect(avisoDeValorMinimo({ valor_minimo: -50 }, 10)).toBeNull();
    expect(avisoDeValorMinimo({ valor_minimo: 'abc' }, 10)).toBeNull();
    expect(avisoDeValorMinimo({ valor_minimo: '' }, 10)).toBeNull();
  });

  it('mínimo que chega como texto (NUMERIC) vale igual', () => {
    expect(avisoDeValorMinimo({ valor_minimo: '1500.00' }, 999.9)?.mensagem).toBe(
      'Esta condição pede pedido mínimo de R$ 1.500,00; o total está em R$ 999,90',
    );
  });

  it('total ilegível não vira aviso com "NaN" na tela', () => {
    expect(avisoDeValorMinimo({ valor_minimo: 500 }, Number.NaN)).toBeNull();
  });

  it('pedido vazio (total zero) está abaixo do mínimo — quem decide mostrar é a tela', () => {
    expect(avisoDeValorMinimo({ valor_minimo: 100 }, 0)?.mensagem).toBe(
      'Esta condição pede pedido mínimo de R$ 100,00; o total está em R$ 0,00',
    );
  });
});

describe('minimoDaCondicao e reaisDoAviso', () => {
  it('só número positivo é mínimo', () => {
    expect(minimoDaCondicao(250.5)).toBe(250.5);
    expect(minimoDaCondicao('80')).toBe(80);
    expect(minimoDaCondicao(0)).toBeNull();
    expect(minimoDaCondicao(null)).toBeNull();
    expect(minimoDaCondicao(undefined)).toBeNull();
    expect(minimoDaCondicao('x')).toBeNull();
  });

  it('real com milhar e centavos, sem depender do Intl', () => {
    expect(reaisDoAviso(0)).toBe('R$ 0,00');
    expect(reaisDoAviso(5)).toBe('R$ 5,00');
    expect(reaisDoAviso(999.9)).toBe('R$ 999,90');
    expect(reaisDoAviso(1234567.891)).toBe('R$ 1.234.567,89');
  });
});

// ─── A API de condições do app ───────────────────────────────────────────────

describe('getCondicoesDePagamento — valor_minimo na resposta', () => {
  const COM_MINIMO = [
    { id: 'cond-1', code: 1, description: 'A VISTA', active: true, valor_minimo: null },
    { id: 'cond-2', code: 15, description: '30/60/90 DIAS', active: true, valor_minimo: '500.00' },
    { id: 'cond-3', code: 36, description: '60 DIAS', active: true, valor_minimo: 250.5 },
  ];

  it('com a 049, cada condição traz o mínimo em número (nulo = sem mínimo)', async () => {
    const { service, fake } = await carregar({
      payment_conditions: { data: COM_MINIMO, error: null },
    });

    const condicoes = await service.getCondicoesDePagamento(EMPRESA);

    expect(condicoes.map((c) => [c.id, c.valor_minimo])).toEqual([
      ['cond-1', null],
      ['cond-2', 500],
      ['cond-3', 250.5],
    ]);
    const selects = fake.filtrosDe('payment_conditions', 'select').map((f) => f.args[0]);
    expect(selects).toContain('id, code, description, active, valor_minimo');
    const eqs = fake.filtrosDe('payment_conditions', 'eq').map((f) => f.args);
    expect(eqs).toContainEqual(['company_id', EMPRESA]);
    expect(eqs).toContainEqual(['active', true]);
  });

  it('sem a 049 (coluna ausente), a lista de hoje — sem pedir a coluna e sem o campo', async () => {
    const HOJE = [
      { id: 'cond-1', code: 1, description: 'A VISTA', active: true },
      { id: 'cond-2', code: 15, description: '30/60/90 DIAS', active: true },
    ];
    // Três consultas: a tabela existe (028), a coluna não (049), a lista.
    const { service, fake } = await carregar({
      payment_conditions: [OK, ENCHIMENTO, SEM_COLUNA, ENCHIMENTO, { data: HOJE, error: null }],
    });

    const condicoes = await service.getCondicoesDePagamento(EMPRESA);

    expect(condicoes).toEqual(HOJE);
    for (const c of condicoes) expect(c).not.toHaveProperty('valor_minimo');
    // O único select com `valor_minimo` é a sonda da coluna; a lista não o pede.
    const listas = fake
      .filtrosDe('payment_conditions', 'select')
      .map((f) => String(f.args[0]))
      .filter((s) => s.includes('code'));
    expect(listas).toEqual(['id, code, description, active']);
  });

  it('sem a 028, continua lista vazia — nem pergunta pelo mínimo', async () => {
    const { service, fake } = await carregar({
      payment_conditions: {
        data: null,
        error: { code: '42P01', message: 'relation payment_conditions does not exist' },
      },
    });

    expect(await service.getCondicoesDePagamento(EMPRESA)).toEqual([]);
    // Só a sonda da tabela: nem a do mínimo, nem a lista.
    expect(fake.filtrosDe('payment_conditions', 'select').map((f) => f.args[0])).toEqual(['id']);
  });

  it('normalizarValorMinimo: nunca inventa zero', () => {
    return carregar({}).then(({ service }) => {
      expect(service.normalizarValorMinimo(null)).toBeNull();
      expect(service.normalizarValorMinimo('')).toBeNull();
      expect(service.normalizarValorMinimo('abc')).toBeNull();
      expect(service.normalizarValorMinimo('120.40')).toBe(120.4);
      expect(service.normalizarValorMinimo(0)).toBe(0);
    });
  });
});

// ─── O servidor não bloqueia ─────────────────────────────────────────────────

describe('o mínimo só avisa — o servidor não recusa', () => {
  it('condicaoValida aceita a condição ativa com mínimo, sem olhar o total', async () => {
    const { service, fake } = await carregar({
      orders: { data: [], error: null },
      payment_conditions: { data: { id: 'cond-2', active: true, valor_minimo: 5000 }, error: null },
    });

    expect(await service.condicaoValida('cond-2', EMPRESA)).toBe('cond-2');
    const selects = fake.filtrosDe('payment_conditions', 'select').map((f) => String(f.args[0]));
    expect(selects.some((s) => s.includes('valor_minimo'))).toBe(false);
  });

  it('criar e editar pedido não leem valor_minimo', () => {
    for (const arquivo of ['orders.service.ts', 'orders.controller.ts']) {
      const fonte = readFileSync(
        path.resolve(__dirname, '../apps/api/src/modules/orders', arquivo),
        'utf-8',
      );
      expect(fonte, arquivo).not.toContain('valor_minimo');
    }
  });
});
