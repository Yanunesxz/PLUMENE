import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import { criarSupabaseFake, type RespostaTabela } from './supabaseFake.js';

/**
 * Excluir cliente (só admin) e o dono na ficha — decisões do Yan, 16/09/2026.
 *
 * O que estes testes trancam:
 *   • só o admin exclui; os outros papéis levam 403 sem tocar no banco;
 *   • cliente com pedido, login, convite, vitrine ou tarefa não sai sem um
 *     cadastro que fique com tudo (409 com as contagens);
 *   • o cadastro que fica é OUTRO cliente da MESMA empresa (400);
 *   • a cópia vai para deleted_customers ANTES do DELETE; pedidos, convites,
 *     vitrines e tarefas mudam de dono; o login de loja é herdado ou desligado,
 *     nunca apagado; o que fica ganha updated_at;
 *   • sem a 050, nada acontece (409); banco mudo, 503;
 *   • falha no meio desfaz o que já tinha mudado e responde 500.
 *
 * Todos os nomes e documentos daqui são fictícios.
 */

const EMPRESA = 'empresa-ficticia-1';
const SEGREDO = 'segredo-de-teste-nao-usar-em-producao'; // igual ao tests/setup.ts
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

function assinar(payload: Record<string, unknown>): string {
  const cabecalho = b64({ alg: 'HS256', typ: 'JWT' });
  const agora = Math.floor(Date.now() / 1000);
  const corpo = b64({ ...payload, iat: agora, exp: agora + 3600 });
  const assinatura = crypto.createHmac('sha256', SEGREDO).update(`${cabecalho}.${corpo}`).digest('base64url');
  return `${cabecalho}.${corpo}.${assinatura}`;
}

const base = { email: 'teste@exemplo.com', company_id: EMPRESA, price_table_id: null };
const TOKEN = {
  admin: assinar({ ...base, sub: 'adm-ficticio', name: 'ADMIN FICTICIO', role: 'admin' }),
  gerente: assinar({ ...base, sub: 'ger-ficticio', name: 'GERENTE FICTICIO', role: 'manager' }),
  financeiro: assinar({ ...base, sub: 'fin-ficticio', name: 'FINANCEIRO FICTICIO', role: 'financeiro' }),
  rep: assinar({ ...base, sub: 'rep-ficticio', name: 'REP FICTICIO', role: 'rep' }),
};

const SAI = '00000000-0000-4000-8000-000000000001';
const FICA = '00000000-0000-4000-8000-000000000002';

const CLIENTE_QUE_SAI = {
  id: SAI,
  company_id: EMPRESA,
  name: 'LOJA FICTICIA QUE SAI LTDA',
  cnpj: '11222333000181',
  cnpj_digits: '11222333000181',
  erp_id: '09999',
  rep_id: null,
  rep_erp_id: '00779',
  blocked: false,
};

const ok = (data: unknown = null, extra: Partial<RespostaTabela> = {}): RespostaTabela => ({
  data,
  error: null,
  ...extra,
});
const falha = (message: string, code?: string): RespostaTabela => ({
  data: null,
  error: code ? { message, code } : { message },
});
const conta = (n: number): RespostaTabela => ({ data: null, error: null, count: n });

/**
 * A fila do dublê para respostas EM ORDEM: cada consulta consome duas posições
 * (a que entrega e a que adianta), e a última fica grudada. Aqui a i-ésima
 * consulta da tabela recebe a i-ésima resposta.
 */
function emOrdem(...respostas: RespostaTabela[]): RespostaTabela[] {
  const fila: RespostaTabela[] = [];
  respostas.forEach((r, i) => {
    fila.push(r);
    if (i < respostas.length - 1) fila.push(r);
  });
  return fila;
}

async function subirApp(respostas: Record<string, RespostaTabela | RespostaTabela[]>) {
  const fake = criarSupabaseFake(respostas);
  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
  const { buildApp } = await import('../apps/api/src/app.js');
  const app = await buildApp();
  await app.ready();
  return { app, fake };
}

async function excluir(
  respostas: Record<string, RespostaTabela | RespostaTabela[]>,
  corpo: Record<string, unknown>,
  token = TOKEN.admin,
  id = SAI,
) {
  const { app, fake } = await subirApp(respostas);
  const res = await app.inject({
    method: 'POST',
    url: `/customers/${id}/excluir`,
    headers: { authorization: `Bearer ${token}` },
    payload: corpo,
  });
  await app.close();
  return { res, fake, corpo: res.json() as Record<string, unknown> };
}

