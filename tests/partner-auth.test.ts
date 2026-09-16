import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { criarSupabaseFake } from './supabaseFake.js';

/**
 * A porta da API de Parceiro: a chave no header X-API-Key.
 *
 * As chaves vivem SÓ na env PARTNER_API_KEYS (JSON [{name, key, company_id}])
 * e são lidas no primeiro request. O que fica trancado:
 *   • sem a env, a API está desligada — 503 PARTNER_API_DISABLED, com ou sem
 *     chave (é o que o Railway responde hoje, 15/09/2026: a env nunca existiu);
 *   • chave errada ou ausente é 401 PARTNER_UNAUTHORIZED;
 *   • chave certa amarra o parceiro à empresa dele — é o `company_id` que
 *     escopa toda consulta e gravação de todas as rotas;
 *   • (fase 0) o status diz os canais de pedido, faturamento e cadastro, e
 *     toda chamada — inclusive a recusada — fica em erp_sync_log sem a chave.
 */

const EMPRESA = 'empresa-1';
const CHAVE = 'chave-de-teste-do-control-nao-usar';
const CHAVES = JSON.stringify([{ name: 'control-cs', key: CHAVE, company_id: EMPRESA }]);
const SUPABASE = '../apps/api/src/config/supabase.js';

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

function requisicao(chave?: string) {
  return { headers: chave === undefined ? {} : { 'x-api-key': chave } } as unknown as FastifyRequest;
}

/** A env é lida uma vez por processo — cada cenário recarrega o módulo. */
async function carregarAuth(env: string | undefined) {
  if (env === undefined) delete process.env['PARTNER_API_KEYS'];
  else process.env['PARTNER_API_KEYS'] = env;
  vi.resetModules();
  return import('../apps/api/src/modules/partner/partner.auth.js');
}

describe('requirePartner', () => {
  afterEach(() => {
    delete process.env['PARTNER_API_KEYS'];
    // O spy de console.error do cenário do JSON inválido: restaurado aqui, e
    // não dentro do teste, para um expect falho não deixá-lo vazar.
    vi.restoreAllMocks();
  });

  it('sem PARTNER_API_KEYS a API está desligada: 503, mesmo com a chave certa', async () => {
    const { requirePartner } = await carregarAuth(undefined);
    const { reply, enviado } = replyFalso();

    expect(await requirePartner(requisicao(CHAVE), reply)).toBeNull();
    expect(enviado.status).toBe(503);
    expect(enviado.corpo).toEqual({
      error: 'API de parceiro não configurada',
      code: 'PARTNER_API_DISABLED',
      statusCode: 503,
    });
  });

  it('env com JSON inválido também desliga (503) em vez de derrubar a API', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { requirePartner } = await carregarAuth('{isso nao e json');
    const { reply, enviado } = replyFalso();

    expect(await requirePartner(requisicao(CHAVE), reply)).toBeNull();
    expect(enviado.status).toBe(503);
  });

  it('chave errada é 401 PARTNER_UNAUTHORIZED', async () => {
    const { requirePartner } = await carregarAuth(CHAVES);
    const { reply, enviado } = replyFalso();

    expect(await requirePartner(requisicao('outra-chave'), reply)).toBeNull();
    expect(enviado.status).toBe(401);
    expect(enviado.corpo).toMatchObject({ code: 'PARTNER_UNAUTHORIZED', statusCode: 401 });
  });

  it('sem o header também é 401', async () => {
    const { requirePartner } = await carregarAuth(CHAVES);
    const { reply, enviado } = replyFalso();

    expect(await requirePartner(requisicao(), reply)).toBeNull();
    expect(enviado.status).toBe(401);
  });

  it('chave certa devolve o parceiro amarrado à empresa dele, sem responder nada', async () => {
    const { requirePartner } = await carregarAuth(CHAVES);
    const { reply, enviado } = replyFalso();

    expect(await requirePartner(requisicao(CHAVE), reply)).toEqual({
      name: 'control-cs',
      key: CHAVE,
      company_id: EMPRESA,
    });
    expect(enviado.corpo).toBeUndefined();
  });

  it('entrada incompleta na env (sem company_id) não vira chave válida', async () => {
    const { requirePartner } = await carregarAuth(JSON.stringify([{ name: 'x', key: CHAVE }]));
    const { reply, enviado } = replyFalso();

    // A única entrada é descartada → lista vazia → API desligada.
    expect(await requirePartner(requisicao(CHAVE), reply)).toBeNull();
    expect(enviado.status).toBe(503);
  });
});

