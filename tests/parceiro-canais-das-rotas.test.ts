import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { criarSupabaseFake } from './supabaseFake.js';

/**
 * O canal por empresa (048) nas rotas de ENTRADA do parceiro:
 *
 *   • POST /partner/v1/faturamento só com canal_faturamento = 'api';
 *   • POST /partner/v1/clientes e /representantes só com canal_cadastro = 'api'.
 *
 * Canal fechado é 409 CANAL_FECHADO antes de olhar o corpo e sem chamar o
 * serviço (nada gravado). Canal aberto chama o serviço — o faturamento com o
 * nome do parceiro, para o rastro do pedido — e a resposta leva os contadores
 * novos (`inalterados`, `sem_mudanca`, `avisos`) sem tirar os antigos.
 *
 * Dados todos fictícios.
 */

const EMPRESA = '00000000-0000-0000-0000-00000000000a';
const SUPABASE = '../apps/api/src/config/supabase.js';
const AUTH = '../apps/api/src/modules/partner/partner.auth.js';
const FATURAMENTO = '../apps/api/src/modules/partner/partner.faturamento.service.js';
const CADASTROS = '../apps/api/src/modules/partner/partner.sync.service.js';
const CONTROLLER = '../apps/api/src/modules/partner/partner.controller.js';

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.doUnmock(SUPABASE);
  vi.doUnmock(AUTH);
  vi.doUnmock(FATURAMENTO);
  vi.doUnmock(CADASTROS);
  vi.restoreAllMocks();
});

function replyFalso() {
  const enviado: { status: number; corpo: unknown } = { status: 200, corpo: undefined };
  const reply = {
    status(codigo: number) {
      enviado.status = codigo;
      return reply;
    },
    code(codigo: number) {
      enviado.status = codigo;
      return reply;
    },
    send(corpo: unknown) {
      enviado.corpo = corpo;
      return Promise.resolve();
    },
  };
  return { reply: reply as unknown as FastifyReply, enviado };
}

function requisicao(body: unknown) {
  return { body, params: {}, query: {}, headers: { 'x-api-key': 'chave' } } as unknown as FastifyRequest & {
    partnerLog?: { company_id?: string | null; detalhe?: Record<string, unknown> | null } | null;
  };
}

async function carregar(
  canais: { faturamento?: string; cadastro?: string },
  servicos: { receberFaturamento?: unknown; receberClientes?: unknown; receberRepresentantes?: unknown },
) {
  const fake = criarSupabaseFake({
    companies: {
      data: {
        canal_pedido_erp: 'manual',
        canal_faturamento: canais.faturamento ?? 'manual',
        canal_cadastro: canais.cadastro ?? 'carga',
        canal_retrato: 'carga',
        canal_catalogo: 'carga',
      },
      error: null,
    },
  });
  vi.doMock(SUPABASE, () => ({ supabase: fake.cliente }));
  vi.doMock(AUTH, () => ({
    requirePartner: () => Promise.resolve({ name: 'control-teste', key: 'chave', company_id: EMPRESA }),
  }));
  vi.doMock(FATURAMENTO, () => ({ receberFaturamento: servicos.receberFaturamento ?? vi.fn() }));
  vi.doMock(CADASTROS, () => ({
    receberClientes: servicos.receberClientes ?? vi.fn(),
    receberRepresentantes: servicos.receberRepresentantes ?? vi.fn(),
  }));
  const controller = await import(CONTROLLER);
  return { ...controller, fake };
}

describe('POST /partner/v1/faturamento — canal de faturamento', () => {
  it.each([['manual']])('canal %s: 409 CANAL_FECHADO antes do corpo, sem chamar o serviço', async (canal) => {
    const receberFaturamento = vi.fn();
    const { partnerFaturamentoHandler, fake } = await carregar({ faturamento: canal }, { receberFaturamento });
    const { reply, enviado } = replyFalso();
    const req = requisicao('corpo inválido de propósito');

    await partnerFaturamentoHandler(req, reply);

    expect(enviado.status).toBe(409);
    expect(enviado.corpo).toMatchObject({
      code: 'CANAL_FECHADO',
      statusCode: 409,
      canal: 'faturamento',
      valor_atual: canal,
    });
    expect(receberFaturamento).not.toHaveBeenCalled();
    expect(fake.gravacoes).toEqual([]);
    // O registro da chamada sabe de quem era a chave e por que foi recusada.
    expect(req.partnerLog).toMatchObject({ company_id: EMPRESA, detalhe: { code: 'CANAL_FECHADO' } });
  });

  it('canal api: chama o serviço com o nome do parceiro e devolve os contadores novos', async () => {
    const resultado = { recebidos: 2, atualizados: 1, inalterados: 1, ignorados: [], avisos: [] };
    const receberFaturamento = vi.fn().mockResolvedValue(resultado);
    const { partnerFaturamentoHandler } = await carregar({ faturamento: 'api' }, { receberFaturamento });
    const { reply, enviado } = replyFalso();
    const lista = [{ pedido_erp: 'ZZ0000001' }, { pedido_erp: 'ZZ0000002' }];
    const req = requisicao({ faturamento: lista });

    await partnerFaturamentoHandler(req, reply);

    expect(enviado.status).toBe(200);
    expect(enviado.corpo).toMatchObject({ ok: true, recebidos: 2, atualizados: 1, inalterados: 1, avisos: [] });
    expect(receberFaturamento).toHaveBeenCalledWith(EMPRESA, lista, { parceiro: 'control-teste' });
    expect(req.partnerLog).toMatchObject({ recebidos: 2, gravados: 1, sem_mudanca: 1, ignorados: 0 });
  });
});