/** O cenário completo de uma junção que dá certo. */
function juncaoCompleta(sobrescrever: Record<string, RespostaTabela | RespostaTabela[]> = {}) {
  return {
    deleted_customers: emOrdem(ok([]), ok({ id: 'rastro-1' })),
    customers: emOrdem(ok(CLIENTE_QUE_SAI), ok({ id: FICA }), ok(), ok()),
    orders: emOrdem(conta(2), ok([{ id: 'ped-1' }, { id: 'ped-2' }]), ok([{ id: 'ped-1' }, { id: 'ped-2' }])),
    users: emOrdem(
      conta(2),
      ok([
        { id: 'login-antigo', active: true, last_login_at: '2026-01-10T12:00:00Z' },
        { id: 'login-recente', active: true, last_login_at: '2026-09-01T12:00:00Z' },
      ]),
      ok([]),
      ok(),
    ),
    store_invites: emOrdem(conta(1), ok([]), ok([{ id: 'convite-1' }])),
    showcase_links: emOrdem(conta(1), ok([{ id: 'vitrine-1' }])),
    rep_tasks: emOrdem(conta(1), ok([{ id: 'tarefa-1' }])),
    ...sobrescrever,
  };
}

type Valores = Record<string, unknown>;

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock('../apps/api/src/config/supabase.js');
  vi.restoreAllMocks();
});

// ─── Quem pode ───────────────────────────────────────────────────────────────

describe('POST /customers/:id/excluir — quem pode', () => {
  for (const [papel, token] of [
    ['gerente', TOKEN.gerente],
    ['financeiro', TOKEN.financeiro],
    ['representante', TOKEN.rep],
  ] as const) {
    it(`${papel} leva 403 e nada é lido nem gravado`, async () => {
      const { res, fake, corpo } = await excluir(juncaoCompleta(), { juntar_em: FICA }, token);

      expect(res.statusCode).toBe(403);
      expect(corpo.code).toBe('FORBIDDEN');
      expect(fake.gravacoes).toHaveLength(0);
      expect(fake.filtros).toHaveLength(0);
    });
  }

  it('o diálogo (GET /customers/:id/vinculos) também é só do admin', async () => {
    const { app, fake } = await subirApp(juncaoCompleta());
    const res = await app.inject({
      method: 'GET',
      url: `/customers/${SAI}/vinculos`,
      headers: { authorization: `Bearer ${TOKEN.gerente}` },
    });
    await app.close();

    expect(res.statusCode).toBe(403);
    expect(fake.filtros).toHaveLength(0);
  });

  it('id que não é UUID é 404, sem consultar o banco', async () => {
    const { res, fake } = await excluir(juncaoCompleta(), {}, TOKEN.admin, 'nao-e-um-id');

    expect(res.statusCode).toBe(404);
    expect(fake.filtros).toHaveLength(0);
  });
});

// ─── As recusas ──────────────────────────────────────────────────────────────

