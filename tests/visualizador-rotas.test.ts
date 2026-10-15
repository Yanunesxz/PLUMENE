import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { PAPEIS_QUE_VEEM_A_FILA_DO_CONTROL } from '@csb/shared';
import { criarSupabaseFake } from './supabaseFake.js';
import { ESCRITAS_COM_GUARDA } from './inventarioDeRotas.js';

/**
 * O papel visualizador (054) batendo na aplicação de verdade, via
 * `app.inject` — sem abrir porta e sem encostar no Supabase.
 *
 * Pedido do Yan (15/10/2026): "ele pode ver tudo so nao pode alterar nada, nao
 * pode mudar logins e etc.. (…) ve cliente, produto ve tudo tudo mas nao
 * altera nada". São as duas metades deste arquivo:
 *
 *   • LEITURA — cada tela que ele abre responde (200 ou 404), nunca 403. Um
 *     403 aqui é menu levando a "acesso negado".
 *   • ESCRITA — toda rota que grava responde 403, e com o corpo de erro
 *     padrão. É a guarda de PAPEL na rota; esconder o botão é a segunda linha.
 *
 * O inventário de TODAS as escritas está em visualizador-inventario.test.ts,
 * que lê os routers; aqui ficam as principais, provadas de ponta a ponta.
 */

const EMPRESA = 'empresa-1';
const SEGREDO = 'segredo-de-teste-nao-usar-em-producao'; // igual ao tests/setup.ts
const UUID_QUALQUER = '00000000-0000-0000-0000-000000000000';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

function assinar(payload: Record<string, unknown>): string {
  const cabecalho = b64({ alg: 'HS256', typ: 'JWT' });
  const agora = Math.floor(Date.now() / 1000);
  const corpo = b64({ ...payload, iat: agora, exp: agora + 3600 });
  const assinatura = crypto
    .createHmac('sha256', SEGREDO)
    .update(`${cabecalho}.${corpo}`)
    .digest('base64url');
  return `${cabecalho}.${corpo}.${assinatura}`;
}

const base = { email: 'x@csb.com', company_id: EMPRESA, name: 'Teste' };

const TOKEN = {
  /**
   * O visualizador como o login dele nasce: SEM tabela de preço própria. É
   * esse detalhe que derrubava o catálogo do financeiro (régua de comprador →
   * catálogo vazio), e por isso ele entra aqui do jeito mais cru possível.
   */
  visualizador: assinar({ ...base, sub: 'vis-1', role: 'visualizador', price_table_id: null }),
  admin: assinar({ ...base, sub: 'adm-1', role: 'admin', price_table_id: null }),
  rep: assinar({ ...base, sub: 'rep-1', role: 'rep', price_table_id: 'tabela-do-rep' }),
};

let app: FastifyInstance;
let fake: ReturnType<typeof criarSupabaseFake>;

/** A linha que o banco devolveria para o login recém-criado. */
const LOGIN_NOVO = {
  id: 'vis-novo',
  name: 'Olheiro',
  email: 'olheiro@csb.com',
  role: 'visualizador',
  active: true,
  created_at: '2026-10-15T00:00:00.000Z',
  last_login_at: null,
  permissions: null,
};

/** Um login que JÁ existe, para a edição do papel ter alvo. */
const LOGIN_EXISTENTE = {
  id: 'ger-1',
  name: 'Gerente',
  email: 'gerente@csb.com',
  role: 'manager',
  active: true,
  created_at: '2026-01-10T00:00:00.000Z',
  last_login_at: null,
  permissions: null,
};

/**
 * O banco AINDA SEM a 054.
 *
 * O código sobe antes do SQL (regra do CLAUDE.md), então existe uma janela em
 * que a tela de Logins já oferece "Visualizador" e o CHECK `chk_users_role` é
 * o da 038. Nessa janela o Postgres recusa o INSERT com 23514 — e, pelo
 * histórico do projeto (052, 053 e 047 pendentes nos dois bancos), é o estado
 * em que o Yan vai usar a tela PRIMEIRO. Ligar esta chave é reproduzir isso.
 */
let bancoSemA054 = false;

