import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { criarSupabaseFake } from './supabaseFake.js';

/**
 * A trava de canal do sync do Firebird (migração 048, fase 0).
 *
 * O que este teste tranca: além do ERP_SYNC_ENABLED, o sync só LÊ o ERP e só
 * GRAVA no Supabase quando o canal da empresa é 'firebird' — catálogo, preço e
 * estoque por `canal_catalogo`; clientes por `canal_cadastro`. Sem a 048 vale
 * 'carga' e nada roda. Um soluço ao ler o canal também não roda nada. As rotas
 * /erp/sync respondem 409 CANAL_FECHADO, o agendador pula a empresa e os
 * adaptadores nunca inventam número de pedido.
 */

const EMPRESA = '00000000-0000-0000-0000-00000000000a';
const OUTRA = '00000000-0000-0000-0000-00000000000b';
const TERCEIRA = '00000000-0000-0000-0000-00000000000c';

/** O dublê pré-busca a próxima resposta a cada consulta: enchimento entre duas. */
const ENCHIMENTO = { data: [], error: null };
const SONDA_OK = { data: [{ canal_pedido_erp: 'manual' }], error: null };
const SEM_COLUNA = { data: null, error: { code: '42703', message: 'column companies.canal_pedido_erp does not exist' } };
const SOLUCO = { data: null, error: { code: '503', message: 'service unavailable' } };

function empresaCom(catalogo: string, cadastro: string) {
  return [
    SONDA_OK,
    ENCHIMENTO,
    {
      data: {
        canal_pedido_erp: 'manual',
        canal_faturamento: 'manual',
        canal_cadastro: cadastro,
        canal_retrato: 'carga',
        canal_catalogo: catalogo,
      },
      error: null,
    },
  ];
}

/** Uma linha fictícia do CLIENTE do Firebird. */
const CLIENTE_ERP = {
  CLIENTE: '00001',
  RAZAO_SOCIAL: 'Cliente Teste',
  NOME_FANTASIA: null,
  CNPJ_CPF: '00.000.000/0001-00',
  REPRESENTANTE: '00001',
  TABELA_PRECO: null,
  BLOQUEADO: 'N',
  TEXTO_BLOQUEIO: null,
  LIMITE_CREDITO: null,
  WHATSAPP1: null,
  EMAIL: null,
  ATIVO: 'S',
  DATA_UPDATE: new Date('2020-01-01T00:00:00Z'),
};

const ENV_ORIGINAL = process.env['ERP_SYNC_ENABLED'];

async function carregarServico(respostas: Record<string, unknown>, linhasDoErp: unknown[] = []) {
  const fake = criarSupabaseFake(respostas as never);
  const withFirebird = vi.fn(async (fn: (db: unknown) => Promise<unknown>) => fn({}));
  const query = vi.fn(async () => linhasDoErp);
  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
  vi.doMock('../apps/api/src/erp/firebird/connection.js', () => ({
    withFirebird,
    query,
    testConnection: vi.fn(async () => ({ ok: true, message: 'ok' })),
  }));
  const servico = await import('../apps/api/src/erp/firebird/erpSyncService.js');
  const controller = await import('../apps/api/src/modules/sync/erp-sync.controller.js');
  const { esquecerCanais } = await import('../apps/api/src/lib/canais.js');
  const { esquecerDeteccoes } = await import('../apps/api/src/lib/detectarColuna.js');
  esquecerCanais();
  esquecerDeteccoes();
  return { ...servico, ...controller, fake, withFirebird, query };
}

/** Só leituras de `companies` (a sonda e o canal): nada do catálogo nem da carteira. */
function soLeuCompanies(fake: ReturnType<typeof criarSupabaseFake>) {
  return fake.filtros.every((f) => f.tabela === 'companies');
}

function respostaFalsa() {
  const r = {
    codigo: 200,
    corpo: undefined as unknown,
    status(c: number) {
      r.codigo = c;
      return r;
    },
    send(b: unknown) {
      r.corpo = b;
      return r;
    },
  };
  return r;
}

const pedido = (company_id = EMPRESA) => ({ user: { company_id } }) as unknown as FastifyRequest;