describe('POST /customers/:id/excluir — recusas', () => {
  it('com vínculos e sem juntar_em: 409 CLIENTE_COM_VINCULOS com as contagens, nada gravado', async () => {
    const { res, fake, corpo } = await excluir(juncaoCompleta(), { motivo: 'cadastro em dobro' });

    expect(res.statusCode).toBe(409);
    expect(corpo.code).toBe('CLIENTE_COM_VINCULOS');
    expect(corpo.contagens).toEqual({ pedidos: 2, logins: 2, convites: 1, vitrines: 1, tarefas: 1 });
    expect(fake.gravacoes).toHaveLength(0);
  });

  it('só uma tarefa já basta para exigir o cadastro que fica', async () => {
    const { res, fake, corpo } = await excluir(
      juncaoCompleta({
        orders: conta(0),
        users: conta(0),
        store_invites: conta(0),
        showcase_links: conta(0),
        rep_tasks: conta(1),
      }),
      {},
    );

    expect(res.statusCode).toBe(409);
    expect((corpo.contagens as Valores).tarefas).toBe(1);
    expect(fake.gravacoes).toHaveLength(0);
  });

  it('as contagens são da empresa do token', async () => {
    const { fake } = await excluir(juncaoCompleta(), {});

    for (const tabela of ['orders', 'users', 'store_invites', 'showcase_links', 'rep_tasks']) {
      const eq = fake.filtrosDe(tabela, 'eq');
      expect(eq.some((f) => f.args[0] === 'company_id' && f.args[1] === EMPRESA)).toBe(true);
      expect(eq.some((f) => f.args[0] === 'customer_id' && f.args[1] === SAI)).toBe(true);
    }
  });

  it('juntar_em de outra empresa: 400 JUNTAR_EM_INVALIDO, nada gravado', async () => {
    // A busca do cadastro que fica vai com o company_id do token — o de outra
    // empresa volta vazio.
    const { res, fake, corpo } = await excluir(
      juncaoCompleta({ customers: emOrdem(ok(CLIENTE_QUE_SAI), ok(null)) }),
      { juntar_em: FICA },
    );

    expect(res.statusCode).toBe(400);
    expect(corpo.code).toBe('JUNTAR_EM_INVALIDO');
    expect(fake.gravacoes).toHaveLength(0);
    const eq = fake.filtrosDe('customers', 'eq');
    expect(eq.some((f) => f.args[0] === 'id' && f.args[1] === FICA)).toBe(true);
    expect(eq.filter((f) => f.args[0] === 'company_id').every((f) => f.args[1] === EMPRESA)).toBe(true);
  });

  it('juntar_em igual ao próprio cliente: 400', async () => {
    const { res, fake, corpo } = await excluir(juncaoCompleta(), { juntar_em: SAI });

    expect(res.statusCode).toBe(400);
    expect(corpo.code).toBe('JUNTAR_EM_INVALIDO');
    expect(fake.gravacoes).toHaveLength(0);
  });

  it('juntar_em que não é UUID: 400 de validação', async () => {
    const { res, fake } = await excluir(juncaoCompleta(), { juntar_em: 'qualquer-coisa' });

    expect(res.statusCode).toBe(400);
    expect(fake.gravacoes).toHaveLength(0);
  });

  it('cliente de outra empresa (ou inexistente): 404', async () => {
    const { res, fake } = await excluir(juncaoCompleta({ customers: ok(null) }), { juntar_em: FICA });

    expect(res.statusCode).toBe(404);
    expect(fake.gravacoes).toHaveLength(0);
  });

  it('sem a migração 050: 409 MIGRACAO_PENDENTE e nada é alterado', async () => {
    const { res, fake, corpo } = await excluir(
      juncaoCompleta({
        deleted_customers: falha('relation "public.deleted_customers" does not exist', '42P01'),
      }),
      { juntar_em: FICA },
    );

    expect(res.statusCode).toBe(409);
    expect(corpo.code).toBe('MIGRACAO_PENDENTE');
    expect(fake.gravacoes).toHaveLength(0);
    // Nem o cliente chegou a ser lido.
    expect(fake.filtrosDe('customers')).toHaveLength(0);
  });

  it('banco sem resposta sobre a 050: 503 e nada é alterado', async () => {
    const { res, fake, corpo } = await excluir(
      juncaoCompleta({ deleted_customers: falha('fetch failed') }),
      { juntar_em: FICA },
    );

    expect(res.statusCode).toBe(503);
    expect(corpo.code).toBe('BANCO_INDISPONIVEL');
    expect(fake.gravacoes).toHaveLength(0);
  });

  it('contagem que falha não vira zero: 500 e nada é apagado', async () => {
    const { res, fake } = await excluir(
      juncaoCompleta({ users: falha('statement timeout') }),
      {},
    );

    expect(res.statusCode).toBe(500);
    expect(fake.gravacoes).toHaveLength(0);
  });
});

// ─── A junção ────────────────────────────────────────────────────────────────

