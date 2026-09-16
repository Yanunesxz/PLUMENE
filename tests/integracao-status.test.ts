import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { criarSupabaseFake, type Filtro, type RespostaTabela } from './supabaseFake.js';

/**
 * A tela da integração com o Control (decisão 7 de 16/09/2026):
 *
 *   • GET /erp/integracao/status — canais, pedido de sincronização, última
 *     chamada por rota (erp_sync_log, só contagens — nunca o `detalhe`) e a
 *     fila em contagens (count exact + head), tudo pela empresa do token.
 *     Cada bloco falha sozinho: `null` + aviso, e o resto sai.
 *   • PATCH /erp/integracao/sincronizar — grava companies.sync_solicitado_em
 *     (049) UMA vez: pedido pendente não é regravado.
 *   • POST /partner/v1/sincronizacao { concluida: true } — o Control limpa o
 *     pedido; sem pedido, nada gravado; pedido mais novo que o que ele viu fica.
 *
 * Sem a 048/049 vale o comportamento de hoje. Dados todos fictícios.
 */

const EMPRESA = '00000000-0000-0000-0000-00000000000a';
const USUARIO = '00000000-0000-0000-0000-0000000000f1';
const SUPABASE = '../apps/api/src/config/supabase.js';
const SERVICO = '../apps/api/src/modules/integracao/integracao.service.js';
const HANDLER_PARCEIRO = '../apps/api/src/modules/partner/partner.sincronizacao.controller.js';
const AUTH_PARCEIRO = '../apps/api/src/modules/partner/partner.auth.js';

const OK: RespostaTabela = { data: [], error: null };
const SONDA_OK = OK;
const semColuna = (coluna: string): RespostaTabela => ({
  data: null,
  error: { code: '42703', message: `column ${coluna} does not exist` },
});
const SOLUCO: RespostaTabela = { data: null, error: { code: '503', message: 'service unavailable' } };
const contagem = (n: number): RespostaTabela => ({ data: null, error: null, count: n });

/** Cada `from()` consome uma resposta e cada `await` pré-busca a seguinte. */
const emSequencia = (...respostas: RespostaTabela[]) => respostas.flatMap((r) => [r, r]);

const CANAIS_LIGADOS: RespostaTabela = {
  data: {
    canal_pedido_erp: 'api',
    canal_faturamento: 'api',
    canal_cadastro: 'api',
    canal_retrato: 'carga',
    canal_catalogo: 'carga',
  },
  error: null,
};
const PEDIDO_EM = '2026-09-16T14:00:00.000Z';
const SEM_PEDIDO: RespostaTabela = { data: { sync_solicitado_em: null, sync_solicitado_por: null }, error: null };
const COM_PEDIDO: RespostaTabela = { data: { sync_solicitado_em: PEDIDO_EM, sync_solicitado_por: USUARIO }, error: null };
const NOME: RespostaTabela = { data: { name: 'Ana Financeiro' }, error: null };

const linhaDoRegistro = (over: Record<string, unknown>): RespostaTabela => ({
  data: [
    {
      rota: '/partner/v1/pedidos',
      metodo: 'GET',
      started_at: '2026-09-16T13:59:00.000Z',
      http_status: 200,
      recebidos: null,
      gravados: null,
      ignorados: null,
      sem_mudanca: null,
      ...over,
    },
  ],
  error: null,
});

/**
 * As rotas de ROTAS_DO_PARCEIRO, na ordem: a fila (posição 1) e o
 * faturamento (posição 7) já foram chamados; as outras nunca. O teste confere
 * a ordem e o tamanho contra a lista do próprio módulo antes de usar as posições.
 */
