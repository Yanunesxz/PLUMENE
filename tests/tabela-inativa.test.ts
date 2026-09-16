import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { criarSupabaseFake, type RespostaTabela } from './supabaseFake.js';
import {
  MARCA_DE_TABELA_INATIVA,
  podeTrocarTabelaDoCliente,
  rotuloDaTabela,
  tabelaEstaAtiva,
  tabelaInativaNoConjunto,
  tabelasEscolhiveis,
} from '@csb/shared';

/**
 * Tabela de preço desligada no Control (migração 049, `price_tables.active`).
 *
 * O que estes testes trancam — as duas metades da regra:
 *  • tabela inativa SOME de toda escolha: a lista da empresa, o conjunto do
 *    representante, o seletor do catálogo, o cadastro e a troca de tabela do
 *    cliente (o servidor recusa pedir uma inativa, não só a tela);
 *  • quem JÁ está nela continua nela: o catálogo abre na tabela inativa do
 *    cliente (senão a tela mostraria um preço e o servidor cobraria outro), a
 *    tabela da loja continua sendo a do cadastro, e as listas pedidas com
 *    `incluir_inativas` trazem a tabela com `active: false` para a tela marcar;
 *  • sem a 049 (coluna ausente, 42703) tudo é a lista de hoje.
 *
 * Dados fictícios de propósito.
 */

const EMPRESA = 'empresa-teste';
const REP = 'rep-teste';
const SUPABASE = '../apps/api/src/config/supabase.js';
const REPS = '../apps/api/src/modules/reps/reps.service.js';
const CATALOGO = '../apps/api/src/modules/catalog/catalog.service.js';

/** O dublê adianta uma resposta a cada consulta: esta ocupa o espaço entre duas. */
const ENCHIMENTO: RespostaTabela = { data: null, error: null };
const SEM_COLUNA: RespostaTabela = {
  data: null,
  error: { code: '42703', message: 'column price_tables.active does not exist' },
};

/** Banco com a 049: a TABELA 02 foi desligada no Control. */
const COM_049 = [
  { id: 't1', name: 'TABELA 01 - TESTE', company_id: EMPRESA, active: true },
  { id: 't2', name: 'TABELA 02 - TESTE', company_id: EMPRESA, active: false },
  { id: 't3', name: 'TABELA 03 - TESTE', company_id: EMPRESA, active: true },
];

/** Banco sem a 049: a coluna não existe e as linhas não trazem `active`. */
const SEM_049 = [
  { id: 't1', name: 'TABELA 01 - TESTE', company_id: EMPRESA },
  { id: 't2', name: 'TABELA 02 - TESTE', company_id: EMPRESA },
  { id: 't3', name: 'TABELA 03 - TESTE', company_id: EMPRESA },
];

type Fake = ReturnType<typeof criarSupabaseFake>;
type Linha = Record<string, unknown>;

/**
 * O dublê não filtra nada: devolve o que foi registrado. Para `price_tables`
 * este envelope aplica os `.eq()` de verdade sobre as linhas — assim o teste
 * confere o RESULTADO (a tabela 2 sumiu), não só que o filtro foi pedido.
 */
function filtrarPorEq(fake: Fake, tabela: string): void {
  const cliente = fake.cliente as unknown as { from: (t: string) => Record<string, unknown> };
  const fromOriginal = cliente.from.bind(cliente);
  cliente.from = (t: string) => {
    const query = fromOriginal(t);
    if (t !== tabela) return query;

    const iguais: Array<[string, unknown]> = [];
    const eqOriginal = query['eq'] as (...args: unknown[]) => unknown;
    query['eq'] = (coluna: string, valor: unknown) => {
      iguais.push([coluna, valor]);
      eqOriginal(coluna, valor);
      return query;
    };

    const filtrar = (r: RespostaTabela): RespostaTabela =>
      Array.isArray(r.data)
        ? { ...r, data: (r.data as Linha[]).filter((l) => iguais.every(([c, v]) => l[c] === v)) }
        : r;

    const thenOriginal = query['then'] as (
      ok: (v: RespostaTabela) => unknown,
      falha?: (e: unknown) => unknown,
    ) => Promise<unknown>;
    query['then'] = (ok: (v: RespostaTabela) => unknown, falha?: (e: unknown) => unknown) =>
      thenOriginal((r) => ok(filtrar(r)), falha);
    // `maybeSingle` consome a resposta do mesmo jeito que o `then`.
    const um = () =>
      new Promise((resolver) => {
        void thenOriginal((r) => {
          const f = filtrar(r);
          resolver({ ...f, data: Array.isArray(f.data) ? (f.data[0] ?? null) : f.data });
        });
      });
    query['maybeSingle'] = um;
    query['single'] = um;
    return query;
  };
}

