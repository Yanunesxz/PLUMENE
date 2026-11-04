import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { criarSupabaseFake } from './supabaseFake.js';

/**
 * O papel SAC (056) batendo na aplicação de verdade, via `app.inject` — sem
 * abrir porta e sem encostar no Supabase.
 *
 * Pedido do Yan (04/11/2026): "cria um login pra SAC por favor, no SAC vai
 * poder criar pedido, ver todos os clientes, e vai ver criar cliente". São as
 * três metades deste arquivo:
 *
 *   • O que ele LÊ responde 200 (ou o 404 da aplicação quando pede um id);
 *     o que não é dele — representantes, logins, painel, fila do Control —
 *     responde 403 na rota.
 *   • O que ele GRAVA: montar pedido, mandar o PRÓPRIO rascunho para a
 *     fábrica, cadastrar cliente. O resto das escritas responde 403.
 *   • Os fluxos de ponta a ponta: o pedido nasce em nome dele, rascunho, sem
 *     desconto e na tabela do cliente; a lista dele é só a dele; a carteira
 *     que ele lê é a inteira; o cliente que ele cadastra fica com a tabela
 *     que ele escolheu.
 *
 * As regras puras (menu, cancelamento, o que ele não decide) estão em
 * tests/sac-shared.test.ts.
 */

const EMPRESA = 'empresa-1';
const SEGREDO = 'segredo-de-teste-nao-usar-em-producao'; // igual ao tests/setup.ts
const UUID_QUALQUER = '00000000-0000-0000-0000-000000000000';
const TABELA = 'tabela-1';

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

/**
 * O SAC como o login dele nasce: SEM tabela de preço própria. É o detalhe que
 * derrubava o catálogo do financeiro (régua de comprador → catálogo vazio) e
 * que faz o preço do pedido dele vir do cadastro do cliente.
 */
const TOKEN_SAC = assinar({
  sub: 'sac-1',
  email: 'sac@csb.com',
  company_id: EMPRESA,
  name: 'ATENDIMENTO',
  role: 'sac',
  price_table_id: null,
});

const MODULO_SUPABASE = '../apps/api/src/config/supabase.js';

// ─── A aplicação com o banco "parado": o barrido de guardas ──────────────────

let app: FastifyInstance;

beforeAll(async () => {
  const fake = criarSupabaseFake({
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
    users: { data: [], error: null, count: 0 },
    tarefas: { data: [], error: null },
    payment_conditions: { data: [], error: null },
    cancelamento_motivos: { data: [], error: null },
    companies: { data: { id: EMPRESA }, error: null },
    rep_goals: { data: [], error: null },
  });
  vi.doMock(MODULO_SUPABASE, () => ({ supabase: fake.cliente }));

  const { buildApp } = await import('../apps/api/src/app.js');
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  vi.doUnmock(MODULO_SUPABASE);
});

type Metodo = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