const TOTAL_DE_ROTAS = 19;
const FILA_CHAMADA = linhaDoRegistro({});
const FATURAMENTO_CHAMADO = linhaDoRegistro({
  rota: '/partner/v1/faturamento',
  metodo: 'POST',
  started_at: '2026-09-16T13:30:00.000Z',
  http_status: 200,
  recebidos: 3,
  gravados: 2,
  ignorados: 1,
  sem_mudanca: 0,
});
const POR_ROTA: RespostaTabela[] = Array.from({ length: TOTAL_DE_ROTAS }, (_, i) =>
  i === 1 ? FILA_CHAMADA : i === 7 ? FATURAMENTO_CHAMADO : OK,
);
/** A janela de rotas fora da lista: uma nova (uma rota que a lista não conhece) e uma conhecida (ignorada). */
const JANELA: RespostaTabela = {
  data: [
    { ...(FILA_CHAMADA.data as unknown[])[0] as object },
    {
      rota: '/partner/v1/pendencia-financeira',
      metodo: 'POST',
      started_at: '2026-09-16T12:00:00.000Z',
      http_status: 500,
      recebidos: 40,
      gravados: 0,
      ignorados: null,
      sem_mudanca: null,
    },
  ],
  error: null,
};

function consultasDe(filtros: Filtro[]): Filtro[][] {
  const grupos: Filtro[][] = [];
  for (const f of filtros) {
    if (f.metodo === 'select') grupos.push([]);
    grupos.at(-1)?.push(f);
  }
  return grupos;
}

async function carregar(respostas: Record<string, RespostaTabela | RespostaTabela[]>) {
  const fake = criarSupabaseFake(respostas as never);
  vi.doMock(SUPABASE, () => ({ supabase: fake.cliente }));
  const mod = await import(SERVICO);
  (await import('../apps/api/src/lib/detectarColuna.js')).esquecerDeteccoes();
  (await import('../apps/api/src/lib/canais.js')).esquecerCanais();
  return { ...mod, fake };
}

const abertos: FastifyInstance[] = [];

beforeEach(() => {
  vi.resetModules();
});
afterEach(async () => {
  vi.doUnmock(SUPABASE);
  vi.doUnmock(AUTH_PARCEIRO);
  vi.restoreAllMocks();
  await Promise.all(abertos.splice(0).map((app) => app.close()));
});

// ─── GET /erp/integracao/status — o serviço ──────────────────────────────────

