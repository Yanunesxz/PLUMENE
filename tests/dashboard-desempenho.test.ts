import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { criarSupabaseFake } from './supabaseFake.js';
import { competenciaAnterior, desempenhoDoMes, enviadoNoMes, type Order } from '@csb/shared';

/**
 * Dashboard do gerente comercial (Yan, 19/10/2026): as metas e o desempenho
 * de todos os representantes num mês. O "enviado" tem de ser a MESMA conta da
 * Minha Área do rep — o gerente não pode ver um número e o rep outro.
 */

const pedido = (p: Partial<Order>): Order =>
  ({
    id: Math.random().toString(36).slice(2),
    company_id: 'empresa-1',
    rep_id: 'rep-1',
    customer_id: 'c1',
    status: 'approved',
    total: 1000,
    created_at: '2026-10-05T12:00:00',
    ...p,
  }) as Order;

const FAIXAS = [
  { meta: 50_000, bonus: 500 },
  { meta: 80_000, bonus: 1_000 },
];

describe('desempenhoDoMes — a linha de cada representante', () => {
  it('soma só o que conta para a meta, no mês do pedido', () => {
    const d = desempenhoDoMes(
      [
        pedido({ total: 30_000 }),
        pedido({ total: 25_000, customer_id: 'c2', status: 'sent_erp' }),
        pedido({ total: 9_000, status: 'draft' }), // rascunho não conta
        pedido({ total: 9_000, status: 'rejected' }), // cancelado não conta
        pedido({ total: 9_000, status: 'pending_approval' }), // na fila da Larissa: ainda não conta
        pedido({ total: 9_000, inactive: true } as Partial<Order>), // "Pedido inativo" (055) sai da conta
        pedido({ total: 9_000, created_at: '2026-09-30T12:00:00' }), // outro mês
      ],
      FAIXAS,
      '2026-10-01',
      new Date('2026-10-31T12:00:00'),
    );
    expect(d.enviado).toBe(55_000);
    expect(d.pedidos).toBe(2);
    expect(d.clientes).toBe(2);
    expect(d.faixa).toEqual({ meta: 50_000, bonus: 500 });
    expect(d.numeroDaFaixa).toBe(1);
    expect(d.proxima).toEqual({ meta: 80_000, bonus: 1_000 });
    expect(d.falta).toBe(25_000);
  });

  it('projeta o mês pelo ritmo: metade do mês com R$ 30 mil → ~R$ 62 mil, alcança a 1ª faixa', () => {
    const d = desempenhoDoMes([pedido({ total: 30_000 })], FAIXAS, '2026-10-01', new Date('2026-10-15T12:00:00'));
    expect(Math.round(d.projecao)).toBe(62_000);
    expect(d.faixa).toBeNull();
    expect(d.faixaProjetada).toEqual({ meta: 50_000, bonus: 500 });
  });

  it('mês fechado: a projeção é o próprio enviado', () => {
    const d = desempenhoDoMes([pedido({ total: 30_000 })], FAIXAS, '2026-10-01', new Date('2026-11-10T12:00:00'));
    expect(d.projecao).toBe(30_000);
  });

  it('faturado é pela data da nota, com o valor faturado', () => {
    const d = desempenhoDoMes(
      [pedido({ invoiced: true, invoiced_at: '2026-10-20T10:00:00', invoiced_total: 800, created_at: '2026-09-20T10:00:00' })],
      FAIXAS,
      '2026-10-01',
    );
    expect(d.faturado).toBe(800);
  });

  it('sem meta: nada de faixa, régua zerada, e o enviado continua contando', () => {
    const d = desempenhoDoMes([pedido({ total: 5_000 })], [], '2026-10-01');
    expect(d.enviado).toBe(5_000);
    expect(d.faixa).toBeNull();
    expect(d.posicao).toBe(0);
  });

  it('mês anterior para a comparação, virando o ano', () => {
    expect(competenciaAnterior('2026-01-01')).toBe('2025-12-01');
    expect(enviadoNoMes([pedido({ created_at: '2025-12-10T12:00:00' })], '2025-12-01')).toBe(1000);
  });
});

const SEGREDO = 'segredo-de-teste-nao-usar-em-producao'; // igual ao tests/setup.ts
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
function assinar(payload: Record<string, unknown>): string {
  const cabecalho = b64({ alg: 'HS256', typ: 'JWT' });
  const agora = Math.floor(Date.now() / 1000);
  const corpo = b64({ ...payload, iat: agora, exp: agora + 3600 });
  const assinatura = crypto.createHmac('sha256', SEGREDO).update(`${cabecalho}.${corpo}`).digest('base64url');
  return `${cabecalho}.${corpo}.${assinatura}`;
}
const base = { email: 'x@csb.com', company_id: 'empresa-1', price_table_id: null };

beforeEach(() => {
  vi.resetModules();
});

describe('GET /reps/metas — as faixas da equipe num mês', { timeout: 20_000 }, () => {
  async function subir() {
    const fake = criarSupabaseFake({
      rep_bonus_tiers: {
        data: [
          // rep-1: cadastro em setembro, herdado em outubro
          { user_id: 'rep-1', competencia: '2026-09-01', ordem: 1, meta: '80000', bonus: '1000' },
          { user_id: 'rep-1', competencia: '2026-09-01', ordem: 0, meta: '50000', bonus: '500' },
          // rep-2: tinha em agosto, e outubro tem o próprio
          { user_id: 'rep-2', competencia: '2026-10-01', ordem: 0, meta: '30000', bonus: '300' },
          { user_id: 'rep-2', competencia: '2026-08-01', ordem: 0, meta: '99999', bonus: '1' },
        ],
        error: null,
      },
    } as never);
    vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
    const { buildApp } = await import('../apps/api/src/app.js');
    const app = await buildApp();
    await app.ready();
    return { app, fake };
  }

  it('o gerente recebe as faixas que VALEM no mês de cada rep (o mês sem cadastro herda o anterior)', async () => {
    const { app } = await subir();
    const res = await app.inject({
      method: 'GET',
      url: '/reps/metas?competencia=2026-10-01',
      headers: { authorization: `Bearer ${assinar({ ...base, sub: 'g1', name: 'FABIAN', role: 'manager' })}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const corpo = res.json() as { data: { competencia: string; metas: { user_id: string; faixas: unknown[] }[] } };
    expect(corpo.data.competencia).toBe('2026-10-01');
    const de = (id: string) => corpo.data.metas.find((m) => m.user_id === id)?.faixas;
    expect(de('rep-1')).toEqual([
      { meta: 50000, bonus: 500 },
      { meta: 80000, bonus: 1000 },
    ]);
    expect(de('rep-2')).toEqual([{ meta: 30000, bonus: 300 }]);
  });

  it('o representante não lê a meta da equipe — 403', async () => {
    const { app } = await subir();
    const res = await app.inject({
      method: 'GET',
      url: '/reps/metas',
      headers: { authorization: `Bearer ${assinar({ ...base, sub: 'rep-1', name: 'REP', role: 'rep' })}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});