const chamar = (
  alvo: FastifyInstance,
  method: Metodo,
  url: string,
  token: string,
  payload?: unknown,
) =>
  alvo.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}` },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

/** As telas dele — e o que elas consultam. 200 exato, pelo mesmo motivo do visualizador-rotas. */
const LEITURAS: Array<[string, string]> = [
  ['catálogo', '/products'],
  ['catálogo na tabela do cliente (reprecificar o carrinho)', '/products?price_table_id=tabela-2'],
  ['clientes de todas as carteiras', '/customers'],
  ['os pedidos dele', '/orders'],
  ['canais da empresa (a lista de pedidos pergunta)', '/orders/canais'],
  ['condições de pagamento', '/payment-conditions'],
  ['tabelas para o cadastro de cliente', '/price-tables/minhas'],
  ['motivos de cancelamento (para cancelar o próprio)', '/orders/motivos-de-cancelamento'],
  ['chave pública dos avisos', '/push/chave-publica'],
];

const LEITURAS_POR_ID: Array<[string, string]> = [
  ['ficha do cliente', `/customers/${UUID_QUALQUER}`],
  ['detalhe do pedido', `/orders/${UUID_QUALQUER}`],
];

/** O que NÃO é dele, nem para ler. */
const LEITURAS_NEGADAS: Array<[string, string]> = [
  ['representantes', '/reps'],
  ['tabelas de preço (tela de representantes)', '/price-tables'],
  ['logins', '/usuarios'],
  ['pedidos excluídos', '/orders/excluidos'],
  ['último número do Control', '/orders/ultimo-numero-erp'],
  ['fila de cadastros para o Control', '/customers/alteracoes-pendentes'],
  ['vínculos do cliente (é da exclusão)', `/customers/${UUID_QUALQUER}/vinculos`],
  ['tarefas e visitas', '/tarefas'],
  ['metas da equipe', '/reps/metas'],
  ['a própria meta — ele não tem', '/minha-meta'],
  ['estado da integração com o Control', '/erp/integracao/status'],
  ['estado do ERP', '/erp/status'],
  ['tabelas para trocar a do pedido', '/orders/tabelas-para-trocar'],
];

describe('SAC LÊ', () => {
  it.each(LEITURAS)('%s (%s)', async (_nome, url) => {
    const res = await chamar(app, 'GET', url, TOKEN_SAC);
    expect(res.statusCode, `${url} respondeu ${res.statusCode}`).toBe(200);
  });

  it.each(LEITURAS_POR_ID)('%s (%s) — 404 da aplicação, não do Fastify', async (_nome, url) => {
    const res = await chamar(app, 'GET', url, TOKEN_SAC);
    expect(res.statusCode, `${url} respondeu ${res.statusCode}`).toBe(404);
    expect((res.json() as { code?: string }).code).toBe('NOT_FOUND');
  });

  it('recebe o catálogo COM preço — não é comprador', async () => {
    // Sem tabela no token, a régua de comprador (`onlyPriced`) devolvia
    // catálogo VAZIO ao financeiro. O SAC entra na régua da fábrica.
    const res = await chamar(app, 'GET', '/products', TOKEN_SAC);
    const { data } = res.json() as { data: Array<{ id: string }> };
    expect(res.statusCode).toBe(200);
    expect(data.length).toBeGreaterThan(0);
  });

  it('recebe TODAS as tabelas em /price-tables/minhas — é o seletor do cadastro', async () => {
    // Pelo ramo do representante a lista sairia vazia (ele não tem conjunto)
    // e o cadastro de cliente nasceria sem tabela.
    const res = await chamar(app, 'GET', '/price-tables/minhas', TOKEN_SAC);
    const { data } = res.json() as { data: Array<{ id: string }> };
    expect(res.statusCode).toBe(200);
    expect(data.map((t) => t.id)).toContain('tabela-2');
  });
});

describe('SAC NÃO LÊ o que não é dele', () => {
  it.each(LEITURAS_NEGADAS)('%s (%s): 403', async (_nome, url) => {
    const res = await chamar(app, 'GET', url, TOKEN_SAC);
    expect(res.statusCode, `${url} respondeu ${res.statusCode}`).toBe(403);
  });
});

// ─── Escrita: o que passa pela guarda de papel ───────────────────────────────

/**
 * As escritas DELE. O banco deste app está vazio, então a resposta é 400
 * (corpo inválido) ou 404 (pedido que não existe) — nunca 403: o `requireRole`
 * aceitou o papel e o handler rodou. Os fluxos de verdade estão mais abaixo.
 */
const ESCRITAS_DELE: Array<[string, Metodo, string, unknown]> = [
  ['montar pedido', 'POST', '/orders', { items: [] }],
  ['mandar o rascunho para a fábrica', 'PATCH', `/orders/${UUID_QUALQUER}/status`, { status: 'pending_approval' }],
  ['excluir o próprio rascunho', 'DELETE', `/orders/${UUID_QUALQUER}`, undefined],
  ['editar as peças', 'PATCH', `/orders/${UUID_QUALQUER}/items`, { items: [] }],
  ['trocar a condição de pagamento', 'PATCH', `/orders/${UUID_QUALQUER}/pagamento`, {}],
  ['editar a observação', 'PATCH', `/orders/${UUID_QUALQUER}/observacao`, { notes: 'x' }],
  ['cancelar o próprio pedido', 'PATCH', `/orders/${UUID_QUALQUER}/cancelar`, { reason_id: UUID_QUALQUER }],
  ['cadastrar cliente', 'POST', '/customers', {}],
  ['subir a fila offline', 'POST', '/sync', { orders: [] }],
  ['assinar avisos no celular', 'POST', '/push/assinar', {}],
  ['desassinar avisos', 'POST', '/push/desassinar', {}],
];

describe('SAC ESCREVE o que é dele — a guarda de papel deixa passar', () => {
  it.each(ESCRITAS_DELE)('%s (%s %s)', async (_nome, metodo, url, corpo) => {
    const res = await chamar(app, metodo, url, TOKEN_SAC, corpo);
    expect(res.statusCode, `${metodo} ${url} respondeu ${res.statusCode}`).not.toBe(403);
  });

  it('desconto NÃO: a % é do representante', async () => {
    // Passa pela guarda da rota (é a mesma de editar peças), e é o handler
    // que recusa — com a frase certa, não o "Acesso negado" genérico.
    const res = await chamar(app, 'PATCH', `/orders/${UUID_QUALQUER}/desconto`, TOKEN_SAC, {
      desconto: 10,
    });
    expect(res.statusCode).toBe(403);
    const corpo = res.json() as { code: string; error: string };
    expect(corpo.code).toBe('FORBIDDEN_ROLE');
    expect(corpo.error).toMatch(/desconto/i);
  });
});

// ─── Escrita: o que NÃO é dele ───────────────────────────────────────────────

const ESCRITAS_NEGADAS: Array<[string, Metodo, string, unknown]> = [
  // Pedido: decidir, faturar, lançar, trocar cliente/tabela, inativar
  ['faturar', 'PATCH', `/orders/${UUID_QUALQUER}/invoice`, { invoiced: true }],
  ['inativar pedido', 'PATCH', `/orders/${UUID_QUALQUER}/inativo`, { inactive: true }],
  ['trocar o cliente do pedido', 'PATCH', `/orders/${UUID_QUALQUER}/cliente`, { customer_id: 'x' }],
  ['trocar a tabela do pedido', 'PATCH', `/orders/${UUID_QUALQUER}/tabela`, { price_table_id: 'x' }],
  ['corrigir o número do Control', 'PATCH', `/orders/${UUID_QUALQUER}/numero-erp`, { erp_order_id: '9' }],
  ['pedir lançamento no Control', 'PATCH', `/orders/${UUID_QUALQUER}/solicitar-erp`, {}],
  ['cancelar a solicitação ao Control', 'PATCH', `/orders/${UUID_QUALQUER}/cancelar-solicitacao`, {}],
  ['avisar o ERP da edição', 'PATCH', `/orders/${UUID_QUALQUER}/erp-sync`, { acao: 'pedir' }],
  ['criar motivo de cancelamento', 'POST', '/orders/motivos-de-cancelamento', { nome: 'x' }],

  // Cliente: tudo menos cadastrar
  ['editar o cadastro do cliente', 'PATCH', `/customers/${UUID_QUALQUER}/cadastro`, { name: 'X' }],
  ['trocar a tabela do cliente', 'PATCH', `/customers/${UUID_QUALQUER}`, { price_table_id: 'x' }],
  ['atrelar o código do Control', 'PATCH', `/customers/${UUID_QUALQUER}/codigo-erp`, { erp_id: '1' }],
  ['marcar varejo', 'PATCH', `/customers/${UUID_QUALQUER}/varejo`, { varejo: true }],
  ['marcar cliente perdido', 'PATCH', `/customers/${UUID_QUALQUER}/inativo`, { inativo: true }],
  ['informar o motivo da inatividade', 'PATCH', `/customers/${UUID_QUALQUER}/inatividade`, { motivo: 'x' }],
  ['dar baixa na fila do Control', 'POST', `/customers/${UUID_QUALQUER}/alteracoes/confirmar`, { ids: [] }],
  ['excluir/juntar cliente', 'POST', `/customers/${UUID_QUALQUER}/excluir`, { fica: 'x' }],

  // Logins, representantes, catálogo, tarefas, empresa, acessos, avisos em massa, IA
  ['criar login', 'POST', '/usuarios', { name: 'N', email: 'n@x.com', password: '123456', role: 'manager' }],
  ['editar login', 'PATCH', `/usuarios/${UUID_QUALQUER}`, { active: false }],
  ['excluir login', 'DELETE', `/usuarios/${UUID_QUALQUER}`, undefined],
  ['cadastrar representante', 'POST', '/reps', { name: 'R' }],
  ['editar representante', 'PATCH', `/reps/${UUID_QUALQUER}`, { name: 'R' }],
  ['excluir representante', 'DELETE', `/reps/${UUID_QUALQUER}`, undefined],
  ['definir meta', 'PUT', `/reps/${UUID_QUALQUER}/meta`, { faixas: [] }],
  ['importar planilha de produtos', 'POST', '/products/import', { rows: [] }],
  ['subir foto de produto', 'POST', '/products/fotos?sku=0001', {}],
  ['criar tarefa/visita', 'POST', '/tarefas', { rep_id: 'x', titulo: 'Visitar' }],
  ['dar OK na tarefa', 'PATCH', `/tarefas/${UUID_QUALQUER}`, { status: 'feita' }],
  ['excluir tarefa', 'DELETE', `/tarefas/${UUID_QUALQUER}`, undefined],
  ['mudar a régua da carteira', 'PATCH', '/company/carteira', { atencao: 90, esfriado: 180 }],
  ['pedir sincronização agora', 'PATCH', '/erp/integracao/sincronizar', {}],
  ['puxar tudo do ERP', 'POST', '/erp/sync/full', {}],
  ['puxar estoque do ERP', 'POST', '/erp/sync/stock', {}],
  ['gerar convite de loja', 'POST', '/invites', { customer_id: 'x' }],
  ['gerar link de vitrine', 'POST', '/showcase-links', { hours: 24 }],
  ['mandar aviso para todos', 'POST', '/push/enviar', { titulo: 'T', corpo: 'C' }],
  ['gerar relatório de IA', 'POST', '/ia/relatorio-carteira', {}],
];

describe('SAC NÃO ESCREVE o que não é dele', () => {
  it.each(ESCRITAS_NEGADAS)('%s (%s %s)', async (_nome, metodo, url, corpo) => {
    const res = await chamar(app, metodo, url, TOKEN_SAC, corpo);
    expect(res.statusCode, `${metodo} ${url} respondeu ${res.statusCode}`).toBe(403);
  });

  it('a recusa vem no formato de erro do sistema', async () => {
    const res = await chamar(app, 'PATCH', `/orders/${UUID_QUALQUER}/invoice`, TOKEN_SAC, {
      invoiced: true,
    });
    expect(res.json()).toEqual({
      error: 'Acesso negado para este papel',
      code: 'FORBIDDEN',
      statusCode: 403,
    });
  });
});

// ─── Os fluxos, de ponta a ponta — cada um com o banco que precisa ───────────

async function subir(respostas: Record<string, unknown>) {
  vi.resetModules();
  const fake = criarSupabaseFake(respostas as never);
  vi.doMock(MODULO_SUPABASE, () => ({ supabase: fake.cliente }));
  const { buildApp } = await import('../apps/api/src/app.js');
  const proprio = await buildApp();
  await proprio.ready();
  return { app: proprio, fake };
}

/** O mesmo banco de tests/enviar-pra-fabrica: o cliente c1 na tabela-1. */
const RESPOSTAS_DO_CREATE = {
  customers: [
    { data: { price_table_id: TABELA }, error: null }, // tabelaDaLoja: a tabela do cadastro
    { data: { id: 'c1', blocked: false }, error: null }, // clienteDoPedido
  ],
  product_prices: [
    { data: [{ price_larger: null }], error: null },
    { data: [{ product_id: 'p1', price: 41.9, price_larger: null }], error: null },
  ],
  product_variants: { data: [{ id: 'v-m', size: 'M' }], error: null },
  orders: [
    { data: { id: 'o1' }, error: null },
    { data: { id: 'o1', items: [] }, error: null },
  ],
  order_items: { data: [], error: null },
};

describe('o pedido do SAC', () => {
  it('nasce rascunho, EM NOME DELE, na tabela do cliente e SEM desconto', async () => {
    const { app: proprio, fake } = await subir(RESPOSTAS_DO_CREATE);
    const res = await chamar(proprio, 'POST', '/orders', TOKEN_SAC, {
      customer_id: 'c1',
      submit: false,
      // A % que ele tentou mandar: o servidor descarta de quem não é rep.
      discount_percent: 15,
      items: [{ product_id: 'p1', variant_id: 'v-m', quantity: 2, unit_price: 1 }],
    });
    await proprio.close();

    expect(res.statusCode, res.body).toBe(201);
    const gravado = fake.ultimaGravacao('orders', 'insert')?.valores as Record<string, unknown>;
    expect(gravado.status).toBe('draft');
    expect(gravado.rep_id).toBe('sac-1');
    expect(gravado.created_by).toBe('sac-1');
    expect(gravado.price_table_id).toBe(TABELA);
    expect('discount_percent' in gravado).toBe(false);
  });

  it('ele manda o PRÓPRIO rascunho para a fábrica', async () => {
    const { app: proprio, fake } = await subir({
      orders: [
        { data: { status: 'draft', rep_id: 'sac-1' }, error: null },
        { data: { id: 'o1', status: 'pending_approval' }, error: null },
      ],
    });
    const res = await chamar(proprio, 'PATCH', '/orders/o1/status', TOKEN_SAC, {
      status: 'pending_approval',
    });
    await proprio.close();

    expect(res.statusCode, res.body).toBe(200);
    const upd = fake.ultimaGravacao('orders', 'update')?.valores as { status: string };
    expect(upd.status).toBe('pending_approval');
  });

  it('o rascunho de OUTRO não é dele', async () => {
    const { app: proprio, fake } = await subir({
      orders: { data: { status: 'draft', rep_id: 'rep-1' }, error: null },
    });
    const res = await chamar(proprio, 'PATCH', '/orders/o1/status', TOKEN_SAC, {
      status: 'pending_approval',
    });
    await proprio.close();

    expect(res.statusCode).toBe(403);
    expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();
  });

  it('e ele não APROVA o próprio pedido na fila — isso é do financeiro', async () => {
    const { app: proprio, fake } = await subir({
      orders: { data: { status: 'pending_approval', rep_id: 'sac-1' }, error: null },
    });
    const res = await chamar(proprio, 'PATCH', '/orders/o1/status', TOKEN_SAC, {
      status: 'approved',
    });
    await proprio.close();

    expect(res.statusCode).toBe(403);
    expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();
  });

  it('a lista dele é SÓ a dele: o service filtra por rep_id', async () => {
    const { app: proprio, fake } = await subir({ orders: { data: [], error: null } });
    const res = await chamar(proprio, 'GET', '/orders', TOKEN_SAC);
    await proprio.close();

    expect(res.statusCode).toBe(200);
    const porDono = fake.filtrosDe('orders', 'eq').filter((f) => f.args[0] === 'rep_id');
    expect(porDono.map((f) => f.args[1])).toEqual(['sac-1']);
  });
});

describe('os clientes do SAC', () => {
  it('a lista é a carteira INTEIRA: nenhum filtro por dono', async () => {
    const { app: proprio, fake } = await subir({ customers: { data: [], error: null } });
    const res = await chamar(proprio, 'GET', '/customers', TOKEN_SAC);
    await proprio.close();

    expect(res.statusCode).toBe(200);
    // O representante entra por `.or('rep_id.eq…,rep_erp_id.eq…')` ou por
    // `.eq('rep_id', …)`; para o SAC não pode haver nem um nem outro.
    expect(fake.filtrosDe('customers', 'or')).toEqual([]);
    expect(fake.filtrosDe('customers', 'eq').filter((f) => f.args[0] === 'rep_id')).toEqual([]);
  });

  const CORPO = {
    name: 'LOJA NOVA LTDA',
    cnpj: '11.222.333/0001-81',
    cep: '36000-000',
    logradouro: 'Rua das Flores',
    numero: '123',
    bairro: 'Centro',
    cidade: 'Juiz de Fora',
    uf: 'MG',
  };

  // O schema do cadastro exige UUID na tabela (o do pedido, não).
  const TABELA_DA_EMPRESA = '11111111-1111-4111-8111-111111111111';
  const TABELA_DE_OUTRA = '22222222-2222-4222-8222-222222222222';

  const LINHA_NOVA = {
    id: 'c-novo',
    name: 'LOJA NOVA LTDA',
    cnpj: '11222333000181',
    price_table_id: TABELA_DA_EMPRESA,
    rep_id: 'sac-1',
    blocked: false,
  };

  it('cadastra cliente novo com a tabela que escolheu — qualquer ativa da empresa', async () => {
    const { app: proprio, fake } = await subir({
      // A tabela escolhida é da empresa e está ativa: `tabelaEscolhivelDaEmpresa`.
      price_tables: { data: { id: TABELA_DA_EMPRESA, active: true }, error: null },
      // Ninguém com o mesmo documento; o INSERT devolve a linha criada.
      customers: (consulta: { operacao: string }) =>
        consulta.operacao === 'insert'
          ? { data: [LINHA_NOVA], error: null }
          : { data: [], error: null },
    });
    const res = await chamar(proprio, 'POST', '/customers', TOKEN_SAC, {
      ...CORPO,
      price_table_id: TABELA_DA_EMPRESA,
    });
    await proprio.close();

    expect(res.statusCode, res.body).toBe(201);
    const gravado = fake.ultimaGravacao('customers', 'insert')?.valores as Record<string, unknown>;
    expect(gravado.rep_id).toBe('sac-1');
    expect(gravado.price_table_id).toBe(TABELA_DA_EMPRESA);
    expect(gravado.cnpj).toBe('11222333000181');
  });

  it('tabela que não é da empresa: 403, nada gravado', async () => {
    const { app: proprio, fake } = await subir({
      price_tables: { data: null, error: null },
      customers: { data: [], error: null },
    });
    const res = await chamar(proprio, 'POST', '/customers', TOKEN_SAC, {
      ...CORPO,
      price_table_id: TABELA_DE_OUTRA,
    });
    await proprio.close();

    expect(res.statusCode).toBe(403);
    expect(fake.ultimaGravacao('customers', 'insert')).toBeUndefined();
  });
});