describe('lerEstadoDaIntegracao', () => {
  it('com a 048 e a 049: canais, pedido pendente com o nome, última chamada por rota e a fila em contagens', async () => {
    const { lerEstadoDaIntegracao, ROTAS_DO_PARCEIRO, fake } = await carregar({
      // sonda canal_pedido_erp, a linha dos canais, sonda sync_solicitado_em, a linha do pedido
      companies: emSequencia(SONDA_OK, CANAIS_LIGADOS, SONDA_OK, COM_PEDIDO),
      users: NOME,
      // sonda de rota (+ espaço), uma consulta por rota, e a janela de rotas novas
      erp_sync_log: [SONDA_OK, SONDA_OK, ...POR_ROTA, JANELA],
      // sonda invoiced (+), sonda erp_requested_at (+), as quatro contagens em paralelo
      orders: [SONDA_OK, SONDA_OK, SONDA_OK, SONDA_OK, contagem(3), contagem(1), contagem(2), contagem(5)],
    });
    expect(ROTAS_DO_PARCEIRO[1]!.rota).toBe('/partner/v1/pedidos');
    expect(ROTAS_DO_PARCEIRO[7]!.rota).toBe('/partner/v1/faturamento');
    expect(ROTAS_DO_PARCEIRO).toHaveLength(TOTAL_DE_ROTAS);

    const estado = await lerEstadoDaIntegracao(EMPRESA);

    expect(estado.avisos).toEqual([]);
    expect(estado.migracoes).toEqual({ canais: true, registro: true, sincronizacao: true, solicitacao_do_pedido: true });
    expect(estado.canais).toMatchObject({ pedido_erp: 'api', faturamento: 'api', cadastro: 'api', migracao: true });
    expect(estado.sincronizar_agora).toBe(true);
    expect(estado.solicitacao).toEqual({
      solicitado_em: PEDIDO_EM,
      solicitado_por: USUARIO,
      solicitado_por_nome: 'Ana Financeiro',
    });
    // O nome é lido dentro da empresa do token.
    expect(fake.filtrosDe('users', 'eq').map((f) => f.args)).toEqual(
      expect.arrayContaining([['id', USUARIO], ['company_id', EMPRESA]]),
    );

    // Uma linha por rota da lista, na ordem, e a rota nova da janela no fim.
    expect(estado.chamadas).toHaveLength(TOTAL_DE_ROTAS + 1);
    expect(estado.chamadas!.slice(0, TOTAL_DE_ROTAS).map((c) => `${c.metodo} ${c.rota}`)).toEqual(
      ROTAS_DO_PARCEIRO.map((r) => `${r.metodo} ${r.rota}`),
    );
    expect(estado.chamadas![0]).toMatchObject({ rota: '/partner/v1/status', quando: null, http_status: null });
    expect(estado.chamadas![1]).toMatchObject({
      rota: '/partner/v1/pedidos',
      titulo: 'Fila de pedidos',
      quando: '2026-09-16T13:59:00.000Z',
      http_status: 200,
    });
    expect(estado.chamadas![7]).toMatchObject({
      rota: '/partner/v1/faturamento',
      quando: '2026-09-16T13:30:00.000Z',
      recebidos: 3,
      gravados: 2,
      ignorados: 1,
      sem_mudanca: 0,
    });
    expect(estado.chamadas![TOTAL_DE_ROTAS]).toMatchObject({
      metodo: 'POST',
      rota: '/partner/v1/pendencia-financeira',
      titulo: '/partner/v1/pendencia-financeira',
      http_status: 500,
      recebidos: 40,
    });
    // Nunca o `detalhe`; sempre a empresa e só as chamadas do parceiro.
    const consultasDoRegistro = consultasDe(fake.filtrosDe('erp_sync_log')).slice(1);
    expect(consultasDoRegistro).toHaveLength(TOTAL_DE_ROTAS + 1);
    for (const c of consultasDoRegistro) {
      expect(String(c[0]!.args[0])).not.toMatch(/detalhe/);
      expect(c.map((f) => [f.metodo, ...f.args])).toEqual(
        expect.arrayContaining([['eq', 'company_id', EMPRESA], ['eq', 'sync_type', 'parceiro']]),
      );
    }
    const daFila = consultasDoRegistro[1]!.map((f) => [f.metodo, ...f.args]);
    expect(daFila).toEqual(
      expect.arrayContaining([['eq', 'rota', '/partner/v1/pedidos'], ['eq', 'metodo', 'GET'], ['limit', 1]]),
    );

    expect(estado.fila).toEqual({
      aguardando_clique: 3,
      solicitados_sem_numero: 1,
      enviados_sem_numero: 2,
      sem_faturamento: 5,
    });
    const contagens = consultasDe(fake.filtrosDe('orders')).slice(2);
    expect(contagens).toHaveLength(4);
    const resumo = contagens.map((c) => c.map((f) => [f.metodo, ...f.args]));
    for (const c of resumo) {
      expect(c[0]).toEqual(['select', 'id', { count: 'exact', head: true }]);
      expect(c).toContainEqual(['eq', 'company_id', EMPRESA]);
      expect(c).toContainEqual(['or', 'invoiced.is.null,invoiced.eq.false']);
    }
    const semNumero = ['is', 'erp_order_id', null];
    expect(resumo[0]).toEqual(expect.arrayContaining([['eq', 'status', 'approved'], semNumero, ['is', 'erp_requested_at', null]]));
    expect(resumo[1]).toEqual(
      expect.arrayContaining([['eq', 'status', 'approved'], semNumero, ['not', 'erp_requested_at', 'is', null]]),
    );
    expect(resumo[2]).toEqual(expect.arrayContaining([['eq', 'status', 'sent_erp'], semNumero]));
    expect(resumo[3]).toEqual(expect.arrayContaining([['eq', 'status', 'sent_erp'], ['not', 'erp_order_id', 'is', null]]));
  });

  it('sem a 048 e a 049: canais padrão, sem registro, sem pedido, e a fila de hoje (sem erp_requested_at)', async () => {
    const { lerEstadoDaIntegracao, fake } = await carregar({
      companies: semColuna('companies.canal_pedido_erp'),
      erp_sync_log: semColuna('erp_sync_log.rota'),
      orders: [SONDA_OK, SONDA_OK, semColuna('orders.erp_requested_at'), semColuna('orders.erp_requested_at'), contagem(4), contagem(2), contagem(6)],
    });

    const estado = await lerEstadoDaIntegracao(EMPRESA);

    expect(estado.avisos).toEqual([]);
    expect(estado.migracoes).toEqual({ canais: false, registro: false, sincronizacao: false, solicitacao_do_pedido: false });
    expect(estado.canais).toMatchObject({ pedido_erp: 'manual', faturamento: 'manual', cadastro: 'carga', migracao: false });
    expect(estado.sincronizar_agora).toBe(false);
    expect(estado.solicitacao).toBeNull();
    expect(estado.chamadas).toEqual([]);
    expect(estado.fila).toEqual({
      aguardando_clique: null,
      solicitados_sem_numero: 4,
      enviados_sem_numero: 2,
      sem_faturamento: 6,
    });
    // Nada de erp_requested_at nos filtros (a sonda `select` não conta): a coluna não existe.
    expect(fake.filtrosDe('orders').some((f) => f.metodo !== 'select' && f.args[0] === 'erp_requested_at')).toBe(false);
    // Só uma leitura de companies (a sonda): sem a 048 não se lê a empresa.
    expect(consultasDe(fake.filtrosDe('companies'))).toHaveLength(2);
    expect(fake.gravacoes).toEqual([]);
  });

  it('um soluço do banco no registro e na fila vira null + aviso; canais e pedido saem', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { lerEstadoDaIntegracao } = await carregar({
      companies: emSequencia(SONDA_OK, CANAIS_LIGADOS, SONDA_OK, SEM_PEDIDO),
      erp_sync_log: [SONDA_OK, SONDA_OK, SOLUCO],
      orders: SOLUCO,
    });

    const estado = await lerEstadoDaIntegracao(EMPRESA);

    expect(estado.canais).toMatchObject({ pedido_erp: 'api', migracao: true });
    expect(estado.sincronizar_agora).toBe(false);
    expect(estado.solicitacao).toBeNull();
    expect(estado.migracoes.sincronizacao).toBe(true);
    expect(estado.chamadas).toBeNull();
    expect(estado.fila).toBeNull();
    expect(estado.migracoes.registro).toBe(false);
    expect(estado.avisos).toHaveLength(2);
    expect(estado.avisos.join(' ')).toMatch(/registro das chamadas/);
    expect(estado.avisos.join(' ')).toMatch(/fila de pedidos/);
  });
});

