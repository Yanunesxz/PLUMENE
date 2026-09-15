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
 *     escopa toda consulta e gravação das seis rotas.
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

  beforeAll(async () => {
    process.env['PARTNER_API_KEYS'] = CHAVES;
    vi.resetModules();
    const fake = criarSupabaseFake({});
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
