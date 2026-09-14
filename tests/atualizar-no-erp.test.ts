import { describe, it, expect, vi, beforeEach } from 'vitest';
import { criarSupabaseFake, type RespostaTabela } from './supabaseFake.js';
import { esquecerDeteccoes } from '../apps/api/src/lib/detectarColuna.js';

/**
 * "ATUALIZAR NO ERP" (migração 046).
 *
 * Pedido do Yan (11/09/2026): "depois que o pedido for enviado pelas vendedoras
 * internas e elas alterarem ele, temos que ter um botão depois que editou as
 * peças como 'atualizar no ERP', porque se ela mudar por lá tem que mudar no
 * ERP principal também".
 *
 * O buraco que isto fecha: a venda interna mexe no PRÓPRIO pedido até o carimbo
 * de faturado (regra da 031), inclusive depois de a Larissa lançar no Control.
 * Sem aviso, a nota sai pelo pedido velho.
 *
 * O que estes testes trancam: o lançamento tira a foto; pedir só vale em pedido
 * já lançado; confirmar tira a foto DE NOVO (e é isso que apaga a divergência,
 * em vez de um booleano que pode dessincronizar); e sem a 046 nada quebra.
 */

async function carregarServico(respostas: Record<string, RespostaTabela | RespostaTabela[]>) {
  const fake = criarSupabaseFake(respostas as never);
  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
  const mod = await import('../apps/api/src/modules/orders/erpSync.service.js');
  return { ...mod, fake };
}

const EMPRESA = 'empresa-1';
const PEDIDO_LANCADO = {
  id: 'o1',
  order_number: 14627,
  erp_order_id: 'CS17379',
  total: 500,
  items: [{ quantity: 12 }, { quantity: 8 }],
};

const SEM_A_TABELA: RespostaTabela = {
  data: null,
  error: { message: 'relation "order_erp_sync" does not exist', code: '42P01' },
};

beforeEach(() => {
  vi.resetModules();
  esquecerDeteccoes();
});

describe('registrarNoErp — a foto do que o Control conhece', () => {
  it('grava as peças e o número do Control no lançamento', async () => {
    const { registrarNoErp, fake } = await carregarServico({
      order_erp_sync: [{ data: [], error: null }, { data: null, error: null }],
      orders: { data: PEDIDO_LANCADO, error: null },
    });

    expect(await registrarNoErp('o1', EMPRESA, 'larissa')).toBe('guardada');
    const gravado = fake.ultimaGravacao('order_erp_sync')?.valores as {
      pecas: number;
      total: number;
      erp_order_id: string;
      pedido_em: string | null;
    };
    expect(gravado).toMatchObject({ pecas: 20, total: 500, erp_order_id: 'CS17379' });
    // Foto nova zera o pedido de atualização: o que foi pedido acabou de ser feito.
    expect(gravado.pedido_em).toBeNull();
  });

  it('sem a migração 046, o lançamento continua acontecendo — só sem foto', async () => {
    const { registrarNoErp, fake } = await carregarServico({ order_erp_sync: SEM_A_TABELA });

    expect(await registrarNoErp('o1', EMPRESA)).toBe('sem_tabela');
    expect(fake.ultimaGravacao('order_erp_sync')).toBeUndefined();
  });
});