// ─── PATCH /erp/integracao/sincronizar — pedirSincronizacao ──────────────────

describe('pedirSincronizacao', () => {
  it('sem a 049: não grava e diz que falta a migração', async () => {
    const { pedirSincronizacao, fake } = await carregar({ companies: semColuna('companies.sync_solicitado_em') });
    const r = await pedirSincronizacao(EMPRESA, { id: USUARIO, nome: 'Ana Financeiro' });
    expect(r).toEqual({ ok: false, motivo: 'sem_migracao' });
    expect(fake.gravacoes).toEqual([]);
  });

  it('sem pedido pendente: grava agora + quem pediu, só onde ainda não há pedido', async () => {
    const GRAVOU: RespostaTabela = {
      data: [{ sync_solicitado_em: PEDIDO_EM, sync_solicitado_por: USUARIO }],
      error: null,
    };
    const { pedirSincronizacao, fake } = await carregar({
      companies: emSequencia(SONDA_OK, SEM_PEDIDO, GRAVOU),
    });

    const r = await pedirSincronizacao(EMPRESA, { id: USUARIO, nome: 'Ana Financeiro' });

    expect(r).toEqual({
      ok: true,
      ja_solicitado: false,
      solicitacao: { solicitado_em: PEDIDO_EM, solicitado_por: USUARIO, solicitado_por_nome: 'Ana Financeiro' },
    });
    const g = fake.ultimaGravacao('companies', 'update');
    expect(g).toBeDefined();
    const v = g!.valores as Record<string, unknown>;
    expect(v['sync_solicitado_por']).toBe(USUARIO);
    expect(typeof v['sync_solicitado_em']).toBe('string');
    expect(Number.isNaN(Date.parse(v['sync_solicitado_em'] as string))).toBe(false);
    expect(Object.keys(v).sort()).toEqual(['sync_solicitado_em', 'sync_solicitado_por']);
    const filtros = fake.filtrosDe('companies').map((f) => [f.metodo, ...f.args]);
    expect(filtros).toEqual(expect.arrayContaining([['eq', 'id', EMPRESA], ['is', 'sync_solicitado_em', null]]));
  });

  it('com pedido pendente: não grava de novo e devolve o que está lá', async () => {
    const { pedirSincronizacao, fake } = await carregar({
      companies: emSequencia(SONDA_OK, COM_PEDIDO),
      users: NOME,
    });

    const r = await pedirSincronizacao(EMPRESA, { id: 'outro-usuario', nome: 'Outra Pessoa' });

    expect(r).toEqual({
      ok: true,
      ja_solicitado: true,
      solicitacao: { solicitado_em: PEDIDO_EM, solicitado_por: USUARIO, solicitado_por_nome: 'Ana Financeiro' },
    });
    expect(fake.gravacoes).toEqual([]);
  });
});

