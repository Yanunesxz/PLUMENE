import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { criarSupabaseFake, type RespostaTabela } from './supabaseFake.js';

/**
 * O RETRATO do cliente pela API (POST /partner/v1/retrato, 16/09/2026).
 *
 * O que fica trancado:
 *   1. o cliente é achado PRIMEIRO pelo CNPJ e DEPOIS pelo código;
 *   2. `referencia` é obrigatória, com fuso, e um retrato mais antigo que o
 *      guardado é recusado; o mesmo retrato reenviado é `sem_mudanca`;
 *   3. a última compra só anda para FRENTE (e o momento vira o dia de Brasília);
 *   4. pendência financeira, títulos vencidos e a referência ficam nas colunas
 *      da 049, com o momento em que chegaram; sem a 036/049, avisa e não quebra;
 *   5. valor ruim recusa o registro inteiro; falha ao gravar um não derruba o lote;
 *   6. a rota exige canal_retrato = 'api'.
 *
 * Dados fictícios de propósito.
 */

const EMPRESA = 'empresa-1';
const OK: RespostaTabela = { data: null, error: null };
const ENCHIMENTO: RespostaTabela = { data: null, error: null };

/** Respostas em sequência para a mesma tabela (o dublê adianta uma a cada consulta). */
function emSequencia(...respostas: RespostaTabela[]): RespostaTabela[] {
  return respostas.flatMap((r, i) => (i === respostas.length - 1 ? [r] : [r, ENCHIMENTO]));
}

interface Opcoes {
  /** A 036 rodou (customers.last_purchase_at). Padrão: sim. */
  com036?: boolean;
  /** A 049 rodou (customers.retrato_referencia_em). Padrão: sim. */
  com049?: boolean;
}

async function carregar(respostas: Record<string, RespostaTabela | RespostaTabela[]>, opcoes: Opcoes = {}) {
  const fake = criarSupabaseFake(respostas);
  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
  const existe: Record<string, boolean> = {
    'customers.last_purchase_at': opcoes.com036 ?? true,
    'customers.retrato_referencia_em': opcoes.com049 ?? true,
  };
  const responder = async (tabela: string, coluna?: string) => existe[`${tabela}.${coluna ?? ''}`] ?? true;
  vi.doMock('../apps/api/src/lib/detectarColuna.js', () => ({
    detectar: responder,
    detectarOuFalhar: responder,
    detectarComCerteza: async (t: string, c?: string) => ((await responder(t, c)) ? 'existe' : 'nao_existe'),
    esquecerDeteccoes: () => undefined,
  }));
  const service = await import('../apps/api/src/modules/partner/partner.retrato.service.js');
  return { service, fake };
}

const valoresDe = (g: { valores: unknown } | undefined) => g?.valores as Record<string, unknown>;

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.doUnmock('../apps/api/src/config/supabase.js');
  vi.doUnmock('../apps/api/src/lib/detectarColuna.js');
  vi.doUnmock('../apps/api/src/modules/partner/partner.auth.js');
  vi.doUnmock('../apps/api/src/modules/partner/partner.retrato.service.js');
  vi.restoreAllMocks();
});

const LOJA = {
  id: 'c-1',
  erp_id: '00123',
  cnpj: '00.000.000/0001-91',
  last_purchase_at: '2026-08-01',
  total_purchased: '1000.00',
  overdue_amount: null,
  pendencia_financeira: null,
  titulos_vencidos: null,
  retrato_referencia_em: null,
};