describe('POST /customers/:id/excluir — juntando em outro cadastro', () => {
  it('grava a cópia antes, move tudo, herda o login, desliga o outro e apaga', async () => {
    const { res, fake, corpo } = await excluir(juncaoCompleta(), {
      juntar_em: FICA,
      motivo: '  cadastro em dobro  ',
    });

    expect(res.statusCode).toBe(200);
    expect(corpo.data).toEqual({
      customer_id: SAI,
      juntado_em: FICA,
      pedidos_movidos: 2,
      convites_movidos: 1,
      convites_revogados: 0,
      vitrines_movidas: 1,
      tarefas_movidas: 1,
      login_herdado: true,
      logins_desligados: 1,
    });

    // A cópia: a linha inteira, para onde foi, quem e por quê.
    const copia = fake.ultimaGravacao('deleted_customers', 'insert')!.valores as Valores;
    expect(copia).toMatchObject({
      company_id: EMPRESA,
      customer_id: SAI,
      erp_id: '09999',
      cnpj_digits: '11222333000181',
      juntado_em: FICA,
      pedidos_movidos: 2,
      deleted_by: 'adm-ficticio',
      deleted_by_name: 'ADMIN FICTICIO',
      motivo: 'cadastro em dobro',
    });
    expect(copia.snapshot).toEqual(CLIENTE_QUE_SAI);

    // A ordem: cópia primeiro, DELETE por último.
    const posicao = (tabela: string, operacao: string) =>
      fake.gravacoes.findIndex((g) => g.tabela === tabela && g.operacao === operacao);
    const indiceDaCopia = posicao('deleted_customers', 'insert');
    const indiceDoDelete = posicao('customers', 'delete');
    expect(indiceDaCopia).toBe(0);
    expect(indiceDoDelete).toBe(fake.gravacoes.length - 1);

    // Pedidos: mudam de dono com updated_at, pelos ids lidos e com a origem na condição.
    const pedidos = fake.ultimaGravacao('orders', 'update')!.valores as Valores;
    expect(pedidos.customer_id).toBe(FICA);
    expect(typeof pedidos.updated_at).toBe('string');
    expect(fake.filtrosDe('orders', 'in').some((f) => JSON.stringify(f.args[1]) === '["ped-1","ped-2"]')).toBe(true);

    // Convites, vitrines e tarefas.
    expect((fake.ultimaGravacao('store_invites', 'update')!.valores as Valores).customer_id).toBe(FICA);
    expect((fake.ultimaGravacao('showcase_links', 'update')!.valores as Valores).customer_id).toBe(FICA);
    const tarefas = fake.ultimaGravacao('rep_tasks', 'update')!.valores as Valores;
    expect(tarefas.customer_id).toBe(FICA);
    expect(typeof tarefas.updated_at).toBe('string');

    // Login: o de acesso mais recente vai para o que fica; o outro é desligado.
    const logins = fake.gravacoes.filter((g) => g.tabela === 'users');
    expect(logins.map((g) => g.operacao)).toEqual(['update', 'update']);
    expect(logins[0]!.valores).toEqual({ customer_id: FICA });
    expect(logins[1]!.valores).toEqual({ active: false, customer_id: null });
    const idsDosLogins = fake
      .filtrosDe('users', 'eq')
      .filter((f) => f.args[0] === 'id')
      .map((f) => f.args[1]);
    expect(idsDosLogins).toEqual(['login-recente', 'login-antigo']);

    // O que fica ganha updated_at; o DELETE é do que sai, na empresa do token.
    const toque = fake.gravacoes.find((g) => g.tabela === 'customers' && g.operacao === 'update')!;
    expect(Object.keys(toque.valores as Valores)).toEqual(['updated_at']);
    const eqCustomers = fake.filtrosDe('customers', 'eq');
    expect(eqCustomers.some((f) => f.args[0] === 'id' && f.args[1] === FICA)).toBe(true);
    expect(eqCustomers.filter((f) => f.args[0] === 'company_id').every((f) => f.args[1] === EMPRESA)).toBe(true);

    // Nada de login apagado, nada de cópia desfeita.
    expect(fake.gravacoes.some((g) => g.tabela === 'users' && g.operacao === 'delete')).toBe(false);
    expect(fake.ultimaGravacao('deleted_customers', 'delete')).toBeUndefined();
  });

  it('o que fica já tem login: o do que sai é desligado, não herdado', async () => {
    const { res, fake, corpo } = await excluir(
      juncaoCompleta({
        users: emOrdem(
          conta(1),
          ok([{ id: 'login-que-sai', active: true, last_login_at: '2026-09-01T12:00:00Z' }]),
          ok([{ id: 'login-que-fica' }]),
          ok(),
        ),
      }),
      { juntar_em: FICA },
    );

    expect(res.statusCode).toBe(200);
    expect((corpo.data as Valores).login_herdado).toBe(false);
    expect((corpo.data as Valores).logins_desligados).toBe(1);
    const logins = fake.gravacoes.filter((g) => g.tabela === 'users');
    expect(logins).toHaveLength(1);
    expect(logins[0]!.valores).toEqual({ active: false, customer_id: null });
  });

  it('pedido com número do Control não impede — só muda de dono', async () => {
    const { res, fake } = await excluir(
      juncaoCompleta({
        orders: emOrdem(conta(1), ok([{ id: 'ped-no-control' }]), ok([{ id: 'ped-no-control' }])),
      }),
      { juntar_em: FICA },
    );

    expect(res.statusCode).toBe(200);
    expect((fake.ultimaGravacao('orders', 'update')!.valores as Valores).customer_id).toBe(FICA);
    expect(fake.filtros.some((f) => f.tabela === 'orders' && f.args[0] === 'erp_order_id')).toBe(false);
  });

  it('o que fica já tem convite pendente: o pendente do que sai é revogado antes de mover', async () => {
    const { res, fake, corpo } = await excluir(
      juncaoCompleta({
        store_invites: emOrdem(conta(1), ok([{ id: 'pendente-do-que-fica' }]), ok([{ id: 'convite-1' }]), ok([{ id: 'convite-1' }])),
      }),
      { juntar_em: FICA },
    );

    expect(res.statusCode).toBe(200);
    expect((corpo.data as Valores).convites_revogados).toBe(1);
    const convites = fake.gravacoes.filter((g) => g.tabela === 'store_invites');
    expect(Object.keys(convites[0]!.valores as Valores)).toEqual(['revoked_at']);
    expect(convites[1]!.valores).toEqual({ customer_id: FICA });
  });

  it('se mudou de dono um número de pedidos diferente do contado, a cópia é corrigida', async () => {
    const { res, fake } = await excluir(
      juncaoCompleta({
        deleted_customers: emOrdem(ok([]), ok({ id: 'rastro-1' }), ok()),
        orders: emOrdem(conta(2), ok([{ id: 'ped-1' }, { id: 'ped-2' }, { id: 'ped-3' }]), ok([{ id: 'ped-1' }, { id: 'ped-2' }, { id: 'ped-3' }])),
      }),
      { juntar_em: FICA },
    );

    expect(res.statusCode).toBe(200);
    const correcao = fake.ultimaGravacao('deleted_customers', 'update')!.valores as Valores;
    expect(correcao.pedidos_movidos).toBe(3);
  });

  it('sem vínculos e sem juntar_em: grava a cópia e apaga, sem mover nada', async () => {
    const { res, fake, corpo } = await excluir(
      juncaoCompleta({
        customers: emOrdem(ok(CLIENTE_QUE_SAI), ok()),
        orders: conta(0),
        users: conta(0),
        store_invites: conta(0),
        showcase_links: conta(0),
        rep_tasks: conta(0),
      }),
      {},
    );

    expect(res.statusCode).toBe(200);
    expect((corpo.data as Valores).juntado_em).toBeNull();
    expect(fake.gravacoes.map((g) => `${g.tabela}.${g.operacao}`)).toEqual([
      'deleted_customers.insert',
      'customers.delete',
    ]);
    const copia = fake.ultimaGravacao('deleted_customers', 'insert')!.valores as Valores;
    expect(copia.juntado_em).toBeNull();
    expect(copia.pedidos_movidos).toBe(0);
    expect(copia.motivo).toBeNull();
  });
});