// ─── POST /partner/v1/sincronizacao — concluirSincronizacao ──────────────────

describe('concluirSincronizacao', () => {
  it('sem a 049: nada a limpar, nada gravado', async () => {
    const { concluirSincronizacao, fake } = await carregar({ companies: semColuna('companies.sync_solicitado_em') });
    expect(await concluirSincronizacao(EMPRESA)).toEqual({ migracao: false, limpo: false, pendente: null });
    expect(fake.gravacoes).toEqual([]);
  });

  it('sem pedido pendente: 200 sem gravar (idempotente)', async () => {
    const { concluirSincronizacao, fake } = await carregar({ companies: emSequencia(SONDA_OK, SEM_PEDIDO) });
    expect(await concluirSincronizacao(EMPRESA)).toEqual({ migracao: true, limpo: false, pendente: null });
    expect(fake.gravacoes).toEqual([]);
  });

  it('com pedido pendente: limpa os dois campos, só se ainda for o mesmo pedido', async () => {
    const LIMPOU: RespostaTabela = { data: [{ id: EMPRESA }], error: null };
    const { concluirSincronizacao, fake } = await carregar({ companies: emSequencia(SONDA_OK, COM_PEDIDO, LIMPOU) });

    expect(await concluirSincronizacao(EMPRESA, { solicitado_em: PEDIDO_EM })).toEqual({
      migracao: true,
      limpo: true,
      pendente: null,
    });
    const g = fake.ultimaGravacao('companies', 'update');
    expect(g!.valores).toEqual({ sync_solicitado_em: null, sync_solicitado_por: null });
    const filtros = fake.filtrosDe('companies').map((f) => [f.metodo, ...f.args]);
    expect(filtros).toEqual(expect.arrayContaining([['eq', 'id', EMPRESA], ['eq', 'sync_solicitado_em', PEDIDO_EM]]));
  });

  it('pedido MAIS NOVO que o que o Control viu fica de pé: nada gravado', async () => {
    const { concluirSincronizacao, fake } = await carregar({ companies: emSequencia(SONDA_OK, COM_PEDIDO) });

    expect(await concluirSincronizacao(EMPRESA, { solicitado_em: '2026-09-16T13:00:00.000Z' })).toEqual({
      migracao: true,
      limpo: false,
      pendente: PEDIDO_EM,
    });
    expect(fake.gravacoes).toEqual([]);
  });
});

// ─── O handler do parceiro ───────────────────────────────────────────────────

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

type RequisicaoDoParceiro = FastifyRequest<{ Body: unknown }> & {
  partnerLog?: Record<string, unknown> | null;
};

function requisicao(body: unknown): RequisicaoDoParceiro {
  return { body, params: {}, query: {}, headers: { 'x-api-key': 'chave' } } as unknown as RequisicaoDoParceiro;
}

async function carregarHandler(respostas: Record<string, RespostaTabela | RespostaTabela[]>) {
  const fake = criarSupabaseFake(respostas as never);
  vi.doMock(SUPABASE, () => ({ supabase: fake.cliente }));
  vi.doMock(AUTH_PARCEIRO, () => ({
    requirePartner: () => Promise.resolve({ name: 'control-teste', key: 'chave', company_id: EMPRESA }),
  }));
  const mod = await import(HANDLER_PARCEIRO);
  (await import('../apps/api/src/lib/detectarColuna.js')).esquecerDeteccoes();
  return { ...mod, fake };
}