/** O erro que o Postgres devolve quando o CHECK do papel recusa a linha. */
const ERRO_DO_CHECK = {
  code: '23514',
  message: 'new row for relation "users" violates check constraint "chk_users_role"',
};

beforeAll(async () => {
  fake = criarSupabaseFake({
    products: {
      data: [{ id: 'p1', sku: '0001', name: 'Camisola', active: true, image_url: null }],
      error: null,
    },
    product_variants: {
      data: [{ id: 'v1', product_id: 'p1', size: 'P', stock_quantity: 7, stock_committed: 1 }],
      error: null,
    },
    product_prices: { data: [{ product_id: 'p1', price: 30 }], error: null },
    price_tables: { data: [{ id: 'tabela-2', name: 'TABELA 02', company_id: EMPRESA }], error: null },
    rep_price_tables: { data: [], error: null },
    customers: { data: [], error: null },
    customer_changes: { data: [], error: null },
    orders: { data: [], error: null },
    order_items: { data: [], error: null },
    deleted_orders: { data: [], error: null },
    // `users` reage à consulta: gravação devolve a linha criada/alterada (é o
    // que o service relê para montar a resposta) — ou o erro do CHECK, quando
    // o teste liga `bancoSemA054`. A busca por id acha o login existente (sem
    // alvo, a edição pararia em 404 antes do UPDATE) e as outras saem vazias:
    // a busca por e-mail precisa dar "ninguém" para o cadastro seguir.
    users: (consulta) => {
      if (consulta.operacao === 'insert' || consulta.operacao === 'update') {
        if (bancoSemA054) return { data: null, error: ERRO_DO_CHECK };
        return { data: [LOGIN_NOVO], error: null };
      }
      const porId = consulta.filtros.some((f) => f.metodo === 'eq' && f.args[0] === 'id');
      if (porId) return { data: [LOGIN_EXISTENTE], error: null, count: 1 };
      return { data: [], error: null, count: 1 };
    },
    tarefas: { data: [], error: null },
    payment_conditions: { data: [], error: null },
    cancelamento_motivos: { data: [], error: null },
    companies: { data: { id: EMPRESA }, error: null },
    rep_goals: { data: [], error: null },
  });
  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));

  const { buildApp } = await import('../apps/api/src/app.js');
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app?.close();
});