// ─── Falha no meio ───────────────────────────────────────────────────────────

describe('POST /customers/:id/excluir — falha no meio', () => {
  it('a cópia não grava: 500 e nada mais acontece', async () => {
    const { res, fake, corpo } = await excluir(
      juncaoCompleta({ deleted_customers: emOrdem(ok([]), falha('permission denied')) }),
      { juntar_em: FICA },
    );

    expect(res.statusCode).toBe(500);
    expect(corpo.code).toBe('EXCLUSAO_FALHOU');
    expect(fake.gravacoes.map((g) => `${g.tabela}.${g.operacao}`)).toEqual(['deleted_customers.insert']);
  });

  it('o DELETE falha: tudo volta, a cópia sai e a resposta é 500 com desfeito', async () => {
    const { res, fake, corpo } = await excluir(
      juncaoCompleta({
        customers: emOrdem(
          ok(CLIENTE_QUE_SAI),
          ok({ id: FICA }),
          ok(),
          falha('update or delete on table "customers" violates foreign key constraint', '23503'),
        ),
        orders: emOrdem(conta(2), ok([{ id: 'ped-1' }, { id: 'ped-2' }]), ok([{ id: 'ped-1' }, { id: 'ped-2' }]), ok()),
        users: emOrdem(
          conta(2),
          ok([
            { id: 'login-antigo', active: false, last_login_at: null },
            { id: 'login-recente', active: true, last_login_at: '2026-09-01T12:00:00Z' },
          ]),
          ok([]),
          ok(),
        ),
      }),
      { juntar_em: FICA },
    );

    expect(res.statusCode).toBe(500);
    expect(corpo.code).toBe('EXCLUSAO_FALHOU');
    expect(corpo.desfeito).toBe(true);

    const indiceDoDelete = fake.gravacoes.findIndex((g) => g.tabela === 'customers' && g.operacao === 'delete');
    const depois = fake.gravacoes.slice(indiceDoDelete + 1);
    const resumo = depois.map((g) => `${g.tabela}.${g.operacao}`);

    // Do último passo para o primeiro; a cópia sai por último.
    expect(resumo).toEqual([
      'users.update', // religa o desligado
      'users.update', // devolve o herdado
      'rep_tasks.update',
      'showcase_links.update',
      'store_invites.update',
      'orders.update',
      'deleted_customers.delete',
    ]);
    expect(depois[0]!.valores).toEqual({ active: false, customer_id: SAI }); // volta como estava
    expect(depois[1]!.valores).toEqual({ customer_id: SAI });
    expect((depois[2]!.valores as Valores).customer_id).toBe(SAI);
    expect(depois[3]!.valores).toEqual({ customer_id: SAI });
    expect(depois[4]!.valores).toEqual({ customer_id: SAI });
    const pedidosDeVolta = depois[5]!.valores as Valores;
    expect(pedidosDeVolta.customer_id).toBe(SAI);
    expect(typeof pedidosDeVolta.updated_at).toBe('string');
  });

  it('o desfazer também falha: 500 sem desfeito, a cópia fica anotada e o erro vai para o log', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { res, fake, corpo } = await excluir(
      juncaoCompleta({
        deleted_customers: emOrdem(ok([]), ok({ id: 'rastro-1' }), ok()),
        showcase_links: emOrdem(conta(1), ok([{ id: 'vitrine-1' }]), falha('connection reset')),
        rep_tasks: emOrdem(conta(1), falha('statement timeout')),
      }),
      { juntar_em: FICA, motivo: 'cadastro em dobro' },
    );

    expect(res.statusCode).toBe(500);
    expect(corpo.desfeito).toBe(false);
    // A cópia não é apagada: é o único registro de para onde foram os pedidos.
    expect(fake.ultimaGravacao('deleted_customers', 'delete')).toBeUndefined();
    const anotacao = fake.ultimaGravacao('deleted_customers', 'update')!.valores as Valores;
    expect(String(anotacao.motivo)).toMatch(/^cadastro em dobro \| EXCLUSÃO NÃO CONCLUÍDA/);
    // O que deu para desfazer foi desfeito mesmo assim.
    expect(
      fake.gravacoes.some(
        (g) => g.tabela === 'orders' && (g.valores as Valores).customer_id === SAI,
      ),
    ).toBe(true);
    // Nunca apagou o cliente.
    expect(fake.ultimaGravacao('customers', 'delete')).toBeUndefined();
    expect(log).toHaveBeenCalled();
    expect(String(log.mock.calls[0]![0])).not.toContain('LOJA FICTICIA');
  });
});