describe('POST /partner/v1/sincronizacao (handler)', () => {
  it('sem "concluida": true é 400 MISSING_CONCLUIDA, nada lido nem gravado', async () => {
    const { partnerSincronizacaoHandler, fake } = await carregarHandler({});
    const { reply, enviado } = replyFalso();
    const req = requisicao({ concluida: false });

    await partnerSincronizacaoHandler(req, reply);

    expect(enviado.status).toBe(400);
    expect((enviado.corpo as { code: string }).code).toBe('MISSING_CONCLUIDA');
    expect(fake.filtros).toEqual([]);
    expect(fake.gravacoes).toEqual([]);
    expect(req.partnerLog).toMatchObject({ company_id: EMPRESA, parceiro: 'control-teste', detalhe: { code: 'MISSING_CONCLUIDA' } });
  });

  it('solicitado_em sem fuso é 400 INVALID_SOLICITADO_EM', async () => {
    const { partnerSincronizacaoHandler, fake } = await carregarHandler({});
    const { reply, enviado } = replyFalso();

    await partnerSincronizacaoHandler(requisicao({ concluida: true, solicitado_em: '2026-09-16T14:00:00' }), reply);

    expect(enviado.status).toBe(400);
    expect((enviado.corpo as { code: string }).code).toBe('INVALID_SOLICITADO_EM');
    expect(fake.gravacoes).toEqual([]);
  });

  it('concluida com pedido pendente: limpa, responde ok e anota 1 gravado', async () => {
    const LIMPOU: RespostaTabela = { data: [{ id: EMPRESA }], error: null };
    const { partnerSincronizacaoHandler, fake } = await carregarHandler({
      companies: emSequencia(SONDA_OK, COM_PEDIDO, LIMPOU),
    });
    const { reply, enviado } = replyFalso();
    const req = requisicao({ concluida: true });

    await partnerSincronizacaoHandler(req, reply);

    expect(enviado.status).toBe(200);
    expect(enviado.corpo).toMatchObject({ ok: true, limpo: true, sincronizar_agora: false, solicitado_em: null });
    expect(typeof (enviado.corpo as { servidor_hora: unknown }).servidor_hora).toBe('string');
    expect(fake.ultimaGravacao('companies', 'update')!.valores).toEqual({ sync_solicitado_em: null, sync_solicitado_por: null });
    expect(req.partnerLog).toMatchObject({ recebidos: 1, gravados: 1, sem_mudanca: 0, detalhe: { limpo: true } });
  });

  it('concluida sem pedido pendente: ok sem gravar, anotado como sem mudança', async () => {
    const { partnerSincronizacaoHandler, fake } = await carregarHandler({
      companies: emSequencia(SONDA_OK, SEM_PEDIDO),
    });
    const { reply, enviado } = replyFalso();
    const req = requisicao({ concluida: true });

    await partnerSincronizacaoHandler(req, reply);

    expect(enviado.status).toBe(200);
    expect(enviado.corpo).toMatchObject({ ok: true, limpo: false, sincronizar_agora: false });
    expect(fake.gravacoes).toEqual([]);
    expect(req.partnerLog).toMatchObject({ gravados: 0, sem_mudanca: 1 });
  });
});

// ─── As rotas com JWT (guards) ───────────────────────────────────────────────

const SEGREDO = 'segredo-de-teste-nao-usar-em-producao'; // igual ao tests/setup.ts
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

function assinar(payload: Record<string, unknown>): string {
  const cabecalho = b64({ alg: 'HS256', typ: 'JWT' });
  const agora = Math.floor(Date.now() / 1000);
  const corpo = b64({ ...payload, iat: agora, exp: agora + 3600 });
  const assinatura = crypto.createHmac('sha256', SEGREDO).update(`${cabecalho}.${corpo}`).digest('base64url');
  return `${cabecalho}.${corpo}.${assinatura}`;
}

