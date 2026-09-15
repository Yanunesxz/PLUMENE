import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { criarSupabaseFake } from './supabaseFake.js';

/**
 * O rastro do pedido com o Control (migração 048, C e D): a origem do número no
 * próprio update e o evento em order_erp_events.
 *
 * Tranca: sem a 048 o update fica igual ao de hoje e nada é gravado; o evento
 * nunca derruba quem chamou; e `antes`/`depois` não carregam dado de cliente.
 */

const EMPRESA = '00000000-0000-0000-0000-00000000000a';
const PEDIDO = '00000000-0000-0000-0000-0000000000f1';
const USUARIO = '00000000-0000-0000-0000-0000000000c1';

const ENCHIMENTO = { data: [], error: null };
const SONDA_OK = { data: [{ id: 'x' }], error: null };
const SEM_TABELA = { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.order_erp_events' in the schema cache" } };
const SEM_COLUNA = { data: null, error: { code: '42703', message: 'column orders.erp_order_source does not exist' } };

async function carregar(respostas: Record<string, unknown>) {
  const fake = criarSupabaseFake(respostas as never);
  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
  const mod = await import('../apps/api/src/modules/orders/eventosErp.service.js');
  const deteccao = await import('../apps/api/src/lib/detectarColuna.js');
  deteccao.esquecerDeteccoes();
  return { ...mod, fake };
}

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.doUnmock('../apps/api/src/config/supabase.js');
  vi.restoreAllMocks();
});

describe('registrarEventoErp', () => {
  it('grava o evento com empresa, pedido, tipo, origem e o rastro', async () => {
    const { registrarEventoErp, fake } = await carregar({
      order_erp_events: [SONDA_OK, ENCHIMENTO, { data: null, error: null }],
    });
    const r = await registrarEventoErp({
      company_id: EMPRESA,
      order_id: PEDIDO,
      order_number: 14600,
      tipo: 'numero_corrigido',
      origem: 'tela',
      por: USUARIO,
      por_nome: 'Usuário Teste',
      motivo: 'digitado errado',
      antes: { erp_order_id: 'ZZ0000001' },
      depois: { erp_order_id: 'ZZ0000002' },
    });
    expect(r).toBe('gravado');
    const v = fake.ultimaGravacao('order_erp_events', 'insert')!.valores as Record<string, unknown>;
    expect(v).toMatchObject({
      company_id: EMPRESA,
      order_id: PEDIDO,
      order_number: 14600,
      tipo: 'numero_corrigido',
      origem: 'tela',
      parceiro: null,
      por: USUARIO,
      por_nome: 'Usuário Teste',
      motivo: 'digitado errado',
      antes: { erp_order_id: 'ZZ0000001' },
      depois: { erp_order_id: 'ZZ0000002' },
    });
    expect(typeof v['created_at']).toBe('string');
    expect(v['updated_at']).toBe(v['created_at']);
  });

  it('pela API: parceiro no evento, sem usuário', async () => {
    const { registrarEventoErp, fake } = await carregar({
      order_erp_events: [SONDA_OK, ENCHIMENTO, { data: null, error: null }],
    });
    await registrarEventoErp({
      company_id: EMPRESA,
      order_id: PEDIDO,
      tipo: 'numero_gravado',
      origem: 'api',
      parceiro: 'Parceiro Teste',
      depois: { erp_order_id: 'ZZ0000001' },
    });
    expect(fake.ultimaGravacao('order_erp_events', 'insert')!.valores).toMatchObject({
      parceiro: 'Parceiro Teste',
      por: null,
      por_nome: null,
      order_number: null,
      motivo: null,
      antes: null,
      depois: { erp_order_id: 'ZZ0000001' },
    });
  });

  it('antes e depois levam só o estado do pedido e da nota — nada de cliente', async () => {
    const { registrarEventoErp, fake } = await carregar({
      order_erp_events: [SONDA_OK, ENCHIMENTO, { data: null, error: null }],
    });
    await registrarEventoErp({
      company_id: EMPRESA,
      order_id: PEDIDO,
      tipo: 'faturado',
      origem: 'api',
      antes: { invoiced: false, invoiced_at: null, invoiced_total: null, customer: { name: 'Cliente Teste' } },
      depois: {
        invoiced: true,
        invoiced_at: '2026-09-15T14:00:00.000Z',
        invoiced_total: 100,
        cnpj: '00.000.000/0001-00',
        guest_name: 'Cliente Teste',
        numero: '1',
        serie: '1',
      },
    });
    const v = fake.ultimaGravacao('order_erp_events', 'insert')!.valores as Record<string, unknown>;
    expect(v['antes']).toEqual({ invoiced: false, invoiced_at: null, invoiced_total: null });
    expect(v['depois']).toEqual({
      invoiced: true,
      invoiced_at: '2026-09-15T14:00:00.000Z',
      invoiced_total: 100,
      numero: '1',
      serie: '1',
    });
  });

  it('sem a 048: não grava e não lança', async () => {
    const { registrarEventoErp, fake } = await carregar({ order_erp_events: [SEM_TABELA] });
    const r = await registrarEventoErp({ company_id: EMPRESA, order_id: PEDIDO, tipo: 'excluido', origem: 'tela' });
    expect(r).toBe('sem_tabela');
    expect(fake.gravacoes).toHaveLength(0);
  });

  it('banco recusou o insert: não lança, avisa no console', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { registrarEventoErp } = await carregar({
      order_erp_events: [SONDA_OK, ENCHIMENTO, { data: null, error: { code: '23514', message: 'violates check constraint' } }],
    });
    await expect(
      registrarEventoErp({ company_id: EMPRESA, order_id: PEDIDO, tipo: 'faturado', origem: 'api' }),
    ).resolves.toBe('falhou');
    expect(erro).toHaveBeenCalledTimes(1);
  });

  it('exceção do cliente do banco também não sobe', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.doMock('../apps/api/src/config/supabase.js', () => ({
      supabase: {
        from: () => {
          throw new Error('cliente quebrado');
        },
      },
    }));
    const { registrarEventoErp } = await import('../apps/api/src/modules/orders/eventosErp.service.js');
    await expect(
      registrarEventoErp({ company_id: EMPRESA, order_id: PEDIDO, tipo: 'faturado', origem: 'api' }),
    ).resolves.toBe('falhou');
  });
});