async function carregar<T>(
  modulo: string,
  respostas: Record<string, RespostaTabela | RespostaTabela[]>,
) {
  const fake = criarSupabaseFake(respostas);
  filtrarPorEq(fake, 'price_tables');
  vi.doMock(SUPABASE, () => ({ supabase: fake.cliente }));
  const mod = (await import(modulo)) as T;
  return { mod, fake };
}

type RepsService = typeof import('../apps/api/src/modules/reps/reps.service.js');
type CatalogoService = typeof import('../apps/api/src/modules/catalog/catalog.service.js');

/** O conjunto do rep (018 aplicada) semeado em `rep_price_tables`. */
const conjunto = (ids: string[]): RespostaTabela => ({
  data: ids.map((price_table_id) => ({ user_id: REP, price_table_id })),
  error: null,
});

/** `price_tables` sem a 049: a sonda da coluna responde 42703, a lista vem depois. */
const semColuna = (): RespostaTabela[] => [SEM_COLUNA, ENCHIMENTO, { data: SEM_049, error: null }];

const idsDe = (tabelas: Array<{ id: string }>) => tabelas.map((t) => t.id);

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock(SUPABASE);
});

// ─── Funções puras ───────────────────────────────────────────────────────────

describe('funções puras da tabela inativa (@csb/shared)', () => {
  it('só `active: false` desliga — ausente ou nulo (banco sem a 049) conta como ativa', () => {
    expect(tabelaEstaAtiva({ active: false })).toBe(false);
    expect(tabelaEstaAtiva({ active: true })).toBe(true);
    expect(tabelaEstaAtiva({ active: null })).toBe(true);
    expect(tabelaEstaAtiva({})).toBe(true);
  });

  it('a escolha tira só as desligadas e mantém a ordem', () => {
    expect(idsDe(tabelasEscolhiveis(COM_049))).toEqual(['t1', 't3']);
    expect(idsDe(tabelasEscolhiveis(SEM_049))).toEqual(['t1', 't2', 't3']);
  });

  it('o rótulo marca a inativa e deixa a ativa com o nome puro', () => {
    expect(MARCA_DE_TABELA_INATIVA).toBe('(inativa no Control)');
    expect(rotuloDaTabela(COM_049[1]!)).toBe('TABELA 02 - TESTE (inativa no Control)');
    expect(rotuloDaTabela(COM_049[0]!)).toBe('TABELA 01 - TESTE');
    expect(rotuloDaTabela(SEM_049[1]!)).toBe('TABELA 02 - TESTE');
  });

  it('tabelaInativaNoConjunto: só a desligada do conjunto — sem id, de fora ou sem a 049, não', () => {
    expect(tabelaInativaNoConjunto(COM_049, 't2')).toBe(true);
    expect(tabelaInativaNoConjunto(COM_049, 't1')).toBe(false);
    expect(tabelaInativaNoConjunto(COM_049, 'de-outra-regiao')).toBe(false);
    expect(tabelaInativaNoConjunto(COM_049, null)).toBe(false);
    expect(tabelaInativaNoConjunto(SEM_049, 't2')).toBe(false);
  });

  it('podeTrocarTabelaDoCliente: duas ativas sempre; uma ativa só tira o cliente da desligada (revisão de 16/09)', () => {
    // Rep com t1 ativa e t2 desligada: o cliente em t2 pode passar para t1…
    const umaAtivaUmaDesligada = [COM_049[0]!, COM_049[1]!];
    expect(podeTrocarTabelaDoCliente(umaAtivaUmaDesligada, 't2')).toBe(true);
    // …o cliente em t1 (ativa) não tem para onde ir…
    expect(podeTrocarTabelaDoCliente(umaAtivaUmaDesligada, 't1')).toBe(false);
    // …nem o sem tabela, nem o de tabela de fora do conjunto (seguem as regras de antes).
    expect(podeTrocarTabelaDoCliente(umaAtivaUmaDesligada, null)).toBe(false);
    expect(podeTrocarTabelaDoCliente(umaAtivaUmaDesligada, 'de-outra-regiao')).toBe(false);
    // Só a desligada, nenhuma ativa: não há para onde trocar.
    expect(podeTrocarTabelaDoCliente([COM_049[1]!], 't2')).toBe(false);
    // Duas ou mais ativas: como sempre foi.
    expect(podeTrocarTabelaDoCliente(COM_049, 't1')).toBe(true);
    expect(podeTrocarTabelaDoCliente(SEM_049, null)).toBe(true);
    // Uma tabela só, sem a 049: nada muda (sem escolha).
    expect(podeTrocarTabelaDoCliente([SEM_049[0]!], 't1')).toBe(false);
  });
});