describe('receberRetrato', () => {
  it('acha pelo CNPJ, grava o retrato inteiro com a referência e carimba updated_at e erp_updated_at', async () => {
    const { service, fake } = await carregar({
      customers: [{ data: [LOJA, { ...LOJA, id: 'c-2', erp_id: '00124', cnpj: null }], error: null }, OK],
    });

    const r = await service.receberRetrato(EMPRESA, [
      {
        cnpj: '00000000000191',
        codigo: '999', // o código errado não importa: o CNPJ decide
        ultima_compra: '2026-09-10',
        total_comprado: '2.500,00',
        valor_vencido: 120.5,
        titulos_vencidos: '2',
        pendencia_financeira: 320.9,
        referencia: '2026-09-16T06:00:00-03:00',
      },
    ]);

    expect(r).toMatchObject({ recebidos: 1, atualizados: 1, sem_mudanca: 0, ignorados: [], avisos: [] });
    const patch = valoresDe(fake.ultimaGravacao('customers', 'update'));
    expect(patch).toMatchObject({
      last_purchase_at: '2026-09-10',
      total_purchased: 2500,
      overdue_amount: 120.5,
      titulos_vencidos: 2,
      pendencia_financeira: 320.9,
      retrato_referencia_em: '2026-09-16T06:00:00-03:00',
    });
    expect(typeof patch['pendencia_financeira_em']).toBe('string');
    expect(patch['erp_updated_at']).toBe(patch['updated_at']);
    const eqs = fake.filtrosDe('customers', 'eq').map((f) => f.args);
    expect(eqs).toContainEqual(['id', 'c-1']);
    expect(eqs.filter((a) => a[0] === 'company_id' && a[1] === EMPRESA)).toHaveLength(2);
    // A leitura dos existentes é paginada e ordenada por id.
    expect(fake.filtrosDe('customers', 'order').map((f) => f.args[0])).toContain('id');
  });

  it('sem CNPJ, acha pelo código (miolo); cliente que não existe é ignorado; sem os dois também', async () => {
    const { service, fake } = await carregar({
      customers: [{ data: [LOJA], error: null }, OK],
    });

    const r = await service.receberRetrato(EMPRESA, [
      { codigo: '#123', total_comprado: 1, referencia: '2026-09-16T09:00:00Z' },
      { codigo: '777', total_comprado: 1, referencia: '2026-09-16T09:00:00Z' },
      { total_comprado: 1, referencia: '2026-09-16T09:00:00Z' },
      'lixo',
    ]);

    expect(r.atualizados).toBe(1);
    expect(r.ignorados).toEqual([
      { cliente: '777', motivo: 'cliente não encontrado nesta empresa' },
      { cliente: null, motivo: 'informe "cnpj" ou "codigo"' },
      { cliente: null, motivo: 'registro inválido' },
    ]);
    expect(fake.filtrosDe('customers', 'eq').map((f) => f.args)).toContainEqual(['id', 'c-1']);
  });

  it('CNPJ com dois cadastros: o código desempata; sem código que case, recusa', async () => {
    const dois = [
      { ...LOJA, id: 'a', erp_id: '00001' },
      { ...LOJA, id: 'b', erp_id: '00002' },
    ];
    const { service, fake } = await carregar({ customers: [{ data: dois, error: null }, OK] });

    const r = await service.receberRetrato(EMPRESA, [
      { cnpj: '00000000000191', codigo: '2', total_comprado: 5, referencia: '2026-09-16T09:00:00Z' },
    ]);
    expect(r.atualizados).toBe(1);
    expect(fake.filtrosDe('customers', 'eq').map((f) => f.args)).toContainEqual(['id', 'b']);

    vi.resetModules();
    const outro = await carregar({ customers: { data: dois, error: null } });
    const r2 = await outro.service.receberRetrato(EMPRESA, [
      { cnpj: '00000000000191', total_comprado: 5, referencia: '2026-09-16T09:00:00Z' },
    ]);
    expect(r2.ignorados).toEqual([{ cliente: '00000000000191', motivo: 'CNPJ com mais de um cadastro no app' }]);
    expect(outro.fake.gravacoes).toEqual([]);
  });

  it.each<[string, Record<string, unknown>, string]>([
    ['sem referência', { cnpj: '00000000000191', total_comprado: 1 }, '"referencia" é obrigatória (momento com fuso, ex.: 2026-09-16T06:00:00-03:00)'],
    ['referência sem fuso', { cnpj: '00000000000191', referencia: '2026-09-16T06:00:00' }, '"referencia" precisa de fuso (Z ou -03:00)'],
    ['referência que não é data', { cnpj: '00000000000191', referencia: 'ontem' }, '"referencia" não é uma data ISO'],
    ['última compra sem fuso', { cnpj: '00000000000191', referencia: '2026-09-16T09:00:00Z', ultima_compra: '2026-09-10T10:00:00' }, '"ultima_compra" precisa ser AAAA-MM-DD ou um momento com fuso (Z ou -03:00)'],
    ['total negativo', { cnpj: '00000000000191', referencia: '2026-09-16T09:00:00Z', total_comprado: -1 }, '"total_comprado" precisa ser um número maior ou igual a zero'],
    ['vencido ilegível', { cnpj: '00000000000191', referencia: '2026-09-16T09:00:00Z', valor_vencido: 'muito' }, '"valor_vencido" precisa ser um número maior ou igual a zero'],
    ['títulos fracionados', { cnpj: '00000000000191', referencia: '2026-09-16T09:00:00Z', titulos_vencidos: 1.5 }, '"titulos_vencidos" precisa ser um inteiro maior ou igual a zero'],
    ['pendência negativa', { cnpj: '00000000000191', referencia: '2026-09-16T09:00:00Z', pendencia_financeira: -3 }, '"pendencia_financeira" precisa ser um número maior ou igual a zero'],
  ])('%s: o registro inteiro é recusado, nada gravado', async (_nome, registro, motivo) => {
    const { service, fake } = await carregar({ customers: { data: [LOJA], error: null } });

    const r = await service.receberRetrato(EMPRESA, [registro]);

    expect(r.ignorados).toEqual([{ cliente: '00000000000191', motivo }]);
    expect(fake.gravacoes).toEqual([]);
  });

  it('a última compra só anda para FRENTE, e o momento com fuso vira o dia de Brasília', async () => {
    const { service, fake } = await carregar({
      customers: emSequencia(
        {
          data: [
            { ...LOJA, id: 'a', erp_id: '00001', cnpj: null, last_purchase_at: '2026-09-10' },
            { ...LOJA, id: 'b', erp_id: '00002', cnpj: null, last_purchase_at: '2026-08-01' },
            { ...LOJA, id: 'c', erp_id: '00003', cnpj: null, last_purchase_at: null },
          ],
          error: null,
        },
        OK,
      ),
    });

    const r = await service.receberRetrato(EMPRESA, [
      { codigo: '1', ultima_compra: '2026-08-20', referencia: '2026-09-16T09:00:00Z' }, // para trás: não mexe
      { codigo: '2', ultima_compra: '2026-08-14T01:30:00Z', referencia: '2026-09-16T09:00:00Z' }, // 22:30 de 13/08 em SP
      { codigo: '3', ultima_compra: null, referencia: '2026-09-16T09:00:00Z' }, // null não limpa
    ]);

    expect(r.atualizados).toBe(3); // a referência é nova para os três
    const updates = fake.gravacoes.filter((g) => g.operacao === 'update').map(valoresDe);
    expect('last_purchase_at' in updates[0]!).toBe(false);
    expect(updates[1]!['last_purchase_at']).toBe('2026-08-13');
    expect('last_purchase_at' in updates[2]!).toBe(false);
  });

  it('o mesmo retrato reenviado é sem_mudanca; um mais antigo que o guardado é recusado', async () => {
    const guardado = {
      ...LOJA,
      last_purchase_at: '2026-09-10',
      total_purchased: '2500.00',
      overdue_amount: '120.50',
      pendencia_financeira: '320.90',
      titulos_vencidos: 2,
      retrato_referencia_em: '2026-09-16T09:00:00+00:00',
    };
    const outro = { ...guardado, id: 'c-2', erp_id: '00777', cnpj: null };
    const { service, fake } = await carregar({ customers: { data: [guardado, outro], error: null } });

    const r = await service.receberRetrato(EMPRESA, [
      {
        cnpj: '00000000000191',
        ultima_compra: '2026-09-10',
        total_comprado: 2500,
        valor_vencido: '120.50',
        titulos_vencidos: 2,
        pendencia_financeira: 320.9,
        referencia: '2026-09-16T06:00:00-03:00', // o mesmo instante, em outro fuso
      },
      { codigo: '777', total_comprado: 1, referencia: '2026-09-15T09:00:00Z' },
    ]);

    expect(r).toMatchObject({ atualizados: 0, sem_mudanca: 1 });
    expect(r.ignorados).toEqual([{ cliente: '777', motivo: 'referência mais antiga que o retrato guardado' }]);
    expect(fake.gravacoes).toEqual([]);
  });

  it('campo ausente não mexe; null explícito limpa o total, o vencido, a pendência e os títulos', async () => {
    const guardado = {
      ...LOJA,
      total_purchased: '2500.00',
      overdue_amount: '120.50',
      pendencia_financeira: '320.90',
      titulos_vencidos: 2,
      retrato_referencia_em: '2026-09-16T09:00:00+00:00',
    };
    const { service, fake } = await carregar({ customers: [{ data: [guardado], error: null }, OK] });

    await service.receberRetrato(EMPRESA, [
      { cnpj: '00000000000191', valor_vencido: null, pendencia_financeira: null, titulos_vencidos: null, referencia: '2026-09-16T10:00:00Z' },
    ]);

    const patch = valoresDe(fake.ultimaGravacao('customers', 'update'));
    expect(patch).toMatchObject({
      overdue_amount: null,
      pendencia_financeira: null,
      titulos_vencidos: null,
      retrato_referencia_em: '2026-09-16T10:00:00Z',
    });
    expect('total_purchased' in patch).toBe(false);
    expect('last_purchase_at' in patch).toBe(false);
  });

  it('cliente repetido no lote: vale o primeiro', async () => {
    const { service, fake } = await carregar({ customers: [{ data: [LOJA], error: null }, OK] });

    const r = await service.receberRetrato(EMPRESA, [
      { cnpj: '00000000000191', total_comprado: 1, referencia: '2026-09-16T09:00:00Z' },
      { codigo: '123', total_comprado: 2, referencia: '2026-09-16T09:00:00Z' },
    ]);

    expect(r.ignorados).toEqual([{ cliente: '123', motivo: 'cliente repetido no lote' }]);
    expect(fake.gravacoes.filter((g) => g.operacao === 'update')).toHaveLength(1);
  });

  it('SEM a 036 e SEM a 049: nada é gravado, e os avisos dizem o que falta', async () => {
    const { service, fake } = await carregar({ customers: { data: [LOJA], error: null } }, { com036: false, com049: false });

    const r = await service.receberRetrato(EMPRESA, [
      { cnpj: '00000000000191', total_comprado: 1, pendencia_financeira: 2, referencia: '2026-09-16T09:00:00Z' },
    ]);

    expect(r).toMatchObject({ atualizados: 0, sem_mudanca: 1 });
    expect(r.avisos).toEqual([service.AVISO_SEM_036, service.AVISO_SEM_049]);
    expect(fake.gravacoes).toEqual([]);
    const select = fake.filtrosDe('customers', 'select')[0]!.args[0] as string;
    expect(select).not.toContain('last_purchase_at');
    expect(select).not.toContain('retrato_referencia_em');
  });

  it('falha ao gravar um cliente vira ignorado e o lote segue; erro ao LER lança antes de gravar', async () => {
    const { service, fake } = await carregar({
      customers: emSequencia(
        { data: [{ ...LOJA, id: 'a', erp_id: '00001', cnpj: null }, { ...LOJA, id: 'b', erp_id: '00002', cnpj: null }], error: null },
        { data: null, error: { message: 'caiu' } },
        OK,
      ),
    });

    const r = await service.receberRetrato(EMPRESA, [
      { codigo: '1', total_comprado: 1, referencia: '2026-09-16T09:00:00Z' },
      { codigo: '2', total_comprado: 1, referencia: '2026-09-16T09:00:00Z' },
    ]);
    expect(r.ignorados).toEqual([{ cliente: '1', motivo: 'falha ao gravar: caiu' }]);
    expect(r.atualizados).toBe(1);
    expect(fake.gravacoes.filter((g) => g.operacao === 'update')).toHaveLength(2);

    vi.resetModules();
    const outro = await carregar({ customers: { data: null, error: { message: 'timeout' } } });
    await expect(
      outro.service.receberRetrato(EMPRESA, [{ codigo: '1', referencia: '2026-09-16T09:00:00Z' }]),
    ).rejects.toThrow(/timeout/);
    expect(outro.fake.gravacoes).toEqual([]);
  });
});

