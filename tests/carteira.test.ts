import { describe, it, expect, vi, beforeEach } from 'vitest';
import { criarSupabaseFake } from './supabaseFake.js';

/**
 * Carteira do representante.
 *
 * Em produção, 1.352 dos 1.353 clientes vieram do ERP com `rep_id` nulo — o
 * dono só existe em `rep_erp_id`. Enquanto a consulta filtrava só por `rep_id`,
 * o representante logado enxergava UM cliente. Estes testes travam a regra nova.
 */

const EMPRESA = 'empresa-1';
const REP = 'rep-1';

async function carregarServico(clientes: unknown[]) {
  const fake = criarSupabaseFake({ customers: { data: clientes, error: null } } as never);
  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
  const mod = await import('../apps/api/src/modules/customers/customers.service.js');
  return { ...mod, fake };
}

beforeEach(() => {
  vi.resetModules();
});

describe('quem o representante enxerga', () => {
  it('busca por rep_id E por código ERP quando o rep tem código', async () => {
    const { getCustomers, fake } = await carregarServico([]);

    await getCustomers(EMPRESA, 'rep', REP, undefined, true, '00779');

    const ors = fake.filtrosDe('customers', 'or');
    expect(ors[0]!.args[0]).toBe('rep_id.eq.rep-1,rep_erp_id.eq.00779');
  });

  it('cai para só rep_id quando o rep ainda não tem código ERP', async () => {
    const { getCustomers, fake } = await carregarServico([]);

    await getCustomers(EMPRESA, 'rep', REP, undefined, true, null);

    expect(fake.filtrosDe('customers', 'or')).toHaveLength(0);
    const eqs = fake.filtrosDe('customers', 'eq').map((f) => f.args);
    expect(eqs).toContainEqual(['rep_id', REP]);
  });

  it('gerente não recebe filtro de dono nenhum', async () => {
    const { getCustomers, fake } = await carregarServico([]);

    await getCustomers(EMPRESA, 'manager', 'ger-1', undefined, true, null);

    const eqs = fake.filtrosDe('customers', 'eq').map((f) => f.args[0]);
    expect(eqs).not.toContain('rep_id');
    expect(fake.filtrosDe('customers', 'or')).toHaveLength(0);
  });

  it('sempre restringe pela empresa, qualquer que seja o papel', async () => {
    for (const papel of ['rep', 'manager', 'admin'] as const) {
      vi.resetModules();
      const { getCustomers, fake } = await carregarServico([]);
      await getCustomers(EMPRESA, papel, REP, undefined, true, '00779');
      const eqs = fake.filtrosDe('customers', 'eq').map((f) => f.args);
      expect(eqs).toContainEqual(['company_id', EMPRESA]);
    }
  });

  it('limpa caracteres que quebrariam o filtro do PostgREST na busca', async () => {
    const { getCustomers, fake } = await carregarServico([]);

    await getCustomers(EMPRESA, 'manager', 'ger-1', 'loja (centro), 10\\', true, null);

    const busca = fake.filtrosDe('customers', 'or').at(-1)!.args[0] as string;
    // A vírgula do meio é do PostgREST (separa as duas condições); o que não
    // pode sobrar é parêntese, barra ou vírgula DENTRO do termo digitado.
    const termo = /name\.ilike\.%(.*?)%/.exec(busca)![1]!;
    expect(termo).not.toMatch(/[(),\\]/);
    expect(termo).toContain('loja');
    expect(termo).toContain('centro');
  });
});