describe('a tela usa as regras da tabela desligada', () => {
  const ler = (arquivo: string) => readFileSync(path.resolve(__dirname, '..', arquivo), 'utf8');

  it('o novo pedido confirma a tabela desligada do cliente mesmo para quem tem uma ativa só', () => {
    const tela = ler('apps/web/src/modules/pedidos/PaginaNovoPedido.tsx');
    expect(tela).toMatch(/!precisaEscolher && !tabelaInativaNoConjunto\(todasAsTabelas, doCliente\)/);
  });

  it('a ficha do cliente mostra "Trocar" por podeTrocarTabelaDoCliente, e o diálogo aceita uma ativa', () => {
    expect(ler('apps/web/src/modules/clientes/PaginaCliente.tsx')).toMatch(
      /podeTrocarTabelaDoCliente\(todasAsTabelas, cliente\.price_table_id\)/,
    );
    expect(ler('apps/web/src/modules/clientes/TrocarTabelaDoCliente.tsx')).toMatch(/\baceitaUma\b/);
    expect(ler('apps/web/src/components/comercial/SeletorDeTabela.tsx')).toMatch(/aceitaUma \? 1 : 2/);
  });
});

// ─── Listas de escolha ───────────────────────────────────────────────────────

describe('listPriceTables — as tabelas da empresa', () => {
  it('com a 049, a tabela desligada no Control some da lista', async () => {
    const { mod, fake } = await carregar<RepsService>(REPS, {
      price_tables: { data: COM_049, error: null },
    });

    const tabelas = await mod.listPriceTables(EMPRESA);

    expect(idsDe(tabelas)).toEqual(['t1', 't3']);
    const eqs = fake.filtrosDe('price_tables', 'eq').map((f) => f.args);
    expect(eqs).toContainEqual(['company_id', EMPRESA]);
    expect(eqs).toContainEqual(['active', true]);
  });

  it('sem a 049 (coluna ausente), a lista é a de hoje — sem filtro que derrubaria a consulta', async () => {
    const { mod, fake } = await carregar<RepsService>(REPS, { price_tables: semColuna() });

    const tabelas = await mod.listPriceTables(EMPRESA);

    expect(idsDe(tabelas)).toEqual(['t1', 't2', 't3']);
    const colunas = fake.filtrosDe('price_tables', 'eq').map((f) => f.args[0]);
    expect(colunas).not.toContain('active');
    expect(fake.filtrosDe('price_tables', 'eq').map((f) => f.args)).toContainEqual([
      'company_id',
      EMPRESA,
    ]);
  });

  it('com `incluirInativas`, devolve todas com `active` — e nem sonda a coluna', async () => {
    const { mod, fake } = await carregar<RepsService>(REPS, {
      price_tables: { data: COM_049, error: null },
    });

    const tabelas = await mod.listPriceTables(EMPRESA, { incluirInativas: true });

    expect(idsDe(tabelas)).toEqual(['t1', 't2', 't3']);
    expect(tabelas.find((t) => t.id === 't2')!.active).toBe(false);
    // Uma consulta só (a lista), sem a sonda `select(...).limit(1)`.
    expect(fake.filtrosDe('price_tables', 'limit')).toHaveLength(0);
    expect(fake.filtrosDe('price_tables', 'eq').map((f) => f.args[0])).not.toContain('active');
  });
});