// ─── A rota ──────────────────────────────────────────────────────────────────

const SUPABASE = '../apps/api/src/config/supabase.js';
const AUTH = '../apps/api/src/modules/partner/partner.auth.js';
const SERVICO = '../apps/api/src/modules/partner/partner.retrato.service.js';
const CONTROLLER = '../apps/api/src/modules/partner/partner.retrato.controller.js';

function replyFalso() {
  const enviado: { status: number; corpo: unknown } = { status: 200, corpo: undefined };
  const reply = {
    status(codigo: number) {
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

async function carregarRota(canalRetrato: string, receberRetrato: unknown) {
  const fake = criarSupabaseFake({
    companies: {
      data: {
        canal_pedido_erp: 'manual',
        canal_faturamento: 'manual',
        canal_cadastro: 'carga',
        canal_retrato: canalRetrato,
        canal_catalogo: 'carga',
      },
      error: null,
    },
  });
  vi.doMock(SUPABASE, () => ({ supabase: fake.cliente }));
  vi.doMock(AUTH, () => ({
    requirePartner: () => Promise.resolve({ name: 'control-teste', key: 'chave', company_id: EMPRESA }),
  }));
  vi.doMock(SERVICO, () => ({ receberRetrato }));
  const controller = await import(CONTROLLER);
  return { ...controller, fake };
}

describe('POST /partner/v1/retrato — a rota', () => {
  it('canal carga: 409 CANAL_FECHADO antes do corpo, sem chamar o serviço', async () => {
    const receberRetrato = vi.fn();
    const { partnerRetratoHandler } = await carregarRota('carga', receberRetrato);
    const { reply, enviado } = replyFalso();
    const req = requisicao('corpo inválido de propósito');

    await partnerRetratoHandler(req, reply);

    expect(enviado.status).toBe(409);
    expect(enviado.corpo).toMatchObject({ code: 'CANAL_FECHADO', canal: 'retrato', valor_atual: 'carga' });
    expect(receberRetrato).not.toHaveBeenCalled();
    expect(req.partnerLog).toMatchObject({ company_id: EMPRESA, detalhe: { code: 'CANAL_FECHADO' } });
  });

  it('canal api: corpo ruim é 400, lote grande é 400, lote bom chama o serviço e anota a chamada', async () => {
    const resultado = { recebidos: 2, atualizados: 1, sem_mudanca: 1, ignorados: [], avisos: [] };
    const receberRetrato = vi.fn().mockResolvedValue(resultado);
    const { partnerRetratoHandler } = await carregarRota('api', receberRetrato);

    const ruim = replyFalso();
    await partnerRetratoHandler(requisicao({ nada: true }), ruim.reply);
    expect(ruim.enviado).toMatchObject({ status: 400, corpo: { code: 'INVALID_BODY' } });

    const grande = replyFalso();
    await partnerRetratoHandler(requisicao({ retrato: Array.from({ length: 1001 }, () => ({})) }), grande.reply);
    expect(grande.enviado).toMatchObject({ status: 400, corpo: { code: 'BATCH_TOO_LARGE' } });
    expect(receberRetrato).not.toHaveBeenCalled();

    const lista = [{ cnpj: '00000000000191', referencia: '2026-09-16T09:00:00Z' }, { codigo: '1', referencia: '2026-09-16T09:00:00Z' }];
    const bom = replyFalso();
    const req = requisicao({ retrato: lista });
    await partnerRetratoHandler(req, bom.reply);

    expect(bom.enviado.status).toBe(200);
    expect(bom.enviado.corpo).toMatchObject({ ok: true, recebidos: 2, atualizados: 1, sem_mudanca: 1 });
    expect(receberRetrato).toHaveBeenCalledWith(EMPRESA, lista);
    expect(req.partnerLog).toMatchObject({ recebidos: 2, gravados: 1, sem_mudanca: 1, ignorados: 0 });
  });
});