beforeEach(() => {
  vi.resetModules();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.doUnmock('../apps/api/src/config/supabase.js');
  vi.doUnmock('../apps/api/src/erp/firebird/connection.js');
  vi.doUnmock('../apps/api/src/erp/firebird/erpSyncService.js');
  vi.doUnmock('../apps/api/src/lib/canais.js');
  vi.restoreAllMocks();
  if (ENV_ORIGINAL === undefined) delete process.env['ERP_SYNC_ENABLED'];
  else process.env['ERP_SYNC_ENABLED'] = ENV_ORIGINAL;
});

describe('erpSyncService — trava por canal', () => {
  it('sem a 048: o full sync pula as quatro partes, sem abrir o Firebird nem gravar', async () => {
    const { runFullSync, fake, withFirebird } = await carregarServico({ companies: [SEM_COLUNA] });

    const resultados = await runFullSync(EMPRESA);

    expect(resultados.map((r) => [r.type, r.pulado])).toEqual([
      ['price_tables', { canal: 'catalogo', valor_atual: 'carga' }],
      ['products', { canal: 'catalogo', valor_atual: 'carga' }],
      ['prices', { canal: 'catalogo', valor_atual: 'carga' }],
      ['customers', { canal: 'cadastro', valor_atual: 'carga' }],
    ]);
    expect(resultados.every((r) => r.records === 0 && !r.error)).toBe(true);
    expect(withFirebird).not.toHaveBeenCalled();
    expect(fake.gravacoes).toHaveLength(0);
    expect(soLeuCompanies(fake)).toBe(true);
  });

  it('estoque com canal_catalogo fora de firebird é pulado mesmo com o cadastro no firebird', async () => {
    const { runStockSync, fake, withFirebird } = await carregarServico({ companies: empresaCom('carga', 'firebird') });

    const resultado = await runStockSync(EMPRESA);

    expect(resultado).toMatchObject({ type: 'stock', records: 0, pulado: { canal: 'catalogo', valor_atual: 'carga' } });
    expect(withFirebird).not.toHaveBeenCalled();
    expect(fake.gravacoes).toHaveLength(0);
    expect(soLeuCompanies(fake)).toBe(true);
  });

  it('só o cadastro no firebird: grava clientes (com updated_at de agora) e pula catálogo', async () => {
    const antes = Date.now();
    const { runFullSync, fake, withFirebird } = await carregarServico(
      { companies: empresaCom('api', 'firebird') },
      [CLIENTE_ERP],
    );

    const resultados = await runFullSync(EMPRESA);

    expect(resultados.filter((r) => r.pulado).map((r) => r.type)).toEqual(['price_tables', 'products', 'prices']);
    expect(resultados.find((r) => r.type === 'customers')).toMatchObject({ records: 1 });
    expect(resultados.find((r) => r.type === 'customers')?.pulado).toBeUndefined();
    // O Firebird foi aberto uma vez só: para os clientes.
    expect(withFirebird).toHaveBeenCalledTimes(1);

    expect(fake.gravacoes.map((g) => g.tabela)).toEqual(['customers']);
    const linha = (fake.ultimaGravacao('customers', 'upsert')?.valores as Record<string, unknown>[])[0]!;
    expect(linha['company_id']).toBe(EMPRESA);
    // Nunca a DATA_UPDATE antiga do ERP: o CRM lê por updated_at.
    expect(Date.parse(String(linha['updated_at']))).toBeGreaterThanOrEqual(antes);
    // Nada de catálogo lido nem gravado.
    expect(fake.filtrosDe('products')).toHaveLength(0);
    expect(fake.filtrosDe('product_variants')).toHaveLength(0);
  });

  it('soluço ao ler o canal: devolve erro e não lê nem grava nada', async () => {
    const { runStockSync, fake, withFirebird } = await carregarServico({ companies: [SOLUCO] });

    const resultado = await runStockSync(EMPRESA);

    expect(resultado.error).toMatch(/não respondeu/);
    expect(resultado.pulado).toBeUndefined();
    expect(withFirebird).not.toHaveBeenCalled();
    expect(fake.gravacoes).toHaveLength(0);
  });
});