describe('listCompanyPriceTables — o seletor de consulta do catálogo', () => {
  it('com a 049, a desligada some', async () => {
    const { mod, fake } = await carregar<CatalogoService>(CATALOGO, {
      price_tables: { data: COM_049, error: null },
    });

    expect(idsDe(await mod.listCompanyPriceTables(EMPRESA))).toEqual(['t1', 't3']);
    expect(fake.filtrosDe('price_tables', 'eq').map((f) => f.args)).toContainEqual([
      'active',
      true,
    ]);
  });

  it('sem a 049, a lista de hoje', async () => {
    const { mod, fake } = await carregar<CatalogoService>(CATALOGO, { price_tables: semColuna() });

    expect(idsDe(await mod.listCompanyPriceTables(EMPRESA))).toEqual(['t1', 't2', 't3']);
    expect(fake.filtrosDe('price_tables', 'eq').map((f) => f.args[0])).not.toContain('active');
  });
});

describe('o conjunto do representante', () => {
  it('a desligada sai do conjunto que ele escolhe, e volta marcada quando pedida com as inativas', async () => {
    const { mod } = await carregar<RepsService>(REPS, {
      price_tables: { data: COM_049, error: null },
      rep_price_tables: conjunto(['t1', 't2']),
    });

    expect(idsDe(await mod.listRepPriceTables(EMPRESA, REP))).toEqual(['t1']);

    const todas = await mod.listRepPriceTables(EMPRESA, REP, { incluirInativas: true });
    expect(idsDe(todas)).toEqual(['t1', 't2']);
    expect(todas.find((t) => t.id === 't2')!.active).toBe(false);
  });

  it('as inativas pedidas continuam sendo só as DELE — a t3 da região vizinha não aparece', async () => {
    const { mod } = await carregar<RepsService>(REPS, {
      price_tables: { data: COM_049, error: null },
      rep_price_tables: conjunto(['t2']),
    });

    expect(idsDe(await mod.listRepPriceTables(EMPRESA, REP, { incluirInativas: true }))).toEqual([
      't2',
    ]);
  });

  it('sem a 018, a tabela única desligada some da escolha mas continua reconhecida', async () => {
    const { mod } = await carregar<RepsService>(REPS, {
      price_tables: { data: COM_049, error: null },
      rep_price_tables: {
        data: null,
        error: { code: '42P01', message: 'relation does not exist' },
      },
      users: { data: { price_table_id: 't2' }, error: null },
    });

    expect(await mod.listRepPriceTables(EMPRESA, REP)).toEqual([]);
    expect(idsDe(await mod.listRepPriceTables(EMPRESA, REP, { incluirInativas: true }))).toEqual([
      't2',
    ]);
  });

  it('sem a 049, o conjunto é o de hoje', async () => {
    const { mod } = await carregar<RepsService>(REPS, {
      price_tables: semColuna(),
      rep_price_tables: conjunto(['t1', 't2']),
    });

    expect(idsDe(await mod.listRepPriceTables(EMPRESA, REP))).toEqual(['t1', 't2']);
  });
});

// ─── Escolha nova: o servidor também recusa ─────────────────────────────────