// ─── O diálogo ───────────────────────────────────────────────────────────────

describe('GET /customers/:id/vinculos', () => {
  it('devolve as contagens e diz que a 050 está aplicada', async () => {
    const { app } = await subirApp(juncaoCompleta({ customers: ok({ id: SAI }) }));
    const res = await app.inject({
      method: 'GET',
      url: `/customers/${SAI}/vinculos`,
      headers: { authorization: `Bearer ${TOKEN.admin}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: unknown }).data).toEqual({
      contagens: { pedidos: 2, logins: 2, convites: 1, vitrines: 1, tarefas: 1 },
      migracao_pendente: false,
    });
  });

  it('sem a 050 avisa migracao_pendente', async () => {
    const { app } = await subirApp(
      juncaoCompleta({
        customers: ok({ id: SAI }),
        deleted_customers: falha('Could not find the table in the schema cache', 'PGRST205'),
      }),
    );
    const res = await app.inject({
      method: 'GET',
      url: `/customers/${SAI}/vinculos`,
      headers: { authorization: `Bearer ${TOKEN.admin}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { migracao_pendente: boolean } }).data.migracao_pendente).toBe(true);
  });
});

describe('GET /customers?cnpj= — o cadastro em dobro', () => {
  it('filtra pelo documento só em dígitos (cnpj_digits, com a 041)', async () => {
    const { app, fake } = await subirApp({ customers: ok([]) });
    const res = await app.inject({
      method: 'GET',
      url: '/customers?cnpj=11.222.333/0001-81',
      headers: { authorization: `Bearer ${TOKEN.admin}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(
      fake.filtrosDe('customers', 'eq').some((f) => f.args[0] === 'cnpj_digits' && f.args[1] === '11222333000181'),
    ).toBe(true);
  });

  it('documento sem dígito não devolve a carteira inteira', async () => {
    const { app } = await subirApp({ customers: ok([{ id: SAI }]) });
    const res = await app.inject({
      method: 'GET',
      url: '/customers?cnpj=abc',
      headers: { authorization: `Bearer ${TOKEN.admin}` },
    });
    await app.close();

    expect((res.json() as { data: unknown[] }).data).toEqual([]);
  });
});

// ─── O dono na ficha ─────────────────────────────────────────────────────────

describe('GET /customers/:id — o dono', () => {
  const FICHA = {
    id: SAI,
    name: 'LOJA FICTICIA QUE SAI LTDA',
    trade_name: null,
    cnpj: '11222333000181',
    whatsapp: null,
    email: null,
    address: null,
    credit_limit: null,
    blocked: false,
    block_reason: null,
    price_table_id: null,
    erp_id: '09999',
  };

  async function carregarFicha(users: RespostaTabela | RespostaTabela[], ficha: Record<string, unknown>) {
    const fake = criarSupabaseFake({ customers: ok(ficha), orders: ok([]), users });
    vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
    const mod = await import('../apps/api/src/modules/customers/customers.service.js');
    return { ...mod, fake };
  }

  it('quem cadastrou e o representante do código, casado pelo miolo e na mesma empresa', async () => {
    const { obterCliente, fake } = await carregarFicha(
      emOrdem(
        ok({ id: 'rep-cadastro', name: 'REP FICTICIO CADASTRO' }),
        ok([
          { id: 'rep-outro', name: 'REP FICTICIO OUTRO', erp_rep_id: '00780', active: true },
          { id: 'rep-codigo', name: 'REP FICTICIO DO CODIGO', erp_rep_id: '#779', active: true },
        ]),
      ),
      { ...FICHA, rep_id: 'rep-cadastro', rep_erp_id: '00779' },
    );

    const ficha = await obterCliente(EMPRESA, SAI, { rep_id: 'adm-ficticio', irrestrito: true });

    expect(ficha!.dono).toEqual({
      rep_id: 'rep-cadastro',
      rep_nome: 'REP FICTICIO CADASTRO',
      rep_erp_id: '00779',
      rep_pelo_codigo_id: 'rep-codigo',
      rep_pelo_codigo_nome: 'REP FICTICIO DO CODIGO',
    });
    // As colunas cruas não vazam soltas na resposta.
    expect(ficha).not.toHaveProperty('rep_id');
    expect(ficha).not.toHaveProperty('rep_erp_id');
    const eq = fake.filtrosDe('users', 'eq');
    expect(eq.filter((f) => f.args[0] === 'company_id').every((f) => f.args[1] === EMPRESA)).toBe(true);
    expect(eq.some((f) => f.args[0] === 'role' && f.args[1] === 'rep')).toBe(true);
  });

  it('dois logins com o mesmo código: vale o ativo', async () => {
    const { obterCliente } = await carregarFicha(
      ok([
        { id: 'rep-inativo', name: 'REP FICTICIO INATIVO', erp_rep_id: '779', active: false },
        { id: 'rep-ativo', name: 'REP FICTICIO ATIVO', erp_rep_id: '00779', active: true },
      ]),
      { ...FICHA, rep_id: null, rep_erp_id: '00779' },
    );

    const ficha = await obterCliente(EMPRESA, SAI, { rep_id: 'x', irrestrito: true });

    expect(ficha!.dono!.rep_pelo_codigo_nome).toBe('REP FICTICIO ATIVO');
    expect(ficha!.dono!.rep_nome).toBeNull();
  });

  it('sem rep_id e sem código: dono vazio, sem consultar usuários', async () => {
    const { obterCliente, fake } = await carregarFicha(ok([]), { ...FICHA, rep_id: null, rep_erp_id: null });

    const ficha = await obterCliente(EMPRESA, SAI, { rep_id: 'x', irrestrito: true });

    expect(ficha!.dono).toEqual({
      rep_id: null,
      rep_nome: null,
      rep_erp_id: null,
      rep_pelo_codigo_id: null,
      rep_pelo_codigo_nome: null,
    });
    expect(fake.filtrosDe('users')).toHaveLength(0);
  });

  it('código sem login de representante: o código aparece, o nome não', async () => {
    const { obterCliente } = await carregarFicha(
      ok([{ id: 'rep-outro', name: 'REP FICTICIO OUTRO', erp_rep_id: '00780', active: true }]),
      { ...FICHA, rep_id: null, rep_erp_id: '00779' },
    );

    const ficha = await obterCliente(EMPRESA, SAI, { rep_id: 'x', irrestrito: true });

    expect(ficha!.dono!.rep_erp_id).toBe('00779');
    expect(ficha!.dono!.rep_pelo_codigo_nome).toBeNull();
  });

  it('pela rota: o dono vai na resposta da ficha', async () => {
    const { app } = await subirApp({
      customers: ok({ ...FICHA, rep_id: null, rep_erp_id: '00779' }),
      orders: ok([]),
      users: ok([{ id: 'rep-codigo', name: 'REP FICTICIO DO CODIGO', erp_rep_id: '779', active: true }]),
    });
    const res = await app.inject({
      method: 'GET',
      url: `/customers/${SAI}`,
      headers: { authorization: `Bearer ${TOKEN.gerente}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const dono = (res.json() as { data: { dono: Valores } }).data.dono;
    expect(dono.rep_pelo_codigo_nome).toBe('REP FICTICIO DO CODIGO');
    expect(dono.rep_erp_id).toBe('00779');
  });
});

// ─── A tela: o dono em palavras e as contas do diálogo ───────────────────────

describe('a ficha escreve o dono', () => {
  const vazio = {
    rep_id: null,
    rep_nome: null,
    rep_erp_id: null,
    rep_pelo_codigo_id: null,
    rep_pelo_codigo_nome: null,
  };

  it('representante do código, com o código; quem cadastrou só se for outro', async () => {
    const { linhasDoDono } = await import('../apps/web/src/lib/donoDoCliente.js');

    expect(
      linhasDoDono({
        ...vazio,
        rep_id: 'rep-a',
        rep_nome: 'REP FICTICIO A',
        rep_erp_id: '00779',
        rep_pelo_codigo_id: 'rep-b',
        rep_pelo_codigo_nome: 'REP FICTICIO B',
      }),
    ).toEqual({ representante: 'REP FICTICIO B (código 00779)', cadastradoPor: 'REP FICTICIO A' });

    expect(
      linhasDoDono({
        ...vazio,
        rep_id: 'rep-b',
        rep_nome: 'REP FICTICIO B',
        rep_erp_id: '00779',
        rep_pelo_codigo_id: 'rep-b',
        rep_pelo_codigo_nome: 'REP FICTICIO B',
      }),
    ).toEqual({ representante: 'REP FICTICIO B (código 00779)', cadastradoPor: null });
  });

  it('nascido no app sem código: o dono é quem cadastrou', async () => {
    const { linhasDoDono } = await import('../apps/web/src/lib/donoDoCliente.js');

    expect(linhasDoDono({ ...vazio, rep_id: 'rep-a', rep_nome: 'REP FICTICIO A' })).toEqual({
      representante: 'REP FICTICIO A',
      cadastradoPor: null,
    });
  });

  it('sem dono: diz que não há, e mostra o código que nenhum login tem', async () => {
    const { linhasDoDono } = await import('../apps/web/src/lib/donoDoCliente.js');

    expect(linhasDoDono(vazio)).toEqual({ representante: 'Sem representante dono', cadastradoPor: null });
    expect(linhasDoDono({ ...vazio, rep_erp_id: '00779', rep_id: 'rep-a', rep_nome: 'REP FICTICIO A' })).toEqual({
      representante: 'Sem representante dono (código 00779 sem login no app)',
      cadastradoPor: 'REP FICTICIO A',
    });
  });
});

describe('as contas do diálogo de exclusão', () => {
  it('fala só do que existe, no singular e no plural', async () => {
    const { frasesDosVinculos, totalDeVinculos } = await import('../apps/web/src/lib/exclusaoDeCliente.js');
    const c = { pedidos: 3, logins: 1, convites: 0, vitrines: 2, tarefas: 1 };

    expect(frasesDosVinculos(c)).toEqual(['3 pedidos', '1 login de loja', '2 vitrines', '1 tarefa']);
    expect(totalDeVinculos(c)).toBe(7);
    expect(frasesDosVinculos({ pedidos: 0, logins: 0, convites: 0, vitrines: 0, tarefas: 0 })).toEqual([]);
  });

  it('o cadastro que fica nunca é o próprio cliente nem outro documento', async () => {
    const { candidatosAFicar } = await import('../apps/web/src/lib/exclusaoDeCliente.js');
    const item = (id: string, cnpj: string | null) => ({ id, cnpj, name: `LOJA FICTICIA ${id}` }) as never;

    const lista = [item(SAI, '11222333000181'), item(FICA, '11.222.333/0001-81'), item('outro', '99888777000166')];
    expect(candidatosAFicar(lista, SAI, '11222333000181').map((c) => c.id)).toEqual([FICA]);
    // Na busca por nome, qualquer documento serve — só o próprio sai.
    expect(candidatosAFicar(lista, SAI).map((c) => c.id)).toEqual([FICA, 'outro']);
  });

  it('o aviso da lista diz o que passou para o cadastro que ficou', async () => {
    const { avisoDaExclusao } = await import('../apps/web/src/lib/exclusaoDeCliente.js');
    const r = {
      customer_id: SAI,
      juntado_em: FICA,
      pedidos_movidos: 2,
      convites_movidos: 0,
      convites_revogados: 0,
      vitrines_movidas: 0,
      tarefas_movidas: 1,
      login_herdado: true,
      logins_desligados: 1,
    };

    expect(avisoDaExclusao('LOJA A', r, 'LOJA B')).toBe(
      'LOJA A foi excluído e juntado em LOJA B, que ficou com 2 pedidos, 1 login de loja e 1 tarefa. 1 login de loja foi desligado.',
    );
    expect(
      avisoDaExclusao('LOJA A', { ...r, pedidos_movidos: 1, tarefas_movidas: 0, login_herdado: false, logins_desligados: 0 }, 'LOJA B'),
    ).toBe('LOJA A foi excluído e juntado em LOJA B, que ficou com 1 pedido.');
    expect(avisoDaExclusao('LOJA A', { ...r, juntado_em: null }, null)).toBe('LOJA A foi excluído.');
  });
});