describe('GET /partner/v1/status na aplicação de verdade', () => {
  let app: FastifyInstance;
  let fake: ReturnType<typeof criarSupabaseFake>;

  beforeAll(async () => {
    process.env['PARTNER_API_KEYS'] = CHAVES;
    vi.resetModules();
    // Sem `companies` registrada: a sonda do canal diz "existe" e a empresa
    // não tem linha — valem os padrões de hoje (nenhum canal na API).
    fake = criarSupabaseFake({});
    vi.doMock(SUPABASE, () => ({ supabase: fake.cliente }));
    const { buildApp } = await import('../apps/api/src/app.js');
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    vi.doUnmock(SUPABASE);
    delete process.env['PARTNER_API_KEYS'];
  });

  it('com a chave certa responde 200 { ok, parceiro, servidor_hora } — o teste de ponta a ponta com o Fábio', async () => {
    const res = await app.inject({ method: 'GET', url: '/partner/v1/status', headers: { 'x-api-key': CHAVE } });

    expect(res.statusCode).toBe(200);
    const corpo = res.json() as { ok: boolean; parceiro: string; servidor_hora: string };
    expect(corpo).toMatchObject({ ok: true, parceiro: 'control-cs' });
    expect(Number.isNaN(Date.parse(corpo.servidor_hora))).toBe(false);
  });

  it('o status diz quais mãos estão ligadas para a API — sem a virada, as de hoje', async () => {
    const res = await app.inject({ method: 'GET', url: '/partner/v1/status', headers: { 'x-api-key': CHAVE } });

    expect(res.statusCode).toBe(200);
    // Os cinco canais (048): sem a virada, os padrões de hoje.
    expect((res.json() as { canais: unknown }).canais).toEqual({
      pedido_erp: 'manual',
      faturamento: 'manual',
      cadastro: 'carga',
      retrato: 'carga',
      catalogo: 'carga',
    });
  });

  it('as dezenove rotas do parceiro estão registradas — chave errada é 401 em todas, nunca 404', async () => {
    const rotas: Array<[string, string]> = [
      ['GET', '/partner/v1/status'],
      ['GET', '/partner/v1/conciliacao'],
      ['GET', '/partner/v1/pedidos/excluidos'],
      ['POST', '/partner/v1/sincronizacao'],
      ['GET', '/partner/v1/pedidos'],
      ['POST', '/partner/v1/pedidos/o1/confirmar'],
      ['POST', '/partner/v1/pedidos/o1/conciliar'],
      ['POST', '/partner/v1/pedidos/o1/excluir'],
      ['POST', '/partner/v1/faturamento'],
      ['POST', '/partner/v1/clientes'],
      ['POST', '/partner/v1/representantes'],
      ['GET', '/partner/v1/clientes'],
      ['GET', '/partner/v1/representantes'],
      ['POST', '/partner/v1/tabelas-preco'],
      ['POST', '/partner/v1/condicoes-pagamento'],
      ['POST', '/partner/v1/produtos'],
      ['POST', '/partner/v1/precos'],
      ['POST', '/partner/v1/estoque'],
      ['POST', '/partner/v1/retrato'],
    ];
    expect(rotas).toHaveLength(19);
    for (const [method, url] of rotas) {
      const res = await app.inject({ method: method as 'GET' | 'POST', url, headers: { 'x-api-key': 'errada' } });
      expect([method, url, res.statusCode]).toEqual([method, url, 401]);
    }
  });

  it('toda chamada fica registrada em erp_sync_log com a empresa e o parceiro da chave', async () => {
    const antes = fake.gravacoes.length;
    const res = await app.inject({ method: 'GET', url: '/partner/v1/status', headers: { 'x-api-key': CHAVE } });
    expect(res.statusCode).toBe(200);

    // O registro roda no onResponse, depois que a resposta saiu.
    await vi.waitFor(() => {
      expect(fake.gravacoes.slice(antes).some((g) => g.tabela === 'erp_sync_log')).toBe(true);
    });
    const linha = fake.ultimaGravacao('erp_sync_log', 'insert')?.valores as Record<string, unknown>;
    expect(linha).toMatchObject({
      company_id: EMPRESA,
      parceiro: 'control-cs',
      sync_type: 'parceiro',
      status: 'success',
      rota: '/partner/v1/status',
      metodo: 'GET',
      http_status: 200,
    });
    expect(typeof linha['started_at']).toBe('string');
    expect(JSON.stringify(linha)).not.toContain(CHAVE);
  });

  it('requisição SEM chave nenhuma não vira linha no banco — varredura de robô não escreve aqui', async () => {
    const antes = fake.gravacoes.length;
    const res = await app.inject({ method: 'GET', url: '/partner/v1/status' });
    expect(res.statusCode).toBe(401);

    // O onResponse roda depois da resposta: dá um respiro e confere que nada veio.
    await new Promise((r) => setTimeout(r, 50));
    expect(fake.gravacoes.slice(antes).filter((g) => g.tabela === 'erp_sync_log')).toEqual([]);
  });

  it('chamada com chave errada também é registrada: 401, sem empresa, sem parceiro e sem a chave', async () => {
    const antes = fake.gravacoes.length;
    await app.inject({ method: 'GET', url: '/partner/v1/status', headers: { 'x-api-key': 'chave-errada-de-teste' } });

    await vi.waitFor(() => {
      expect(fake.gravacoes.slice(antes).some((g) => g.tabela === 'erp_sync_log')).toBe(true);
    });
    const linha = fake.ultimaGravacao('erp_sync_log', 'insert')?.valores as Record<string, unknown>;
    expect(linha).toMatchObject({
      company_id: null,
      parceiro: null,
      http_status: 401,
      status: 'error',
      detalhe: { code: 'PARTNER_UNAUTHORIZED' },
    });
    expect(JSON.stringify(linha)).not.toContain('chave-errada-de-teste');
  });

  it('a rota registrada é o PADRÃO, não a URL com o id; o canal fechado fica no detalhe', async () => {
    const antes = fake.gravacoes.length;
    const res = await app.inject({
      method: 'POST',
      url: '/partner/v1/pedidos/00000000-0000-0000-0000-000000000001/confirmar',
      headers: { 'x-api-key': CHAVE },
      payload: { pedido_erp: 'ZZ0000001' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'CANAL_FECHADO', canal: 'pedido_erp', valor_atual: 'manual' });
    await vi.waitFor(() => {
      expect(fake.gravacoes.slice(antes).some((g) => g.tabela === 'erp_sync_log')).toBe(true);
    });
    const linha = fake.ultimaGravacao('erp_sync_log', 'insert')?.valores as Record<string, unknown>;
    expect(linha).toMatchObject({
      rota: '/partner/v1/pedidos/:id/confirmar',
      metodo: 'POST',
      http_status: 409,
      detalhe: { code: 'CANAL_FECHADO', canal: 'pedido_erp', valor_atual: 'manual' },
    });
    // Nada de pedido foi gravado.
    expect(fake.gravacoes.slice(antes).filter((g) => g.tabela === 'orders')).toHaveLength(0);
  });

  it('com chave errada responde 401 PARTNER_UNAUTHORIZED', async () => {
    const res = await app.inject({ method: 'GET', url: '/partner/v1/status', headers: { 'x-api-key': 'errada' } });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: 'PARTNER_UNAUTHORIZED', statusCode: 401 });
  });

  it('sem header responde 401 — e não passa pelo JWT do app', async () => {
    const res = await app.inject({ method: 'GET', url: '/partner/v1/status' });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: 'PARTNER_UNAUTHORIZED' });
  });
});