describe('resolverTabelaEscolhida — cadastro e troca de tabela do cliente', () => {
  it('rep com duas tabelas, uma desligada, não é obrigado a escolher: fica com a ativa', async () => {
    const { mod } = await carregar<RepsService>(REPS, {
      price_tables: { data: COM_049, error: null },
      rep_price_tables: conjunto(['t1', 't2']),
    });

    expect(await mod.resolverTabelaEscolhida(EMPRESA, REP, 'rep', undefined)).toEqual({
      ok: true,
      price_table_id: 't1',
    });
  });

  it('rep pedindo a tabela desligada pela API é barrado, mesmo ela sendo do conjunto dele', async () => {
    const { mod } = await carregar<RepsService>(REPS, {
      price_tables: { data: COM_049, error: null },
      rep_price_tables: conjunto(['t1', 't2']),
    });

    expect(await mod.resolverTabelaEscolhida(EMPRESA, REP, 'rep', 't2')).toEqual({
      ok: false,
      motivo: 'fora_do_conjunto',
    });
    expect(await mod.resolverTabelaEscolhida(EMPRESA, REP, 'rep', 't1')).toEqual({
      ok: true,
      price_table_id: 't1',
    });
  });

  it('gerente não atribui tabela desligada — e continua atribuindo as ativas da empresa', async () => {
    const { mod, fake } = await carregar<RepsService>(REPS, {
      price_tables: { data: COM_049, error: null },
    });

    expect(await mod.resolverTabelaEscolhida(EMPRESA, 'ger-teste', 'manager', 't2')).toEqual({
      ok: false,
      motivo: 'fora_do_conjunto',
    });
    expect(await mod.resolverTabelaEscolhida(EMPRESA, 'adm-teste', 'admin', 't3')).toEqual({
      ok: true,
      price_table_id: 't3',
    });
    expect(fake.filtrosDe('price_tables', 'eq').map((f) => f.args)).toContainEqual([
      'company_id',
      EMPRESA,
    ]);
  });

  it('sem a 049, nada muda: duas tabelas pedem escolha e o gerente atribui qualquer uma', async () => {
    const rep = await carregar<RepsService>(REPS, {
      price_tables: semColuna(),
      rep_price_tables: conjunto(['t1', 't2']),
    });
    expect(await rep.mod.resolverTabelaEscolhida(EMPRESA, REP, 'rep', undefined)).toEqual({
      ok: false,
      motivo: 'escolha_obrigatoria',
    });

    vi.resetModules();
    const gerente = await carregar<RepsService>(REPS, { price_tables: semColuna() });
    expect(
      await gerente.mod.resolverTabelaEscolhida(EMPRESA, 'ger-teste', 'manager', 't2'),
    ).toEqual({
      ok: true,
      price_table_id: 't2',
    });
  });
});

// ─── Quem já está na tabela inativa continua nela ───────────────────────────