const base = { email: 'x@csb.com', company_id: EMPRESA, name: 'Ana Financeiro', price_table_id: null };
const TOKEN = {
  admin: assinar({ ...base, sub: USUARIO, role: 'admin' }),
  gerente: assinar({ ...base, sub: 'ger-1', role: 'manager', permissions: null }),
  financeiro: assinar({ ...base, sub: USUARIO, role: 'financeiro' }),
  rep: assinar({ ...base, sub: 'rep-1', role: 'rep' }),
};

async function comBanco(respostas: Record<string, RespostaTabela | RespostaTabela[]>) {
  const fake = criarSupabaseFake(respostas as never);
  vi.doMock(SUPABASE, () => ({ supabase: fake.cliente }));
  const { buildApp } = await import('../apps/api/src/app.js');
  const app = await buildApp();
  await app.ready();
  abertos.push(app);
  return { app, fake };
}

const chamar = (app: FastifyInstance, method: 'GET' | 'PATCH', url: string, token?: string) =>
  app.inject({
    method,
    url,
    ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
    ...(method === 'PATCH' ? { payload: {} } : {}),
  });

describe('as rotas /erp/integracao', () => {
  it('status: 401 sem token, 403 para rep, 200 para financeiro e gerente (sem as migrações: padrões)', async () => {
    const { app } = await comBanco({
      companies: semColuna('companies.canal_pedido_erp'),
      erp_sync_log: semColuna('erp_sync_log.rota'),
      orders: [SONDA_OK, SONDA_OK, semColuna('orders.erp_requested_at'), semColuna('orders.erp_requested_at'), contagem(0)],
    });

    expect((await chamar(app, 'GET', '/erp/integracao/status')).statusCode).toBe(401);
    expect((await chamar(app, 'GET', '/erp/integracao/status', TOKEN.rep)).statusCode).toBe(403);

    const res = await chamar(app, 'GET', '/erp/integracao/status', TOKEN.financeiro);
    expect(res.statusCode).toBe(200);
    const { data } = res.json() as { data: { canais: { migracao: boolean }; chamadas: unknown[]; fila: unknown; servidor_hora: string } };
    expect(data.canais.migracao).toBe(false);
    expect(data.chamadas).toEqual([]);
    expect(data.fila).toEqual({ aguardando_clique: null, solicitados_sem_numero: 0, enviados_sem_numero: 0, sem_faturamento: 0 });
    expect(typeof data.servidor_hora).toBe('string');

    expect((await chamar(app, 'GET', '/erp/integracao/status', TOKEN.gerente)).statusCode).toBe(200);
  });

  it('sincronizar: 403 para gerente e rep; 503 MIGRACAO_PENDENTE sem a 049; 200 para o admin com a 049', async () => {
    const semMigracao = await comBanco({ companies: semColuna('companies.sync_solicitado_em') });
    expect((await chamar(semMigracao.app, 'PATCH', '/erp/integracao/sincronizar', TOKEN.gerente)).statusCode).toBe(403);
    expect((await chamar(semMigracao.app, 'PATCH', '/erp/integracao/sincronizar', TOKEN.rep)).statusCode).toBe(403);
    const recusa = await chamar(semMigracao.app, 'PATCH', '/erp/integracao/sincronizar', TOKEN.financeiro);
    expect(recusa.statusCode).toBe(503);
    expect((recusa.json() as { code: string }).code).toBe('MIGRACAO_PENDENTE');
    expect(semMigracao.fake.gravacoes).toEqual([]);

    vi.resetModules();
    const GRAVOU: RespostaTabela = { data: [{ sync_solicitado_em: PEDIDO_EM, sync_solicitado_por: USUARIO }], error: null };
    const comMigracao = await comBanco({ companies: emSequencia(SONDA_OK, SEM_PEDIDO, GRAVOU) });
    const res = await chamar(comMigracao.app, 'PATCH', '/erp/integracao/sincronizar', TOKEN.admin);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      data: {
        ja_solicitado: false,
        solicitacao: { solicitado_em: PEDIDO_EM, solicitado_por: USUARIO, solicitado_por_nome: 'Ana Financeiro' },
      },
    });
    const v = comMigracao.fake.ultimaGravacao('companies', 'update')!.valores as Record<string, unknown>;
    expect(v['sync_solicitado_por']).toBe(USUARIO);
  });
});