const chamar = (
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  token: string,
  payload?: unknown,
) =>
  app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}` },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

// ─── Leitura: tudo o que o escritório lê ─────────────────────────────────────

/**
 * Cada tela/consulta que o menu do visualizador alcança e que RESPONDE COM
 * DADO: 200 exato.
 *
 * Exigir 200 e não "200 ou 404" (15/10/2026): o Fastify responde 404 a rota
 * DESCONHECIDA antes de qualquer preHandler, então `[200, 404]` dava verde
 * para linha desta lista apontando para rota que não existe mais. Alguém
 * renomeia `/orders/excluidos`, esquece o papel no `requireRole` novo, e o
 * teste segue dizendo "o visualizador lê os excluídos" — exatamente o 403 no
 * menu que este arquivo existe para impedir. As que pedem um id vão na lista
 * de baixo, onde o 404 é conferido pelo CORPO.
 */
const LEITURAS: Array<[string, string]> = [
  ['catálogo', '/products'],
  ['catálogo em outra tabela (consulta)', '/products?price_table_id=tabela-2'],
  ['tabelas de preço do seletor', '/catalog/price-tables'],
  ['régua da carteira (as cores do cliente)', '/company/carteira'],
  ['clientes de todas as carteiras', '/customers'],
  ['fila de cadastros para o Control', '/customers/alteracoes-pendentes'],
  ['pedidos de todos os representantes', '/orders'],
  ['pedidos excluídos (040)', '/orders/excluidos'],
  ['canais da empresa (048)', '/orders/canais'],
  ['último número lançado no Control', '/orders/ultimo-numero-erp'],
  ['motivos de cancelamento (053)', '/orders/motivos-de-cancelamento'],
  ['condições de pagamento', '/payment-conditions'],
  ['representantes', '/reps'],
  ['tabelas de preço', '/price-tables'],
  ['tabelas que ele pode consultar', '/price-tables/minhas'],
  ['meta de um representante', `/reps/${UUID_QUALQUER}/meta`],
  ['a própria meta (vem vazia)', '/minha-meta'],
  ['tarefas e visitas', '/tarefas'],
  ['logins — quem tem acesso', '/usuarios'],
  ['estado da integração com o Control', '/erp/integracao/status'],
  ['estado do ERP', '/erp/status'],
  ['chave pública dos avisos', '/push/chave-publica'],
];

/**
 * As leituras que pedem um id: no dublê de banco não existe a linha, então a
 * resposta certa é o 404 DA APLICAÇÃO — com `code`, vindo do handler, que só
 * roda depois de o `requireRole` ter aceitado o papel. O 404 do Fastify para
 * rota desconhecida não tem `code`, e é essa a diferença que faz este teste
 * valer alguma coisa.
 */
const LEITURAS_POR_ID: Array<[string, string]> = [
  ['ficha do cliente', `/customers/${UUID_QUALQUER}`],
  ['vínculos do cliente', `/customers/${UUID_QUALQUER}/vinculos`],
  ['detalhe do pedido', `/orders/${UUID_QUALQUER}`],
];

describe('visualizador LÊ', () => {
  it.each(LEITURAS)('%s (%s)', async (_nome, url) => {
    const res = await chamar('GET', url, TOKEN.visualizador);
    expect(res.statusCode, `${url} respondeu ${res.statusCode}`).toBe(200);
  });

  it.each(LEITURAS_POR_ID)('%s (%s) — 404 da aplicação, não do Fastify', async (_nome, url) => {
    const res = await chamar('GET', url, TOKEN.visualizador);
    expect(res.statusCode, `${url} respondeu ${res.statusCode}`).toBe(404);
    expect(
      (res.json() as { code?: string }).code,
      `${url} devolveu o 404 de rota inexistente — a rota mudou de nome?`,
    ).toBe('NOT_FOUND');
  });

  it('rota que não existe responde 404 — é por isso que 404 não vale como "passou"', async () => {
    // A prova do raciocínio acima: o 404 de rota desconhecida sai ANTES de
    // qualquer preHandler (sem papel nenhum consultado) e não traz o corpo de
    // erro da aplicação.
    const res = await chamar('GET', '/rota-que-nunca-existiu', TOKEN.visualizador);
    expect(res.statusCode).toBe(404);
    expect((res.json() as { code?: string }).code).toBeUndefined();
  });

  it('e uma estática renomeada cai no /orders/:id, que também responde 404', async () => {
    // Pior ainda que o 404 do Fastify: `/orders/excluidos` renomeada passa a
    // casar com `GET /orders/:id` e o 404 vem COM `code: NOT_FOUND`, igual ao
    // de um pedido que não existe. Nem o corpo salvaria a lista — por isso as
    // leituras com dado exigem 200 exato, e só as três com :id aceitam 404.
    const res = await chamar('GET', '/orders/excluidos-renomeado', TOKEN.visualizador);
    expect(res.statusCode).toBe(404);
    expect((res.json() as { code?: string }).code).toBe('NOT_FOUND');
  });

  it('recebe o catálogo COM preço e COM estoque — não é comprador', async () => {
    // Era o defeito do financeiro: sem tabela no token, a régua de comprador
    // (`onlyPriced`) devolvia catálogo VAZIO, e aí a tela dele mentia.
    const res = await chamar('GET', '/products', TOKEN.visualizador);
    const { data } = res.json() as {
      data: Array<{ variants: Array<{ available?: number }> }>;
    };
    expect(res.statusCode).toBe(200);
    expect(data.length).toBeGreaterThan(0);
    expect(data[0]!.variants[0]!.available).toBe(6); // 7 − 1 comprometida
  });

  it('recebe TODAS as tabelas em /price-tables/minhas', async () => {
    // Pelo ramo do representante a lista sairia vazia (ele não tem conjunto) e
    // o seletor de tabela do catálogo desapareceria da tela.
    const res = await chamar('GET', '/price-tables/minhas', TOKEN.visualizador);
    const { data } = res.json() as { data: Array<{ id: string }> };
    expect(res.statusCode).toBe(200);
    expect(data.map((t) => t.id)).toContain('tabela-2');
  });

  it('continua precisando de token', async () => {
    const res = await app.inject({ method: 'GET', url: '/usuarios' });
    expect(res.statusCode).toBe(401);
  });
});

/**
 * A fila "Cadastros alterados para atualizar no Control": a MESMA lista de
 * papéis na rota e nas telas (`PAPEIS_QUE_VEEM_A_FILA_DO_CONTROL`, no shared).
 *
 * Eram listas separadas, escritas à mão, e foi assim que em 15/10/2026 a rota
 * passou a aceitar o visualizador sem que nenhuma tela dele mostrasse a fila.
 */
describe('a fila do Control: rota e shared não discordam', () => {
  const tokenDe = (papel: string) =>
    assinar({ ...base, sub: `${papel}-1`, role: papel, price_table_id: null });

  it.each([...PAPEIS_QUE_VEEM_A_FILA_DO_CONTROL])('%s abre a fila', async (papel) => {
    const res = await chamar('GET', '/customers/alteracoes-pendentes', tokenDe(papel));
    expect(res.statusCode, `${papel} respondeu ${res.statusCode}`).toBe(200);
  });

  it.each(['rep', 'relacionamento', 'store'])('%s não abre a fila', async (papel) => {
    // Rep e relacionamento LEEM clientes; a fila da empresa é outra conversa.
    const res = await chamar('GET', '/customers/alteracoes-pendentes', tokenDe(papel));
    expect(res.statusCode, `${papel} respondeu ${res.statusCode}`).toBe(403);
  });
});

// ─── Escrita: nada ───────────────────────────────────────────────────────────

/** As principais rotas que gravam, uma por assunto do pedido do Yan. */
const ESCRITAS: Array<[string, 'POST' | 'PATCH' | 'PUT' | 'DELETE', string, unknown]> = [
  // Pedido: criar, decidir, apagar, faturar, mexer nas peças, lançar no ERP
  ['criar pedido', 'POST', '/orders', { items: [] }],
  ['aprovar/recusar pedido', 'PATCH', `/orders/${UUID_QUALQUER}/status`, { status: 'approved' }],
  ['excluir pedido', 'DELETE', `/orders/${UUID_QUALQUER}`, undefined],
  ['faturar', 'PATCH', `/orders/${UUID_QUALQUER}/invoice`, { invoiced: true }],
  ['editar peças', 'PATCH', `/orders/${UUID_QUALQUER}/items`, { items: [] }],
  ['dar desconto', 'PATCH', `/orders/${UUID_QUALQUER}/desconto`, { discount: 0.1 }],
  ['cancelar pedido', 'PATCH', `/orders/${UUID_QUALQUER}/cancelar`, { motivo_id: 'x' }],
  ['trocar o cliente do pedido', 'PATCH', `/orders/${UUID_QUALQUER}/cliente`, { customer_id: 'x' }],
  ['corrigir o número do Control', 'PATCH', `/orders/${UUID_QUALQUER}/numero-erp`, { erp_order_id: '9' }],
  ['pedir lançamento no Control', 'PATCH', `/orders/${UUID_QUALQUER}/solicitar-erp`, {}],
  ['avisar o ERP da edição', 'PATCH', `/orders/${UUID_QUALQUER}/erp-sync`, { acao: 'pedir' }],
  ['criar motivo de cancelamento', 'POST', '/orders/motivos-de-cancelamento', { nome: 'x' }],

  // Cliente: cadastrar, editar, atrelar, varejo, perdido, tabela, excluir
  ['cadastrar cliente', 'POST', '/customers', { name: 'Loja Nova' }],
  ['editar o cadastro do cliente', 'PATCH', `/customers/${UUID_QUALQUER}/cadastro`, { name: 'X' }],
  ['trocar a tabela do cliente', 'PATCH', `/customers/${UUID_QUALQUER}`, { price_table_id: 'x' }],
  ['atrelar o código do Control', 'PATCH', `/customers/${UUID_QUALQUER}/codigo-erp`, { erp_id: '1' }],
  ['marcar varejo', 'PATCH', `/customers/${UUID_QUALQUER}/varejo`, { varejo: true }],
  ['marcar cliente perdido', 'PATCH', `/customers/${UUID_QUALQUER}/inativo`, { inativo: true }],
  ['informar o motivo da inatividade', 'PATCH', `/customers/${UUID_QUALQUER}/inatividade`, { motivo: 'x' }],
  ['dar baixa na fila do Control', 'POST', `/customers/${UUID_QUALQUER}/alteracoes/confirmar`, { ids: [] }],
  ['excluir/juntar cliente', 'POST', `/customers/${UUID_QUALQUER}/excluir`, { fica: 'x' }],

  // Logins: "nao pode mudar logins e etc.."
  ['criar login', 'POST', '/usuarios', { name: 'N', email: 'n@x.com', password: '123456', role: 'manager' }],
  ['editar/bloquear login', 'PATCH', `/usuarios/${UUID_QUALQUER}`, { active: false }],
  ['excluir login', 'DELETE', `/usuarios/${UUID_QUALQUER}`, undefined],

  // Representantes
  ['cadastrar representante', 'POST', '/reps', { name: 'R' }],
  ['editar representante', 'PATCH', `/reps/${UUID_QUALQUER}`, { name: 'R' }],
  ['excluir representante', 'DELETE', `/reps/${UUID_QUALQUER}`, undefined],
  ['definir meta', 'PUT', `/reps/${UUID_QUALQUER}/meta`, { faixas: [] }],

  // Catálogo e fotos
  ['importar planilha de produtos', 'POST', '/products/import', { rows: [] }],
  ['subir foto de produto', 'POST', '/products/fotos?sku=0001', {}],

  // Tarefas
  ['criar tarefa/visita', 'POST', '/tarefas', { rep_id: 'x', titulo: 'Visitar' }],
  ['dar OK na tarefa', 'PATCH', `/tarefas/${UUID_QUALQUER}`, { status: 'feita' }],
  ['excluir tarefa', 'DELETE', `/tarefas/${UUID_QUALQUER}`, undefined],

  // Configurações da empresa e integração
  ['mudar a régua da carteira', 'PATCH', '/company/carteira', { atencao: 90, esfriado: 180 }],
  ['pedir sincronização agora', 'PATCH', '/erp/integracao/sincronizar', {}],
  ['puxar tudo do ERP', 'POST', '/erp/sync/full', {}],
  ['puxar estoque do ERP', 'POST', '/erp/sync/stock', {}],
  ['subir a fila offline', 'POST', '/sync', { orders: [] }],

  // Acessos de loja
  ['gerar convite de loja', 'POST', '/invites', { customer_id: 'x' }],
  ['gerar link de vitrine', 'POST', '/showcase-links', { hours: 24 }],
  ['revogar convite', 'DELETE', `/invites/${UUID_QUALQUER}`, undefined],

  // Avisos no celular: regra 4 — o papel não assina nem recebe
  ['assinar avisos no celular', 'POST', '/push/assinar', { endpoint: 'https://x', keys: {} }],
  ['desassinar avisos', 'POST', '/push/desassinar', { endpoint: 'https://x' }],
  ['disparar aviso de teste', 'POST', '/push/teste', {}],
  ['mandar aviso para todos', 'POST', '/push/enviar', { titulo: 'T', corpo: 'C' }],

  // Relatório de IA: POST que só lê, mas POST. Fica fora do papel de propósito
  // — ver o comentário em ia/ia.router.ts.
  ['gerar relatório de IA', 'POST', '/ia/relatorio-carteira', {}],
];

describe('visualizador NÃO ESCREVE', () => {
  it.each(ESCRITAS)('%s (%s %s)', async (_nome, metodo, url, corpo) => {
    const res = await chamar(metodo, url, TOKEN.visualizador, corpo);
    expect(res.statusCode, `${metodo} ${url} respondeu ${res.statusCode}`).toBe(403);
  });

  it('a recusa vem no formato de erro do sistema', async () => {
    const res = await chamar('POST', '/customers', TOKEN.visualizador, { name: 'Loja Nova' });
    expect(res.json()).toEqual({
      error: 'Acesso negado para este papel',
      code: 'FORBIDDEN',
      statusCode: 403,
    });
  });

  it('e não chegou a gravar nada: a recusa é no preHandler', async () => {
    // 403 no preHandler significa que o handler nem rodou — nenhuma linha
    // tentada no banco. Se um dia a recusa virar 200 com "não fez nada", este
    // teste continua pegando, porque 200 não é 403.
    const res = await chamar('POST', '/orders', TOKEN.visualizador, { items: [] });
    expect(res.statusCode).toBe(403);
  });
});

// ─── Escrita: o barrido COMPLETO, dirigido pelos routers ─────────────────────

/**
 * Todas as rotas de escrita que têm guarda de papel, descobertas lendo os
 * routers (tests/inventarioDeRotas.ts), batidas uma por uma com o token de
 * visualizador. 403 em cada.
 *
 * É esta a prova forte do pedido do Yan — "nao altera nada". O inventário
 * irmão lê o TEXTO dos routers, e texto se escreve de muitas formas: lista
 * literal, constante, spread, aspas duplas. Qualquer forma que o leitor não
 * entendesse era verde silencioso (foi o furo de 15/10/2026, com
 * `requireRole([...PAPEIS_QUE_LEEM_O_ESCRITORIO])` passando como lista
 * vazia). Aqui não se lê nada: PERGUNTA-SE À APLICAÇÃO. Rota nova de escrita
 * entra no barrido sozinha, no dia em que for registrada.
 */
const QUANTAS_ESCRITAS_COM_GUARDA = 51;

/** `/customers/:id/varejo` → `/customers/<uuid>/varejo`. */
const comParametros = (caminho: string) =>
  caminho.replace(/:[A-Za-z_]+/g, (p) => (p === ':token' ? 'token-de-teste' : UUID_QUALQUER));

describe('visualizador NÃO ESCREVE — barrido em todas as rotas de escrita', () => {
  it('o barrido não encurtou nem ficou vazio', () => {
    // Sem esta âncora, um erro no leitor de routers esvaziaria a lista e o
    // barrido passaria sem bater em rota nenhuma.
    expect(
      ESCRITAS_COM_GUARDA.length,
      'mudou a quantidade de rotas de escrita com guarda: confira a rota nova e ajuste o número',
    ).toBe(QUANTAS_ESCRITAS_COM_GUARDA);
  });

  it.each(
    ESCRITAS_COM_GUARDA.map((r) => [`${r.metodo} ${r.caminho}`, r.metodo, r.caminho] as const),
  )('%s → 403', async (_nome, metodo, caminho) => {
    const url = comParametros(caminho);
    const res = await chamar(
      metodo as 'POST' | 'PATCH' | 'PUT' | 'DELETE',
      url,
      TOKEN.visualizador,
      metodo === 'DELETE' ? undefined : {},
    );
    expect(
      res.statusCode,
      `${metodo} ${url} respondeu ${res.statusCode} — toda escrita recusa o visualizador`,
    ).toBe(403);
  });

  it('e a mesma rota continua aberta para quem trabalha (o admin cria login)', async () => {
    // O contraponto: o barrido acima não está "403 para todo mundo" por causa
    // de alguma guarda nova que trancou a fábrica inteira.
    const res = await chamar('POST', '/usuarios', TOKEN.admin, {
      name: 'Conferência',
      email: 'conferencia@csb.com',
      password: 'senha-de-teste',
      role: 'manager',
    });
    expect(res.statusCode).not.toBe(403);
  });
});

// ─── Os papéis de hoje não podem perder nada ────────────────────────────────

// ─── O admin consegue criar o login ──────────────────────────────────────────

describe('o admin cria o login visualizador', () => {
  it('a API aceita o papel e grava role=visualizador', async () => {
    // Era a armadilha mais fácil de errar: a lista de papéis que o admin pode
    // criar estava escrita à mão em `criarUsuario` e em `atualizarUsuario`, e
    // sem o papel nas DUAS a resposta era `papel_invalido` — o login do pedido
    // do Yan simplesmente não nascia.
    const res = await chamar('POST', '/usuarios', TOKEN.admin, {
      name: 'Olheiro',
      email: 'olheiro@csb.com',
      password: 'senha-de-teste',
      role: 'visualizador',
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ data: { role: 'visualizador' } });

    const gravado = fake.ultimaGravacao('users', 'insert') as
      | { valores: { role?: string } }
      | undefined;
    expect(gravado?.valores.role).toBe('visualizador');
  });

  it('e um papel inventado continua recusado', async () => {
    const res = await chamar('POST', '/usuarios', TOKEN.admin, {
      name: 'X',
      email: 'x2@csb.com',
      password: 'senha-de-teste',
      role: 'dono-do-mundo',
    });
    expect(res.statusCode).toBe(400);
  });

  it('o visualizador NÃO cria login nenhum — nem o dele', async () => {
    const res = await chamar('POST', '/usuarios', TOKEN.visualizador, {
      name: 'Outro',
      email: 'outro@csb.com',
      password: 'senha-de-teste',
      role: 'visualizador',
    });
    expect(res.statusCode).toBe(403);
  });
});

// ─── O banco ainda sem a 054 ─────────────────────────────────────────────────

describe('antes de rodar a 054, a tela DIZ que falta o SQL', () => {
  beforeAll(() => {
    bancoSemA054 = true;
  });
  afterAll(() => {
    bancoSemA054 = false;
  });

  it('criar o login responde 503 MIGRACAO_PENDENTE, não 500 genérico', async () => {
    // Era um 500 {"error":"Não foi possível concluir a operação.","code":"ERRO"}
    // e o motivo só no log do Railway. O admin não tinha como saber que o que
    // falta é colar _tools/SQL-PARA-RODAR-054.sql nos dois bancos.
    const res = await chamar('POST', '/usuarios', TOKEN.admin, {
      name: 'Olheiro',
      email: 'olheiro2@csb.com',
      password: 'senha-de-teste',
      role: 'visualizador',
    });

    expect(res.statusCode).toBe(503);
    const corpo = res.json() as { error: string; code: string; statusCode: number };
    expect(corpo.code).toBe('MIGRACAO_PENDENTE');
    expect(corpo.statusCode).toBe(503);
    // A frase tem de dizer O QUE FAZER — é a diferença entre esta mensagem e
    // "Não foi possível concluir a operação".
    expect(corpo.error).toContain('054');
    expect(corpo.error).toMatch(/Visualizador/);
  });

  it('e trocar o papel de um login existente também', async () => {
    const res = await chamar('PATCH', `/usuarios/${UUID_QUALQUER}`, TOKEN.admin, {
      role: 'visualizador',
    });
    expect(res.statusCode).toBe(503);
    expect((res.json() as { code: string }).code).toBe('MIGRACAO_PENDENTE');
  });

  it('erro de banco que NÃO é o CHECK do papel continua 500', async () => {
    // A tradução é do 23514 em `role`, não de qualquer falha: um 500 virando
    // "rode a migração" mandaria o Yan colar SQL por causa de outra coisa.
    const res = await chamar('DELETE', `/usuarios/${UUID_QUALQUER}`, TOKEN.admin);
    expect(res.statusCode).not.toBe(503);
  });
});

describe('nada foi tirado de quem já trabalhava', () => {
  it('o representante continua criando pedido (POST /orders ganhou requireRole)', async () => {
    const res = await chamar('POST', '/orders', TOKEN.rep, { items: [] });
    expect(res.statusCode).not.toBe(403);
  });

  it('o representante continua ativando os avisos no celular', async () => {
    const res = await chamar('POST', '/push/assinar', TOKEN.rep, {
      endpoint: 'https://exemplo',
      keys: { p256dh: 'a', auth: 'b' },
    });
    expect(res.statusCode).not.toBe(403);
  });

  it('o admin continua mandando no que é dele', async () => {
    for (const url of ['/usuarios', '/orders/excluidos', `/customers/${UUID_QUALQUER}/vinculos`]) {
      const res = await chamar('GET', url, TOKEN.admin);
      expect([200, 404], `${url} respondeu ${res.statusCode} para o admin`).toContain(
        res.statusCode,
      );
    }
  });
});