describe('gravarOrigemDoNumero', () => {
  it('com a 048: acrescenta origem, momento e autor no MESMO objeto do update', async () => {
    const { gravarOrigemDoNumero } = await carregar({ orders: [SONDA_OK] });
    const agora = '2026-09-15T14:00:00.000Z';
    const patch = { erp_order_id: 'ZZ0000001', status: 'sent_erp', updated_at: agora };
    const r = await gravarOrigemDoNumero(patch, 'lancamento', USUARIO);
    expect(r).toBe(patch);
    expect(patch).toEqual({
      erp_order_id: 'ZZ0000001',
      status: 'sent_erp',
      updated_at: agora,
      erp_order_source: 'lancamento',
      erp_order_set_at: agora,
      erp_order_set_by: USUARIO,
    });
  });

  it('pela API: sem autor, e o momento é agora quando o patch não traz updated_at', async () => {
    const { gravarOrigemDoNumero } = await carregar({ orders: [SONDA_OK] });
    const patch: Record<string, unknown> = { erp_order_id: 'ZZ0000001' };
    await gravarOrigemDoNumero(patch, 'api');
    expect(patch['erp_order_source']).toBe('api');
    expect(patch['erp_order_set_by']).toBeNull();
    expect(Number.isNaN(Date.parse(String(patch['erp_order_set_at'])))).toBe(false);
  });

  it('sem a 048: o update fica exatamente igual ao de hoje', async () => {
    const { gravarOrigemDoNumero, fake } = await carregar({ orders: [SEM_COLUNA] });
    const patch = { erp_order_id: 'ZZ0000001', updated_at: '2026-09-15T14:00:00.000Z' };
    await gravarOrigemDoNumero(patch, 'correcao', USUARIO);
    expect(patch).toEqual({ erp_order_id: 'ZZ0000001', updated_at: '2026-09-15T14:00:00.000Z' });
    expect(fake.filtrosDe('orders', 'select')).toEqual([
      { tabela: 'orders', metodo: 'select', args: ['erp_order_source'] },
    ]);
  });

  it('banco que não respondeu sobre a coluna: não acrescenta e não lança', async () => {
    const { gravarOrigemDoNumero } = await carregar({
      orders: [{ data: null, error: { code: '503', message: 'service unavailable' } }],
    });
    const patch = { erp_order_id: 'ZZ0000001' };
    await expect(gravarOrigemDoNumero(patch, 'conciliacao')).resolves.toEqual({ erp_order_id: 'ZZ0000001' });
  });
});
