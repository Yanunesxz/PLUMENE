import { describe, it, expect, vi, beforeEach } from 'vitest';
import { criarSupabaseFake, type RespostaTabela } from './supabaseFake.js';

/**
 * Corrigir o número do Control (Yan, 11/09/2026).
 *
 * A Larissa lança o pedido digitando o número que o Control deu. Se ela digita
 * errado, o faturamento procura por um número que não existe lá e o pedido
 * some do meio. Dá para corrigir enquanto a nota não saiu — depois dela o
 * número já viajou para a contabilidade e trocar aqui só criaria discórdia.
 */
async function carregarServico(orders: RespostaTabela[]) {
  const fake = criarSupabaseFake({ orders } as never);
  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
  const mod = await import('../apps/api/src/modules/orders/orders.service.js');
  return { ...mod, fake };
}

const LANCADO = { id: 'o1', status: 'sent_erp', invoiced: false, erp_order_id: 'CS17379' };
const VAZIO: RespostaTabela = { data: null, error: null };

beforeEach(() => {
  vi.resetModules();
});

describe('corrigirNumeroErp', () => {
  it('grava o número novo, normalizado, quando ninguém mais o usa', async () => {
    const { corrigirNumeroErp, fake } = await carregarServico([
      { data: LANCADO, error: null }, // o pedido
      VAZIO,
      { data: [], error: null }, // ninguém usa o número novo
      VAZIO,
      { data: null, error: null }, // o update
    ]);

    const r = await corrigirNumeroErp('o1', 'empresa-1', ' cs 17380 ');

    expect(r).toEqual({ ok: true, erp_order_id: 'CS17380' });
    const gravado = fake.ultimaGravacao('orders', 'update');
    expect((gravado?.valores as { erp_order_id: string }).erp_order_id).toBe('CS17380');
  });

  it('recusa o número que já é de outro pedido — dois pedidos com o mesmo número é o estrago', async () => {
    const { corrigirNumeroErp, fake } = await carregarServico([
      { data: LANCADO, error: null },
      VAZIO,
      { data: [{ id: 'o2' }], error: null }, // o número novo é do o2
    ]);

    expect(await corrigirNumeroErp('o1', 'empresa-1', 'CS17380')).toEqual({ ok: false, motivo: 'em_uso' });
    expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();
  });

  it('não mexe no pedido já faturado', async () => {
    const { corrigirNumeroErp, fake } = await carregarServico([
      { data: { ...LANCADO, invoiced: true }, error: null },
    ]);

    expect(await corrigirNumeroErp('o1', 'empresa-1', 'CS17380')).toEqual({ ok: false, motivo: 'ja_faturado' });
    expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();
  });

  it('não inventa número em pedido que ainda não foi lançado', async () => {
    const { corrigirNumeroErp } = await carregarServico([
      { data: { id: 'o1', status: 'approved', invoiced: false, erp_order_id: null }, error: null },
    ]);

    expect(await corrigirNumeroErp('o1', 'empresa-1', 'CS17380')).toEqual({ ok: false, motivo: 'nao_lancado' });
  });

  it('recusa o que não tem cara de número do Control antes de tocar no banco', async () => {
    const { corrigirNumeroErp, fake } = await carregarServico([{ data: LANCADO, error: null }]);

    expect(await corrigirNumeroErp('o1', 'empresa-1', '17380')).toEqual({ ok: false, motivo: 'formato' });
    expect(fake.filtrosDe('orders')).toHaveLength(0);
  });
});