describe('tabela inativa que já está no cliente ou no pedido continua valendo', () => {
  it('o rep abre o catálogo na tabela desligada do conjunto dele — é o preço do pedido do cliente', async () => {
    const { mod } = await carregar<RepsService>(REPS, {
      price_tables: { data: COM_049, error: null },
      rep_price_tables: conjunto(['t1', 't2']),
    });

    expect(await mod.repPodeUsarTabela(EMPRESA, REP, 't2')).toBe(true);
    // A trava da região vizinha continua de pé.
    expect(await mod.repPodeUsarTabela(EMPRESA, REP, 't3')).toBe(false);
  });

  it('a tabela da loja é a do cadastro, mesmo desligada — nem consulta price_tables', async () => {
    const fake = criarSupabaseFake({
      customers: { data: { price_table_id: 't2' }, error: null },
      price_tables: { data: COM_049, error: null },
    });
    vi.doMock(SUPABASE, () => ({ supabase: fake.cliente }));
    const { tabelaDaLoja } = await import('../apps/api/src/modules/catalog/catalog.controller.js');

    expect(await tabelaDaLoja('cliente-teste', REP)).toBe('t2');
    expect(fake.filtrosDe('price_tables')).toHaveLength(0);
  });

  it('GET /products?price_table_id=<inativa> do rep responde com os preços dela, sem 403', async () => {
    const fake = criarSupabaseFake({
      price_tables: { data: COM_049, error: null },
      rep_price_tables: conjunto(['t1', 't2']),
      products: {
        data: [{ id: 'p-teste', sku: '9001', name: 'PECA TESTE', active: true, image_url: null }],
        error: null,
      },
      product_variants: { data: [], error: null },
      product_colors: { data: [], error: null },
      product_prices: { data: [{ product_id: 'p-teste', price: 42 }], error: null },
    });
    filtrarPorEq(fake, 'price_tables');
    vi.doMock(SUPABASE, () => ({ supabase: fake.cliente }));
    const { listProducts } = await import('../apps/api/src/modules/catalog/catalog.controller.js');

    let status = 200;
    let corpo: unknown;
    const reply = {
      status(codigo: number) {
        status = codigo;
        return reply;
      },
      async send(c: unknown) {
        corpo = c;
        return reply;
      },
    };
    const request = {
      user: { company_id: EMPRESA, sub: REP, role: 'rep', price_table_id: 't1' },
      query: { price_table_id: 't2' },
    };

    await listProducts(request as unknown as FastifyRequest, reply as unknown as FastifyReply);

    expect(status).toBe(200);
    expect(fake.filtrosDe('product_prices', 'eq').map((f) => f.args)).toContainEqual([
      'price_table_id',
      't2',
    ]);
    const { data } = corpo as { data: Array<{ id: string; price: number | null }> };
    expect(data.map((p) => [p.id, p.price])).toEqual([['p-teste', 42]]);
  });

  it('criar e editar pedido não consultam price_tables: a tabela gravada no pedido não depende de estar ativa', () => {
    const fonte = readFileSync(
      path.resolve(__dirname, '../apps/api/src/modules/orders/orders.service.ts'),
      'utf-8',
    );
    expect(fonte).not.toContain("from('price_tables')");
  });
});

// ─── As rotas ────────────────────────────────────────────────────────────────

describe('GET /price-tables e /price-tables/minhas', () => {
  async function chamar(
    handler: 'minhasPriceTablesHandler' | 'listPriceTablesHandler',
    user: Record<string, unknown>,
    query: Record<string, string>,
  ) {
    const fake = criarSupabaseFake({
      price_tables: { data: COM_049, error: null },
      rep_price_tables: conjunto(['t1', 't2']),
    });
    filtrarPorEq(fake, 'price_tables');
    vi.doMock(SUPABASE, () => ({ supabase: fake.cliente }));
    const controller = await import('../apps/api/src/modules/reps/reps.controller.js');

    let corpo: unknown;
    const reply = {
      status: () => reply,
      async send(c: unknown) {
        corpo = c;
        return reply;
      },
    };
    await controller[handler](
      { user: { company_id: EMPRESA, ...user }, query } as unknown as FastifyRequest,
      reply as unknown as FastifyReply,
    );
    return (corpo as { data: Array<{ id: string; active?: boolean }> }).data;
  }

  it('o app antigo (sem o parâmetro) recebe só as ativas', async () => {
    expect(idsDe(await chamar('minhasPriceTablesHandler', { sub: REP, role: 'rep' }, {}))).toEqual([
      't1',
    ]);
  });

  it('com incluir_inativas=1 o rep recebe o conjunto inteiro, a desligada com active false', async () => {
    const data = await chamar(
      'minhasPriceTablesHandler',
      { sub: REP, role: 'rep' },
      { incluir_inativas: '1' },
    );
    expect(data).toEqual([
      expect.objectContaining({ id: 't1', active: true }),
      expect.objectContaining({ id: 't2', active: false }),
    ]);
  });

  it('gerente com incluir_inativas=true recebe todas as da empresa', async () => {
    const data = await chamar(
      'listPriceTablesHandler',
      { sub: 'ger-teste', role: 'manager' },
      { incluir_inativas: 'true' },
    );
    expect(idsDe(data)).toEqual(['t1', 't2', 't3']);
  });

  it('parâmetro com outro valor não abre as inativas', async () => {
    const data = await chamar(
      'listPriceTablesHandler',
      { sub: 'ger-teste', role: 'manager' },
      { incluir_inativas: 'sim' },
    );
    expect(idsDe(data)).toEqual(['t1', 't3']);
  });
});