describe('GET /partner/v1/status com o banco sem responder sobre o canal', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env['PARTNER_API_KEYS'] = CHAVES;
    vi.resetModules();
    // A leitura de companies falha com code vazio ("fetch failed"): não é
    // "coluna não existe", é "não sei".
    const fake = criarSupabaseFake({
      companies: { data: null, error: { message: 'fetch failed', code: '' } },
    });
    vi.doMock(SUPABASE, () => ({ supabase: fake.cliente }));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { buildApp } = await import('../apps/api/src/app.js');
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    vi.doUnmock(SUPABASE);
    vi.restoreAllMocks();
    delete process.env['PARTNER_API_KEYS'];
  });

  it('degrada para canais: null em vez de 500 — é a rota de diagnóstico', async () => {
    const res = await app.inject({ method: 'GET', url: '/partner/v1/status', headers: { 'x-api-key': CHAVE } });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, parceiro: 'control-cs', canais: null });
  });
});

describe('GET /partner/v1/status com os canais virados (048 aplicada)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env['PARTNER_API_KEYS'] = CHAVES;
    vi.resetModules();
    const fake = criarSupabaseFake({
      // Fila de um item: a sonda e a leitura recebem a mesma linha.
      companies: {
        data: {
          canal_pedido_erp: 'api',
          canal_faturamento: 'api',
          canal_cadastro: 'firebird',
          canal_retrato: 'carga',
          canal_catalogo: 'carga',
        },
        error: null,
      },
    });
    vi.doMock(SUPABASE, () => ({ supabase: fake.cliente }));
    const { buildApp } = await import('../apps/api/src/app.js');
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    vi.doUnmock(SUPABASE);
    delete process.env['PARTNER_API_KEYS'];
  });

  it('responde os três canais que o parceiro precisa saber, sem mudar os campos antigos', async () => {
    const res = await app.inject({ method: 'GET', url: '/partner/v1/status', headers: { 'x-api-key': CHAVE } });

    expect(res.statusCode).toBe(200);
    const corpo = res.json() as Record<string, unknown>;
    // `sincronizar_agora` e `solicitado_em` (049) são os únicos campos novos —
    // aditivos; o primeiro sempre booleano.
    expect(Object.keys(corpo).sort()).toEqual([
      'canais',
      'ok',
      'parceiro',
      'servidor_hora',
      'sincronizar_agora',
      'solicitado_em',
    ]);
    expect(corpo).toMatchObject({
      ok: true,
      parceiro: 'control-cs',
      canais: { pedido_erp: 'api', faturamento: 'api', cadastro: 'firebird' },
      // Esta empresa não apertou "Sincronizar agora" (a linha não tem o carimbo).
      sincronizar_agora: false,
      solicitado_em: null,
    });
  });
});