describe('POST /partner/v1/clientes e /representantes — canal de cadastro', () => {
  it.each([['carga'], ['firebird']])('clientes com canal %s: 409 CANAL_FECHADO, sem chamar o serviço', async (canal) => {
    const receberClientes = vi.fn();
    const { partnerClientesHandler } = await carregar({ cadastro: canal }, { receberClientes });
    const { reply, enviado } = replyFalso();

    await partnerClientesHandler(requisicao({ clientes: [{ codigo: '00001', razao_social: 'Cliente Teste' }] }), reply);

    expect(enviado.status).toBe(409);
    expect(enviado.corpo).toMatchObject({ code: 'CANAL_FECHADO', canal: 'cadastro', valor_atual: canal });
    expect(receberClientes).not.toHaveBeenCalled();
  });

  it('representantes com canal carga: 409 CANAL_FECHADO, sem chamar o serviço', async () => {
    const receberRepresentantes = vi.fn();
    const { partnerRepresentantesHandler } = await carregar({ cadastro: 'carga' }, { receberRepresentantes });
    const { reply, enviado } = replyFalso();

    await partnerRepresentantesHandler(requisicao({ representantes: [{ codigo: '00001' }] }), reply);

    expect(enviado.status).toBe(409);
    expect(enviado.corpo).toMatchObject({ code: 'CANAL_FECHADO', canal: 'cadastro', valor_atual: 'carga' });
    expect(receberRepresentantes).not.toHaveBeenCalled();
  });

  it('clientes com canal api: chama o serviço e a resposta leva sem_mudanca', async () => {
    const resultado = { recebidos: 3, criados: 1, atualizados: 1, sem_mudanca: 1, ignorados: [], avisos: [] };
    const receberClientes = vi.fn().mockResolvedValue(resultado);
    const { partnerClientesHandler } = await carregar({ cadastro: 'api' }, { receberClientes });
    const { reply, enviado } = replyFalso();
    const req = requisicao({ clientes: [{}, {}, {}] });

    await partnerClientesHandler(req, reply);

    expect(enviado.status).toBe(200);
    expect(enviado.corpo).toMatchObject({ ok: true, criados: 1, atualizados: 1, sem_mudanca: 1 });
    expect(receberClientes).toHaveBeenCalledWith(EMPRESA, [{}, {}, {}]);
    expect(req.partnerLog).toMatchObject({ recebidos: 3, gravados: 2, sem_mudanca: 1 });
  });

  it('representantes com canal api: chama o serviço', async () => {
    const resultado = { recebidos: 1, criados: 0, atualizados: 0, sem_mudanca: 1, ignorados: [], avisos: [], novos: [] };
    const receberRepresentantes = vi.fn().mockResolvedValue(resultado);
    const { partnerRepresentantesHandler } = await carregar({ cadastro: 'api' }, { receberRepresentantes });
    const { reply, enviado } = replyFalso();

    await partnerRepresentantesHandler(requisicao([{ codigo: '00001' }]), reply);

    expect(enviado.status).toBe(200);
    expect(enviado.corpo).toMatchObject({ ok: true, sem_mudanca: 1 });
    expect(receberRepresentantes).toHaveBeenCalledWith(EMPRESA, [{ codigo: '00001' }]);
  });

  it('banco sem resposta ao ler o canal: lança (500), sem chamar o serviço', async () => {
    const receberClientes = vi.fn();
    const fake = criarSupabaseFake({
      companies: { data: null, error: { message: 'tempo esgotado', code: '57014' } },
    });
    vi.doMock(SUPABASE, () => ({ supabase: fake.cliente }));
    vi.doMock(AUTH, () => ({
      requirePartner: () => Promise.resolve({ name: 'control-teste', key: 'chave', company_id: EMPRESA }),
    }));
    vi.doMock(FATURAMENTO, () => ({ receberFaturamento: vi.fn() }));
    vi.doMock(CADASTROS, () => ({ receberClientes, receberRepresentantes: vi.fn() }));
    const { partnerClientesHandler } = await import(CONTROLLER);
    const { reply } = replyFalso();

    await expect(partnerClientesHandler(requisicao({ clientes: [] }), reply)).rejects.toThrow();
    expect(receberClientes).not.toHaveBeenCalled();
  });
});
