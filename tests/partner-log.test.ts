import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { criarSupabaseFake } from './supabaseFake.js';

/**
 * O registro de cada chamada do parceiro em erp_sync_log (migração 048, A).
 *
 * Tranca as três regras: nunca derruba a chamada, `detalhe` não carrega dado
 * de cliente, e chamada sem chave válida grava sem empresa.
 */

const EMPRESA = '00000000-0000-0000-0000-00000000000a';

const ENCHIMENTO = { data: [], error: null };
const SONDA_OK = { data: [{ rota: null }], error: null };
const SEM_COLUNA = { data: null, error: { code: '42703', message: 'column erp_sync_log.rota does not exist' } };

async function carregar(respostas: Record<string, unknown>) {
  const fake = criarSupabaseFake(respostas as never);
  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
  const mod = await import('../apps/api/src/modules/partner/partner.log.js');
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

describe('registrarChamada', () => {
  it('faturamento com 3 recebidos, 2 gravados e 1 ignorado', async () => {
    const { registrarChamada, fake } = await carregar({ erp_sync_log: [SONDA_OK, ENCHIMENTO, { data: null, error: null }] });
    const ok = await registrarChamada({
      company_id: EMPRESA,
      parceiro: 'Parceiro Teste',
      rota: '/partner/v1/faturamento',
      metodo: 'post',
      http_status: 200,
      recebidos: 3,
      gravados: 2,
      sem_mudanca: 0,
      ignorados: 1,
      detalhe: { ignorados: [{ posicao: 2, pedido_erp: 'ZZ0000001', motivo: 'pedido não encontrado' }] },
      started_at: '2026-09-15T14:00:00.000Z',
    });
    expect(ok).toBe(true);

    const g = fake.ultimaGravacao('erp_sync_log', 'insert');
    expect(g).toBeDefined();
    const v = g!.valores as Record<string, unknown>;
    expect(v).toMatchObject({
      company_id: EMPRESA,
      sync_type: 'parceiro',
      status: 'success',
      started_at: '2026-09-15T14:00:00.000Z',
      records_synced: 2,
      parceiro: 'Parceiro Teste',
      rota: '/partner/v1/faturamento',
      metodo: 'POST',
      http_status: 200,
      recebidos: 3,
      gravados: 2,
      sem_mudanca: 0,
      ignorados: 1,
      detalhe: { ignorados: [{ posicao: 2, pedido_erp: 'ZZ0000001', motivo: 'pedido não encontrado' }] },
    });
    for (const campo of ['finished_at', 'created_at', 'updated_at']) {
      expect(typeof v[campo]).toBe('string');
    }
  });

  it('http >= 400 grava status error; chamada 401 sem empresa e sem parceiro', async () => {
    const { registrarChamada, fake } = await carregar({ erp_sync_log: [SONDA_OK, ENCHIMENTO, { data: null, error: null }] });
    await registrarChamada({
      company_id: null,
      parceiro: null,
      rota: '/partner/v1/pedidos?incluir=todos',
      metodo: 'GET',
      http_status: 401,
      detalhe: { code: 'PARTNER_UNAUTHORIZED', 'x-api-key': 'chave-que-nao-pode-ir' },
    });
    const v = fake.ultimaGravacao('erp_sync_log', 'insert')!.valores as Record<string, unknown>;
    expect(v).toMatchObject({
      company_id: null,
      parceiro: null,
      status: 'error',
      http_status: 401,
      rota: '/partner/v1/pedidos',
      records_synced: 0,
      gravados: null,
      recebidos: null,
      detalhe: { code: 'PARTNER_UNAUTHORIZED' },
    });
    expect(JSON.stringify(v)).not.toContain('chave-que-nao-pode-ir');
  });

  it('sem a 048 não grava nada e não lança', async () => {
    const { registrarChamada, fake } = await carregar({ erp_sync_log: [SEM_COLUNA] });
    const ok = await registrarChamada({
      company_id: EMPRESA,
      parceiro: 'Parceiro Teste',
      rota: '/partner/v1/clientes',
      metodo: 'POST',
      http_status: 200,
    });
    expect(ok).toBe(false);
    expect(fake.gravacoes).toHaveLength(0);
  });

  it('insert recusado pelo banco: não lança, só avisa no console', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { registrarChamada } = await carregar({
      erp_sync_log: [SONDA_OK, ENCHIMENTO, { data: null, error: { code: '23502', message: 'null value' } }],
    });
    await expect(
      registrarChamada({ company_id: EMPRESA, parceiro: 'P', rota: '/partner/v1/status', metodo: 'GET', http_status: 200 }),
    ).resolves.toBe(false);
    expect(erro).toHaveBeenCalledTimes(1);
  });

  it('exceção dentro do registro também não sobe', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const explode = {
      from: () => {
        throw new Error('cliente quebrado');
      },
    };
    vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: explode }));
    const { registrarChamada } = await import('../apps/api/src/modules/partner/partner.log.js');
    await expect(
      registrarChamada({ company_id: EMPRESA, parceiro: 'P', rota: '/partner/v1/status', metodo: 'GET', http_status: 200 }),
    ).resolves.toBe(false);
    expect(erro).toHaveBeenCalled();
  });

  it('detalhe sem dado de cliente: só códigos, posições, motivos e contagens', async () => {
    const { registrarChamada, fake } = await carregar({ erp_sync_log: [SONDA_OK, ENCHIMENTO, { data: null, error: null }] });
    await registrarChamada({
      company_id: EMPRESA,
      parceiro: 'Parceiro Teste',
      rota: '/partner/v1/clientes',
      metodo: 'POST',
      http_status: 200,
      recebidos: 2,
      gravados: 1,
      ignorados: 1,
      detalhe: {
        inalterados: 0,
        canal: 'cadastro',
        valor_atual: 'carga',
        ignorados: [
          {
            posicao: 1,
            codigo: '00001',
            motivo: 'falha ao gravar: e-mail cliente.teste@exemplo.com já usado; doc 00.000.000/0001-00 e 000.000.000-00',
            razao_social: 'Cliente Teste',
            nome_fantasia: 'Loja Teste',
            cnpj: '00.000.000/0001-00',
            email: 'cliente.teste@exemplo.com',
            whatsapp: '(00) 00000-0000',
            endereco: { cidade: 'Cidade Teste' },
            valor_faturado: 100,
            invoiced_total: 100,
          },
        ],
      },
    });
    const detalhe = (fake.ultimaGravacao('erp_sync_log', 'insert')!.valores as { detalhe: unknown }).detalhe;
    expect(detalhe).toEqual({
      inalterados: 0,
      canal: 'cadastro',
      valor_atual: 'carga',
      ignorados: [
        {
          posicao: 1,
          codigo: '00001',
          motivo: 'falha ao gravar: e-mail [removido] já usado; doc [removido] e [removido]',
        },
      ],
    });
  });

  it('limparDetalhe corta lista e texto grandes demais', async () => {
    const { limparDetalhe } = await carregar({});
    const lista = Array.from({ length: 250 }, (_, i) => ({ posicao: i }));
    const limpo = limparDetalhe({ ignorados: lista, motivo: 'x'.repeat(1000) }) as {
      ignorados: unknown[];
      motivo: string;
    };
    expect(limpo.ignorados).toHaveLength(201);
    expect(limpo.ignorados[200]).toBe('… mais 50');
    expect(limpo.motivo.length).toBeLessThanOrEqual(301);
  });
});
