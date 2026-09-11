import { describe, it, expect, vi, beforeEach } from 'vitest';
import { REGUA_PADRAO, reguaValida, frescorPorDias, diasSemComprar } from '@csb/shared';
import { criarSupabaseFake, type RespostaTabela } from './supabaseFake.js';
import { esquecerDeteccoes } from '../apps/api/src/lib/detectarColuna.js';

/**
 * A régua da carteira virou configuração da fábrica (migração 043) a pedido do
 * Yan (11/09/2026): "quero que o admin possa mudar isso manualmente". Aqui
 * moram as duas garantias que o resto do app depende: a régua nunca sai
 * invertida, e a API não finge ter gravado quando a 043 ainda não rodou.
 */

describe('reguaValida', () => {
  it('arruma número quebrado e prende na faixa possível', () => {
    expect(reguaValida({ atencao: 45.4, esfriado: 90.6 })).toEqual({ atencao: 45, esfriado: 91 });
    expect(reguaValida({ atencao: 0, esfriado: 99_999 })).toEqual({ atencao: 1, esfriado: 3650 });
    expect(reguaValida(null)).toEqual(REGUA_PADRAO);
    expect(reguaValida({ atencao: Number.NaN, esfriado: 200 })).toEqual({ atencao: 90, esfriado: 200 });
  });

  it('vermelho antes do amarelo é recusado — a faixa do meio sumiria', () => {
    expect(reguaValida({ atencao: 200, esfriado: 100 })).toEqual(REGUA_PADRAO);
    expect(reguaValida({ atencao: 90, esfriado: 90 })).toEqual(REGUA_PADRAO);
  });
});

describe('frescorPorDias', () => {
  it('a mesma carteira muda de cor quando a régua aperta', () => {
    expect(frescorPorDias(45)).toBe('ativo');
    expect(frescorPorDias(45, { atencao: 30, esfriado: 60 })).toBe('esfriando');
    expect(frescorPorDias(70, { atencao: 30, esfriado: 60 })).toBe('parado');
  });

  it('sem data não inventa faixa', () => {
    expect(diasSemComprar(null)).toBeNull();
    expect(diasSemComprar('não é data')).toBeNull();
    expect(diasSemComprar('2026-09-01', new Date('2026-09-11').getTime())).toBe(10);
  });
});

async function carregarServico(companies: RespostaTabela[]) {
  const fake = criarSupabaseFake({ companies } as never);
  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
  const mod = await import('../apps/api/src/modules/company/carteira.service.js');
  return { ...mod, fake };
}

const SEM_A_COLUNA: RespostaTabela = {
  data: null,
  error: { message: 'column companies.carteira_atencao_dias does not exist', code: '42703' },
};

beforeEach(() => {
  vi.resetModules();
  esquecerDeteccoes();
});

describe('lerRegua / salvarRegua', () => {
  it('devolve o que a empresa configurou', async () => {
    const { lerRegua } = await carregarServico([
      { data: [], error: null }, // detecção: a 043 rodou
      { data: { carteira_atencao_dias: 45, carteira_esfriado_dias: 120 }, error: null },
    ]);
    expect(await lerRegua('empresa-1')).toEqual({ atencao: 45, esfriado: 120 });
  });

  it('sem a migração 043, a régua de sempre — e nada é gravado', async () => {
    const { lerRegua, salvarRegua, fake } = await carregarServico([SEM_A_COLUNA]);

    expect(await lerRegua('empresa-1')).toEqual(REGUA_PADRAO);
    expect(await salvarRegua('empresa-1', { atencao: 45, esfriado: 120 })).toEqual({
      ok: false,
      motivo: 'sem_migracao',
    });
    expect(fake.ultimaGravacao('companies', 'update')).toBeUndefined();
  });

  it('grava o que o admin pediu quando a ordem faz sentido', async () => {
    const { salvarRegua, fake } = await carregarServico([
      { data: [], error: null }, // detecção
      { data: null, error: null }, // o update
    ]);

    expect(await salvarRegua('empresa-1', { atencao: 45, esfriado: 120 })).toEqual({
      ok: true,
      regua: { atencao: 45, esfriado: 120 },
    });
    expect(fake.ultimaGravacao('companies', 'update')?.valores).toMatchObject({
      carteira_atencao_dias: 45,
      carteira_esfriado_dias: 120,
    });
  });

  it('recusa o vermelho antes do amarelo dizendo por quê, em vez de calar e salvar 90/180', async () => {
    const { salvarRegua, fake } = await carregarServico([{ data: [], error: null }]);

    expect(await salvarRegua('empresa-1', { atencao: 200, esfriado: 100 })).toEqual({
      ok: false,
      motivo: 'ordem',
    });
    expect(fake.ultimaGravacao('companies', 'update')).toBeUndefined();
  });
});