describe('rotas /erp/sync — 409 CANAL_FECHADO', () => {
  it('ERP_SYNC_ENABLED desligado: 503 como hoje, sem ler o canal', async () => {
    delete process.env['ERP_SYNC_ENABLED'];
    const { erpFullSyncHandler, fake, withFirebird } = await carregarServico({ companies: [SEM_COLUNA] });
    const reply = respostaFalsa();

    await erpFullSyncHandler(pedido(), reply as unknown as FastifyReply);

    expect(reply.codigo).toBe(503);
    expect(reply.corpo).toMatchObject({ code: 'ERP_SYNC_DISABLED' });
    expect(fake.filtros).toHaveLength(0);
    expect(withFirebird).not.toHaveBeenCalled();
  });

  it('full sem a 048: 409 com os dois canais recusados e nada lido do ERP', async () => {
    process.env['ERP_SYNC_ENABLED'] = 'true';
    const { erpFullSyncHandler, fake, withFirebird } = await carregarServico({ companies: [SEM_COLUNA] });
    const reply = respostaFalsa();

    await erpFullSyncHandler(pedido(), reply as unknown as FastifyReply);

    expect(reply.codigo).toBe(409);
    expect(reply.corpo).toEqual({
      error: 'Canal de catálogo e cadastro não está ligado para o Firebird nesta empresa',
      code: 'CANAL_FECHADO',
      statusCode: 409,
      canal: 'catalogo',
      valor_atual: 'carga',
      recusados: [
        { canal: 'catalogo', valor_atual: 'carga' },
        { canal: 'cadastro', valor_atual: 'carga' },
      ],
    });
    expect(withFirebird).not.toHaveBeenCalled();
    expect(fake.gravacoes).toHaveLength(0);
  });

  it('estoque com canal_catalogo=api: 409 só do catálogo', async () => {
    process.env['ERP_SYNC_ENABLED'] = 'true';
    const { erpStockSyncHandler, fake, withFirebird } = await carregarServico({
      companies: empresaCom('api', 'firebird'),
    });
    const reply = respostaFalsa();

    await erpStockSyncHandler(pedido(), reply as unknown as FastifyReply);

    expect(reply.codigo).toBe(409);
    expect(reply.corpo).toMatchObject({
      code: 'CANAL_FECHADO',
      canal: 'catalogo',
      valor_atual: 'api',
      recusados: [{ canal: 'catalogo', valor_atual: 'api' }],
    });
    expect(withFirebird).not.toHaveBeenCalled();
    expect(fake.gravacoes).toHaveLength(0);
  });

  it('estoque com canal_catalogo=firebird: roda', async () => {
    process.env['ERP_SYNC_ENABLED'] = 'true';
    const { erpStockSyncHandler, withFirebird, fake } = await carregarServico({
      companies: empresaCom('firebird', 'carga'),
    });
    const reply = respostaFalsa();

    await erpStockSyncHandler(pedido(), reply as unknown as FastifyReply);

    expect(reply.codigo).toBe(200);
    expect(reply.corpo).toMatchObject({ ok: true, result: { type: 'stock' } });
    expect(withFirebird).toHaveBeenCalledTimes(1);
    // A leitura das variantes foi dentro da empresa.
    expect(fake.filtrosDe('product_variants', 'eq')).toEqual([
      { tabela: 'product_variants', metodo: 'eq', args: ['company_id', EMPRESA] },
    ]);
  });

  it('full com um canal só ligado: roda e devolve a parte do outro como pulada', async () => {
    process.env['ERP_SYNC_ENABLED'] = 'true';
    const { erpFullSyncHandler } = await carregarServico({ companies: empresaCom('carga', 'firebird') });
    const reply = respostaFalsa();

    await erpFullSyncHandler(pedido(), reply as unknown as FastifyReply);

    expect(reply.codigo).toBe(200);
    const corpo = reply.corpo as { ok: boolean; results: { type: string; pulado?: unknown }[] };
    expect(corpo.ok).toBe(true);
    expect(corpo.results.filter((r) => r.pulado).map((r) => r.type)).toEqual(['price_tables', 'products', 'prices']);
  });

  it('soluço ao ler o canal: 500, sem abrir o Firebird', async () => {
    process.env['ERP_SYNC_ENABLED'] = 'true';
    const { erpFullSyncHandler, withFirebird, fake } = await carregarServico({ companies: [SOLUCO] });
    const reply = respostaFalsa();

    await erpFullSyncHandler(pedido(), reply as unknown as FastifyReply);

    expect(reply.codigo).toBe(500);
    expect(reply.corpo).toMatchObject({ code: 'ERP_SYNC_ERROR' });
    expect(withFirebird).not.toHaveBeenCalled();
    expect(fake.gravacoes).toHaveLength(0);
  });
});