describe('pedirAtualizacao — o botão da venda interna', () => {
  it('registra quem pediu, quando e o recado', async () => {
    const { pedirAtualizacao, fake } = await carregarServico({
      order_erp_sync: [
        { data: [], error: null }, // detecção
        // O dublê adianta a próxima resposta a cada consulta; esta linha é o
        // espaço dessa antecipação, para a seguinte cair na ida certa ao banco.
        { data: [], error: null },
        { data: { order_id: 'o1' }, error: null }, // já foi lançado
        {
          data: {
            erp_order_id: 'CS17379',
            total: 500,
            pecas: 20,
            snapshot: PEDIDO_LANCADO,
            confirmado_em: '2026-09-11T10:00:00Z',
            pedido_em: '2026-09-11T14:00:00Z',
            observacao: 'tirei 6 pecas da 0124',
          },
          error: null,
        },
      ],
    });

    const r = await pedirAtualizacao('o1', EMPRESA, 'simone', '  tirei 6 pecas da 0124  ');

    expect(r.ok).toBe(true);
    const pedido = fake.ultimaGravacao('order_erp_sync', 'update')?.valores as {
      pedido_por: string;
      observacao: string;
    };
    expect(pedido).toMatchObject({ pedido_por: 'simone', observacao: 'tirei 6 pecas da 0124' });
  });

  it('pedido que nunca foi ao Control não tem o que atualizar lá', async () => {
    const { pedirAtualizacao, fake } = await carregarServico({
      order_erp_sync: [
        { data: [], error: null }, // detecção
        { data: null, error: null }, // sem foto: nunca lançado
      ],
    });

    expect(await pedirAtualizacao('o1', EMPRESA, 'simone')).toEqual({
      ok: false,
      motivo: 'nao_lancado',
    });
    expect(fake.ultimaGravacao('order_erp_sync', 'update')).toBeUndefined();
  });
});

describe('confirmarAtualizacao — "já atualizei no Control"', () => {
  it('tira a foto DE NOVO, que é o que apaga a divergência', async () => {
    const { confirmarAtualizacao, fake } = await carregarServico({
      order_erp_sync: [
        { data: [], error: null }, // detecção
        { data: [], error: null }, // o espaço da antecipação do dublê
        { data: { order_id: 'o1' }, error: null }, // existe
        {
          data: {
            erp_order_id: 'CS17379',
            total: 420,
            pecas: 14,
            snapshot: { ...PEDIDO_LANCADO, items: [{ quantity: 6 }, { quantity: 8 }] },
            confirmado_em: '2026-09-11T15:00:00Z',
            pedido_em: null,
            observacao: null,
          },
          error: null,
        },
      ],
      orders: { data: { ...PEDIDO_LANCADO, total: 420, items: [{ quantity: 6 }, { quantity: 8 }] }, error: null },
    });

    const r = await confirmarAtualizacao('o1', EMPRESA, 'larissa');

    expect(r.ok).toBe(true);
    const gravado = fake.ultimaGravacao('order_erp_sync')?.valores as {
      pecas: number;
      confirmado_por: string;
      pedido_em: string | null;
    };
    // A foto passa a ser o pedido de HOJE: 14 peças, não as 20 do lançamento.
    expect(gravado).toMatchObject({ pecas: 14, confirmado_por: 'larissa' });
    expect(gravado.pedido_em).toBeNull();
  });
});

/**
 * O número do Control também chega SEM a Larissa digitar: o ERP do parceiro
 * confirma a importação por POST /partner/v1/pedidos/:id/confirmar. Esse
 * caminho grava o número e força sent_erp — e precisa tirar a mesma foto,
 * senão pedido confirmado pela API nunca acusaria "mudou depois de ir para
 * o ERP" quando a venda interna editasse.
 */
describe('a confirmação pela API do parceiro também tira a foto', () => {
  it('grava a foto com o número que o ERP mandou', async () => {
    const fake = criarSupabaseFake({
      orders: [
        { data: { id: 'o1', status: 'approved', erp_order_id: null }, error: null }, // o pedido
        { data: [], error: null }, // o espaço da antecipação do dublê
        { data: null, error: null }, // o update
        { data: { ...PEDIDO_LANCADO, erp_order_id: 'SX14627' }, error: null }, // a foto
      ],
      order_erp_sync: [
        { data: [], error: null }, // detecção
        { data: null, error: null }, // o upsert
      ],
    } as never);
    vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
    const { confirmOrderImport } = await import('../apps/api/src/modules/partner/partner.service.js');

    const r = await confirmOrderImport(EMPRESA, 'o1', 'sx-14627');

    expect(r).toEqual({ outcome: 'ok', ja_confirmado: false });
    const foto = fake.ultimaGravacao('order_erp_sync', 'upsert')?.valores as {
      erp_order_id: string;
      pecas: number;
    };
    expect(foto).toMatchObject({ erp_order_id: 'SX14627', pecas: 20 });
  });
});