describe('agendador — só empresa com canal firebird', () => {
  type CanaisFalsos = Record<string, { catalogo: string; cadastro: string } | Error>;

  async function carregarAgendador(canais: CanaisFalsos) {
    const fake = criarSupabaseFake({
      companies: { data: Object.keys(canais).map((id) => ({ id })), error: null },
    });
    const runFullSync = vi.fn(async () => []);
    const runStockSync = vi.fn(async () => ({ type: 'stock', records: 0, duration_ms: 0 }));
    const lerCanais = vi.fn(async (id: string) => {
      const c = canais[id];
      if (!c) throw new Error('empresa desconhecida');
      if (c instanceof Error) throw c;
      return { pedido_erp: 'manual', faturamento: 'manual', retrato: 'carga', migracao: true, ...c };
    });
    vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
    vi.doMock('../apps/api/src/erp/firebird/erpSyncService.js', () => ({ runFullSync, runStockSync }));
    vi.doMock('../apps/api/src/lib/canais.js', () => ({ lerCanais }));
    const agendador = await import('../apps/api/src/jobs/erpSyncScheduler.js');
    return { ...agendador, runFullSync, runStockSync, lerCanais };
  }

  it('ligado e sem empresa firebird: em 6 minutos não chama sync nenhum', async () => {
    process.env['ERP_SYNC_ENABLED'] = 'true';
    vi.useFakeTimers();
    const { startErpSyncScheduler, stopErpSyncScheduler, runFullSync, runStockSync, lerCanais } =
      await carregarAgendador({
        [EMPRESA]: { catalogo: 'carga', cadastro: 'carga' },
        [OUTRA]: { catalogo: 'api', cadastro: 'api' },
      });

    startErpSyncScheduler();
    await vi.advanceTimersByTimeAsync(6 * 60_000);
    stopErpSyncScheduler();

    expect(lerCanais).toHaveBeenCalled();
    expect(runFullSync).not.toHaveBeenCalled();
    expect(runStockSync).not.toHaveBeenCalled();
  });

  it('só a empresa com o canal certo roda; canal ilegível pula aquela e segue', async () => {
    const { runFullSyncAllCompanies, runStockSyncAllCompanies, runFullSync, runStockSync } =
      await carregarAgendador({
        [EMPRESA]: { catalogo: 'firebird', cadastro: 'carga' },
        [OUTRA]: new Error('banco não respondeu'),
        [TERCEIRA]: { catalogo: 'carga', cadastro: 'firebird' },
      });

    await runStockSyncAllCompanies();
    await runFullSyncAllCompanies();

    expect(runStockSync.mock.calls).toEqual([[EMPRESA]]);
    expect(runFullSync.mock.calls).toEqual([[EMPRESA], [TERCEIRA]]);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(OUTRA));
  });

  it('a empresa pulada vai para o log uma vez, não a cada rodada', async () => {
    const { runStockSyncAllCompanies } = await carregarAgendador({
      [EMPRESA]: { catalogo: 'carga', cadastro: 'carga' },
    });

    await runStockSyncAllCompanies();
    await runStockSyncAllCompanies();
    await runStockSyncAllCompanies();

    const avisos = vi.mocked(console.warn).mock.calls.filter((c) => String(c[0]).includes('pulado'));
    expect(avisos).toHaveLength(1);
    expect(String(avisos[0]?.[0])).toContain(EMPRESA);
  });
});

describe('adaptadores do ERP — nunca inventam número', () => {
  it('os dois sendOrder lançam, sem devolver erp_order_id', async () => {
    const { MockErpAdapter, FirebirdErpAdapter, EnvioAoErpDesligadoError } = await import(
      '../apps/api/src/erp/adapter.js'
    );
    const pedidoFalso = { id: '00000000-0000-0000-0000-0000000000f1' } as never;

    await expect(new MockErpAdapter().sendOrder(pedidoFalso)).rejects.toBeInstanceOf(EnvioAoErpDesligadoError);
    await expect(new FirebirdErpAdapter().sendOrder(pedidoFalso)).rejects.toMatchObject({
      code: 'ERP_ENVIO_DESLIGADO',
    });
  });
});
