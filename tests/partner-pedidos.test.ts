import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { criarSupabaseFake, type RespostaTabela } from './supabaseFake.js';
import { LIMITE_POSTGREST } from '../apps/api/src/lib/paginacao.js';

/**
 * A mão dos PEDIDOS na API de Parceiro — o que o programa do Fábio puxa e o
 * que ele confirma.
 *
 * Até 15/09/2026 este módulo não tinha teste nenhum: a fila, as cinco
 * pendências, a cor sortida e os desfechos do `confirmar` só existiam no
 * código. Estes testes são a rede de segurança do contrato endurecido em
 * 15/09 (brief da integração, §7 passos 4 a 6).
 *
 * O que fica trancado:
 *   1. a fila padrão é approved SEM número do Control e NÃO faturado; `desde`
 *      e `incluir=todos` mudam só o filtro, nunca o formato; a lista vem
 *      inteira (além das 1.000 linhas do PostgREST) e erro sobe, nunca "200
 *      com a lista pela metade";
 *   2. as CINCO pendências têm texto exato, saem deduplicadas, e `importavel`
 *      é "nenhuma pendência";
 *   3. a cor vai SEMPRE como '00001' e a escolha do cliente viaja na
 *      observação do item; a observação do pedido sai sem as linhas de cor;
 *   4. condição de pagamento ausente não é pendência; desconto sai em pontos
 *      percentuais; coluna de migração ausente degrada para null/0 sem quebrar;
 *   5. o `confirmar` checa nesta ordem: formato → existe → já tem número →
 *      status permite → número livre → grava só se ninguém gravou no meio —
 *      e cada desfecho tem o seu código HTTP no controller;
 *   6. (fase 0) a tabela é a DO PEDIDO com a coluna da tabela; o cliente ganha
 *      endereço em pedaços, IE, WhatsApp e e-mail sem mudar nome de campo;
 *   7. (fase 0) o confirmar diz de onde veio o número e deixa o rastro — sem a
 *      048, o UPDATE é o de hoje;
 *   8. (fase 0) sem canal_pedido_erp = 'api', a fila e o confirmar respondem
 *      409 CANAL_FECHADO sem tocar em pedido;
 *   9. (049, decisões de 16/09/2026) a fila é só o que o financeiro SOLICITOU
 *      (`erp_requested_at`), com `solicitado_em` no pedido; sem a 049, a fila
 *      de antes. O cliente ganha `chave` (CNPJ só dígitos) e `novo_no_control`;
 *      "cliente sem código do ERP" deixa de ser pendência e "cliente sem CNPJ"
 *      entra no lugar. `alterado_apos_importacao` compara o pedido de hoje
 *      com a foto do que o Control conhece (046) — nunca updated_at, que a
 *      trigger, o faturamento e a nota regravam. E o GET /status diz
 *      `sincronizar_agora`.
 */

const EMPRESA = 'empresa-1';
const SUPABASE = '../apps/api/src/config/supabase.js';
const ERP_SYNC = '../apps/api/src/modules/orders/erpSync.service.js';
const AUTH = '../apps/api/src/modules/partner/partner.auth.js';
const SERVICO = '../apps/api/src/modules/partner/partner.service.js';
const INTEGRACAO = '../apps/api/src/modules/integracao/integracao.service.js';

const OK: RespostaTabela = { data: [], error: null };
const COLUNA_AUSENTE: RespostaTabela = {
  data: null,
  error: { message: 'column orders.x does not exist', code: '42703' },
};

/**
 * O dublê adianta a próxima resposta a cada consulta: cada `from()` consome uma
 * e cada `await` pré-busca a seguinte. Dobrar cada resposta faz a N-ésima
 * consulta cair na N-ésima resposta, que é o que o teste quer dizer.
 */
const emSequencia = (...respostas: RespostaTabela[]) => respostas.flatMap((r) => [r, r]);

/**
 * A fila de `orders` para a listagem: as SEIS sondas de coluna
 * (order_number, invoiced, payment_condition_id, discount_percent,
 * price_table_id, erp_requested_at da 049) disparam juntas antes de qualquer
 * resposta, depois vêm as páginas. A sonda da 041 é em `customers` e não entra
 * nesta fila. Teste que só diz as cinco de antes ganha a última como OK (a
 * coluna existe).
 */
const TOTAL_DE_SONDAS = 6;
function filaDaListagem(paginas: RespostaTabela[], sondas: RespostaTabela[] = []) {
  const todas = [...sondas, ...Array.from({ length: TOTAL_DE_SONDAS - sondas.length }, () => OK)];
  return [...todas, ...todas, ...emSequencia(...paginas)];
}
/** A sonda que diz "a 049 não rodou" (erp_requested_at ausente), com o resto OK. */
const SEM_049 = [OK, OK, OK, OK, OK, COLUNA_AUSENTE];

const CLIENTE = {
  erp_id: 'C0001',
  cnpj: '12345678000199',
  name: 'LOJA DA ESQUINA LTDA',
  trade_name: 'ESQUINA',
  rep_erp_id: 'R01',
  price_table_id: 't1',
};

const ITEM = {
  quantity: 3,
  unit_price: 50,
  total: 150,
  variant: { erp_sku: '0015|M', size: 'M' },
  product: { erp_id: '0015', sku: '0015' },
};

function pedido(extra: Record<string, unknown> = {}) {
  return {
    id: 'o1',
    order_number: 14627,
    status: 'approved',
    total: 135,
    notes: null,
    created_at: '2026-09-10T10:00:00Z',
    updated_at: '2026-09-10T11:00:00Z',
    erp_order_id: null,
    discount_percent: 10,
    invoiced: false,
    invoiced_at: null,
    invoiced_total: null,
    payment_condition: { code: '021', description: '30/60/90' },
    price_table_erp_code: 'T01',
    price_column: 2,
    customer: CLIENTE,
    items: [ITEM],
    ...extra,
  };
}

async function carregar(respostas: Record<string, RespostaTabela | RespostaTabela[]>) {
  const fake = criarSupabaseFake(respostas as never);
  vi.doMock(SUPABASE, () => ({ supabase: fake.cliente }));
  const registrarNoErp = vi.fn().mockResolvedValue('guardada');
  vi.doMock(ERP_SYNC, () => ({ registrarNoErp }));
  const mod = await import(SERVICO);
  return { ...mod, fake, registrarNoErp };
}

// `vi.resetModules()` já isola: o `import(SERVICO)` de cada teste reavalia
// detectarColuna.js numa instância nova, com a memória de sondas vazia.
beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.doUnmock(SUPABASE);
  vi.doUnmock(ERP_SYNC);
  vi.doUnmock(AUTH);
  vi.doUnmock(INTEGRACAO);
  vi.doUnmock(SERVICO);
});

// ─── A fila ──────────────────────────────────────────────────────────────────

describe('a fila de pedidos para o ERP', () => {
  it('padrão: aprovados sem número do Control e NÃO faturados, só da empresa da chave', async () => {
    const { getPartnerOrders, fake } = await carregar({
      orders: filaDaListagem([{ data: [pedido()], error: null }]),
      price_tables: { data: [], error: null },
    });

    const lista = await getPartnerOrders(EMPRESA, {});

    expect(lista).toHaveLength(1);
    const eqs = fake.filtrosDe('orders', 'eq').map((f) => f.args);
    expect(eqs).toContainEqual(['company_id', EMPRESA]);
    expect(eqs).toContainEqual(['status', 'approved']);
    expect(fake.filtrosDe('orders', 'is').map((f) => f.args)).toContainEqual(['erp_order_id', null]);
    // O carimbo manual de faturado não exige número: sem este filtro, pedido
    // já faturado à mão iria para o Control de novo (19 de 21 na CS em 11/09).
    expect(fake.filtrosDe('orders', 'or').map((f) => f.args)).toEqual([
      ['invoiced.is.null,invoiced.eq.false'],
    ]);
    expect(fake.filtrosDe('orders', 'in')).toHaveLength(0);
  });

  it('sem a coluna invoiced (banco antes da 027) a fila não pede o filtro de faturado', async () => {
    const { getPartnerOrders, fake } = await carregar({
      orders: filaDaListagem([{ data: [pedido({ invoiced: undefined })], error: null }], [OK, COLUNA_AUSENTE, OK, OK, OK]),
      price_tables: { data: [], error: null },
    });

    const [p] = await getPartnerOrders(EMPRESA, {});

    expect(fake.filtrosDe('orders', 'or')).toHaveLength(0);
    expect(p!.faturado).toBe(false);
  });

  it('sonda de invoiced que falha por rede LANÇA — a fila nunca sai sem o filtro de faturado', async () => {
    // Um soluço lido como "coluna não existe" tiraria o `.or('invoiced...')` em
    // silêncio, e a fila entregaria os pedidos faturados à mão (os 19 de 21 da
    // CS) para o Control importar de novo. Aqui é 500, e o ERP tenta depois.
    const { getPartnerOrders, fake } = await carregar({
      orders: filaDaListagem(
        [{ data: [pedido()], error: null }],
        [OK, { data: null, error: { message: 'timeout' } }, OK, OK, OK],
      ),
      price_tables: { data: [], error: null },
    });

    await expect(getPartnerOrders(EMPRESA, {})).rejects.toThrow(/orders\.invoiced/);
    expect(fake.filtrosDe('orders', 'range')).toHaveLength(0);
  });

  it('`desde` filtra por atualizado_em — a "data que eu puxei" do parceiro', async () => {
    const { getPartnerOrders, fake } = await carregar({
      orders: filaDaListagem([{ data: [], error: null }]),
      price_tables: { data: [], error: null },
    });

    await getPartnerOrders(EMPRESA, { desde: '2026-09-01T00:00:00Z' });

    expect(fake.filtrosDe('orders', 'gte').map((f) => f.args)).toContainEqual([
      'updated_at',
      '2026-09-01T00:00:00Z',
    ]);
  });

  it('`incluir=todos` traz aprovados E já enviados, faturados inclusive — a reconciliação', async () => {
    const { getPartnerOrders, fake } = await carregar({
      orders: filaDaListagem([
        { data: [pedido({ status: 'sent_erp', erp_order_id: 'CS17379', invoiced: true })], error: null },
      ]),
      price_tables: { data: [], error: null },
    });

    const lista = await getPartnerOrders(EMPRESA, { incluirImportados: true });

    expect(fake.filtrosDe('orders', 'in').map((f) => f.args)).toContainEqual([
      'status',
      ['approved', 'sent_erp'],
    ]);
    expect(fake.filtrosDe('orders', 'eq').map((f) => f.args)).not.toContainEqual(['status', 'approved']);
    expect(fake.filtrosDe('orders', 'is')).toHaveLength(0);
    expect(fake.filtrosDe('orders', 'or')).toHaveLength(0);
    // O enviado sai com o número que o Control deu — é por ele que o parceiro
    // reconcilia; `importavel` continua dizendo só dos vínculos.
    expect(lista[0]).toMatchObject({ situacao: 'sent_erp', pedido_erp: 'CS17379', faturado: true, importavel: true });
  });

  it('ordena por created_at e desempata por id — o mais antigo é o primeiro, e a página não embaralha', async () => {
    const { getPartnerOrders, fake } = await carregar({
      orders: filaDaListagem([{ data: [], error: null }]),
      price_tables: { data: [], error: null },
    });

    await getPartnerOrders(EMPRESA, {});

    expect(fake.filtrosDe('orders', 'order').map((f) => f.args)).toEqual([
      ['created_at', { ascending: true }],
      ['id', { ascending: true }],
    ]);
  });

  it('passa das 1.000 linhas do PostgREST: página cheia e mais uma, tudo numa lista só', async () => {
    const cheia = Array.from({ length: LIMITE_POSTGREST }, (_, i) => pedido({ id: `o-${i}` }));
    const resto = [pedido({ id: 'o-ultimo' })];
    const { getPartnerOrders, fake } = await carregar({
      orders: filaDaListagem([
        { data: cheia, error: null },
        { data: resto, error: null },
      ]),
      price_tables: { data: [], error: null },
    });

    const lista = await getPartnerOrders(EMPRESA, { incluirImportados: true });

    expect(lista).toHaveLength(LIMITE_POSTGREST + 1);
    expect(lista.at(-1)!.id).toBe('o-ultimo');
    expect(fake.filtrosDe('orders', 'range').map((f) => f.args)).toEqual([
      [0, LIMITE_POSTGREST - 1],
      [LIMITE_POSTGREST, 2 * LIMITE_POSTGREST - 1],
    ]);
    // O builder é montado do zero a cada página: os filtros vão nas duas.
    expect(fake.filtrosDe('orders', 'in')).toHaveLength(2);
  });

  it('erro do banco no meio da listagem sobe — nunca "200 com a lista pela metade"', async () => {
    const cheia = Array.from({ length: LIMITE_POSTGREST }, (_, i) => pedido({ id: `o-${i}` }));
    const { getPartnerOrders } = await carregar({
      orders: filaDaListagem([
        { data: cheia, error: null },
        { data: null, error: { message: 'timeout' } },
      ]),
      price_tables: { data: [], error: null },
    });

    await expect(getPartnerOrders(EMPRESA, {})).rejects.toThrow(/timeout/);
  });

  it('erro ao ler as tabelas de preço também sobe — mapa vazio poria pendência falsa em todo pedido', async () => {
    const { getPartnerOrders } = await carregar({
      orders: filaDaListagem([{ data: [pedido()], error: null }]),
      price_tables: { data: null, error: { message: 'caiu' } },
    });

    await expect(getPartnerOrders(EMPRESA, {})).rejects.toThrow(/caiu/);
  });
});

// ─── A fila solicitada (049) ─────────────────────────────────────────────────

describe('a fila é o que o financeiro SOLICITOU (049)', () => {
  const SOLICITADO = '2026-09-16T13:00:00+00:00';

  it('com a 049: a fila exige erp_requested_at preenchido e o pedido sai com solicitado_em', async () => {
    const { getPartnerOrders, fake } = await carregar({
      orders: filaDaListagem([{ data: [pedido({ erp_requested_at: SOLICITADO })], error: null }]),
      price_tables: { data: [], error: null },
    });

    const [p] = await getPartnerOrders(EMPRESA, {});

    expect(fake.filtrosDe('orders', 'not').map((f) => f.args)).toEqual([['erp_requested_at', 'is', null]]);
    // Os filtros de antes continuam: aprovado, sem número, não faturado.
    expect(fake.filtrosDe('orders', 'eq').map((f) => f.args)).toContainEqual(['status', 'approved']);
    expect(fake.filtrosDe('orders', 'is').map((f) => f.args)).toContainEqual(['erp_order_id', null]);
    expect(fake.filtrosDe('orders', 'or').map((f) => f.args)).toEqual([['invoiced.is.null,invoiced.eq.false']]);
    expect(p!.solicitado_em).toBe(SOLICITADO);
    const selectDaLista = fake
      .filtrosDe('orders', 'select')
      .map((f) => String(f.args[0]))
      .find((s) => s.includes('customer:customers'))!;
    expect(selectDaLista.split('customer:customers')[0]).toContain('erp_requested_at');
  });

  it('sem a 049 (42703 em erp_requested_at): a fila de hoje, sem o filtro, sem a coluna no select, solicitado_em null', async () => {
    const { getPartnerOrders, fake } = await carregar({
      orders: filaDaListagem([{ data: [pedido()], error: null }], SEM_049),
      price_tables: { data: [], error: null },
    });

    const [p] = await getPartnerOrders(EMPRESA, {});

    expect(fake.filtrosDe('orders', 'not')).toHaveLength(0);
    expect(p!.solicitado_em).toBeNull();
    const selectDaLista = fake
      .filtrosDe('orders', 'select')
      .map((f) => String(f.args[0]))
      .find((s) => s.includes('customer:customers'))!;
    expect(selectDaLista).not.toContain('erp_requested_at');
  });

  it('sonda de erp_requested_at que falha por rede LANÇA — a fila nunca entrega o que ninguém pediu', async () => {
    // Lida como "não existe", a fila sairia sem o filtro e o Control importaria
    // pedidos aprovados que o financeiro ainda não mandou lançar.
    const { getPartnerOrders, fake } = await carregar({
      orders: filaDaListagem(
        [{ data: [pedido()], error: null }],
        [OK, OK, OK, OK, OK, { data: null, error: { message: 'timeout' } }],
      ),
      price_tables: { data: [], error: null },
    });

    await expect(getPartnerOrders(EMPRESA, {})).rejects.toThrow(/orders\.erp_requested_at/);
    expect(fake.filtrosDe('orders', 'range')).toHaveLength(0);
  });

  it('`incluir=todos` com a 049: aprovado não solicitado sai com a pendência e NÃO é importável; sem a 049, como antes', async () => {
    const { getPartnerOrders } = await carregar({
      orders: filaDaListagem([
        {
          data: [
            pedido({ id: 'nao-pedido', erp_requested_at: null }),
            pedido({ id: 'pedido', erp_requested_at: SOLICITADO }),
            pedido({ id: 'no-control', status: 'sent_erp', erp_order_id: 'CS17379', erp_requested_at: null }),
          ],
          error: null,
        },
      ]),
      price_tables: { data: [], error: null },
    });

    const lista = await getPartnerOrders(EMPRESA, { incluirImportados: true });

    expect(lista.map((p) => [p.id, p.importavel, p.pendencias])).toEqual([
      ['nao-pedido', false, ['pedido não solicitado pelo financeiro']],
      ['pedido', true, []],
      ['no-control', true, []],
    ]);

    vi.resetModules();
    const sem049 = await carregar({
      orders: filaDaListagem([{ data: [pedido({ id: 'antigo' })], error: null }], SEM_049),
      price_tables: { data: [], error: null },
    });
    const [antigo] = await sem049.getPartnerOrders(EMPRESA, { incluirImportados: true });
    expect(antigo).toMatchObject({ importavel: true, pendencias: [] });
  });

  it('`incluir=todos` não exige solicitação — é a reconciliação, e traz o solicitado_em de cada um', async () => {
    const { getPartnerOrders, fake } = await carregar({
      orders: filaDaListagem([
        {
          data: [
            pedido({ erp_requested_at: null }),
            pedido({ id: 'o2', status: 'sent_erp', erp_order_id: 'CS17379', erp_requested_at: SOLICITADO }),
          ],
          error: null,
        },
      ]),
      price_tables: { data: [], error: null },
    });

    const lista = await getPartnerOrders(EMPRESA, { incluirImportados: true });

    expect(fake.filtrosDe('orders', 'not')).toHaveLength(0);
    expect(lista.map((p) => p.solicitado_em)).toEqual([null, SOLICITADO]);
  });
});

describe('alterado_apos_importacao — o app mexeu depois de o Control conhecer o pedido?', () => {
  /** A peça do pedido com os ids que a comparação usa. */
  const PECA = { ...ITEM, product_id: 'p1', variant_id: 'v1' };
  /** A foto (046) do pedido como o Control o conhece: igual ao `pedido()` com PECA. */
  const foto = (order_id: string, extra: Record<string, unknown> = {}) => ({
    order_id,
    itens: [{ product_id: 'p1', variant_id: 'v1', quantity: 3, unit_price: 50 }],
    desconto: 10,
    condicao: null,
    observacao: null,
    ...extra,
  });
  const importado = (id: string, numero: string, extra: Record<string, unknown> = {}) =>
    pedido({ id, status: 'sent_erp', erp_order_id: numero, items: [PECA], ...extra });

  it('compara com a foto do Control, não com updated_at: igual é false mesmo com updated_at bem depois', async () => {
    // A trigger da 013 grava updated_at com a hora do banco, o faturamento e a
    // nota regravam updated_at: nada disso é "o app mudou o pedido".
    const { getPartnerOrders, fake } = await carregar({
      orders: filaDaListagem([
        {
          data: [
            importado('o1', 'CS17379', { updated_at: '2026-09-16T23:59:00+00:00', erp_order_set_at: '2026-09-16T13:00:00+00:00' }),
            importado('o2', 'CS17380'),
            importado('o3', 'CS17381'),
            importado('o4', 'CS17382', { notes: 'trocar a entrega para sexta' }),
            importado('o5', 'CS17383'),
            pedido({ id: 'o6', erp_requested_at: '2026-09-16T13:00:00Z', items: [PECA] }),
          ],
          error: null,
        },
      ]),
      price_tables: { data: [], error: null },
      order_erp_sync: emSequencia(OK, {
        data: [
          foto('o1'),
          foto('o2', { itens: [{ product_id: 'p1', variant_id: 'v1', quantity: 5, unit_price: 50 }] }),
          foto('o3', { desconto: '5.00' }),
          foto('o4'),
          // o5 não tem foto: lançado antes da 046.
        ],
        error: null,
      }),
    });

    const lista = await getPartnerOrders(EMPRESA, { incluirImportados: true });

    expect(lista.map((p) => [p.id, p.alterado_apos_importacao])).toEqual([
      ['o1', false],
      ['o2', true], // peça
      ['o3', true], // desconto
      ['o4', true], // observação
      ['o5', null], // sem foto
      ['o6', null], // sem número
    ]);
    // Só os pedidos com número, sempre pela empresa, e só o recorte da foto.
    expect(fake.filtrosDe('order_erp_sync', 'in').map((f) => f.args)).toEqual([
      ['order_id', ['o1', 'o2', 'o3', 'o4', 'o5']],
    ]);
    expect(fake.filtrosDe('order_erp_sync', 'eq').map((f) => f.args)).toContainEqual(['company_id', EMPRESA]);
    const selectDaFoto = fake.filtrosDe('order_erp_sync', 'select').map((f) => String(f.args[0])).at(-1)!;
    expect(selectDaFoto).toContain('snapshot->items');
    expect(selectDaFoto).not.toMatch(/snapshot\s*(,|$)/);
    // O pedido de hoje traz o que a comparação usa.
    const selectDaLista = fake
      .filtrosDe('orders', 'select')
      .map((f) => String(f.args[0]))
      .find((s) => s.includes('customer:customers'))!;
    expect(selectDaLista).toContain('payment_condition_id');
    expect(selectDaLista).toContain('order_items(product_id, variant_id, quantity');
    expect(selectDaLista).not.toContain('erp_order_set_at');
  });

  it('na fila não lê foto nenhuma (ninguém tem número); sem a 046, null', async () => {
    const naFila = await carregar({
      orders: filaDaListagem([{ data: [pedido({ erp_requested_at: '2026-09-16T13:00:00Z' })], error: null }]),
      price_tables: { data: [], error: null },
    });
    const [p] = await naFila.getPartnerOrders(EMPRESA, {});
    expect(p!.alterado_apos_importacao).toBeNull();
    expect(naFila.fake.filtrosDe('order_erp_sync')).toHaveLength(0);

    vi.resetModules();
    const sem046 = await carregar({
      orders: filaDaListagem([{ data: [importado('o1', 'CS17379')], error: null }]),
      price_tables: { data: [], error: null },
      order_erp_sync: { data: null, error: { message: 'relation "order_erp_sync" does not exist', code: '42P01' } },
    });
    const [q] = await sem046.getPartnerOrders(EMPRESA, { incluirImportados: true });
    expect(q!.alterado_apos_importacao).toBeNull();
    expect(sem046.fake.filtrosDe('order_erp_sync', 'in')).toHaveLength(0);
  });

  it('erro ao ler as fotos sobe — a reconciliação não sai dizendo "não mudou" pela metade', async () => {
    const { getPartnerOrders } = await carregar({
      orders: filaDaListagem([{ data: [importado('o1', 'CS17379')], error: null }]),
      price_tables: { data: [], error: null },
      order_erp_sync: emSequencia(OK, { data: null, error: { message: 'caiu' } }),
    });

    await expect(getPartnerOrders(EMPRESA, { incluirImportados: true })).rejects.toThrow(/caiu/);
  });
});

// ─── O payload ───────────────────────────────────────────────────────────────

describe('o pedido como o ERP recebe', () => {
  it('pedido com todos os vínculos é importável, sem pendência', async () => {
    const { getPartnerOrders } = await carregar({
      orders: filaDaListagem([{ data: [pedido()], error: null }]),
      price_tables: { data: [], error: null },
    });

    const [p] = await getPartnerOrders(EMPRESA, {});

    expect(p).toMatchObject({
      id: 'o1',
      numero: 14627,
      situacao: 'approved',
      valor_total: 135,
      pedido_erp: null,
      cliente: { codigo_erp: 'C0001', cnpj: '12345678000199', razao_social: 'LOJA DA ESQUINA LTDA', nome_fantasia: 'ESQUINA' },
      representante_erp: 'R01',
      tabela_preco: { codigo_erp: 'T01', coluna: 2 },
      condicao_pagamento: { codigo: '021', descricao: '30/60/90' },
      desconto_percentual: 10,
      faturado: false,
      importavel: true,
      pendencias: [],
    });
    expect(p!.itens).toEqual([
      { produto: '0015', tamanho: 'M', cor: '00001', quantidade: 3, preco_unitario: 50, valor_total: 150, observacao: null },
    ]);
  });

  it('as CINCO pendências têm texto exato e saem deduplicadas', async () => {
    const semVinculo = { ...ITEM, variant: { erp_sku: null, size: null }, product: { erp_id: null, sku: '0099' } };
    const { getPartnerOrders } = await carregar({
      orders: filaDaListagem([
        {
          data: [
            pedido({
              customer: { ...CLIENTE, erp_id: null, rep_erp_id: null, price_table_id: null },
              price_table_erp_code: null,
              // Dois itens sem vínculo → UMA pendência, não duas.
              items: [semVinculo, semVinculo],
            }),
            pedido({ id: 'o2', items: [] }),
          ],
          error: null,
        },
      ]),
      price_tables: { data: [], error: null },
    });

    const [quaseTudo, semItens] = await getPartnerOrders(EMPRESA, {});

    expect(quaseTudo!.importavel).toBe(false);
    // Sem código do ERP NÃO é mais pendência (16/09/2026): o cliente tem CNPJ,
    // o Control cria o cadastro e devolve o código pelo POST /clientes.
    expect(quaseTudo!.pendencias).toEqual([
      'cliente sem representante vinculado no ERP',
      'pedido sem tabela de preço vinculada no ERP',
      'item sem vínculo de produto/tamanho com o ERP',
    ]);
    expect(quaseTudo!.cliente.novo_no_control).toBe(true);
    expect(semItens!.importavel).toBe(false);
    expect(semItens!.pendencias).toEqual(['pedido sem itens']);
  });

  it('cliente sem CNPJ é a pendência que entrou no lugar da de código — não há por onde o Control casar', async () => {
    const { getPartnerOrders } = await carregar({
      orders: filaDaListagem([
        {
          data: [
            pedido({ customer: { ...CLIENTE, cnpj: null } }),
            pedido({ id: 'o2', customer: { ...CLIENTE, cnpj: '   ' } }),
            pedido({ id: 'o3', customer: { ...CLIENTE, cnpj: 'sem numero' } }),
            // Menos de 11 dígitos não é documento: o POST /clientes nunca casaria por ele.
            pedido({ id: 'o4', customer: { ...CLIENTE, cnpj: '123' } }),
            pedido({ id: 'o5', customer: { ...CLIENTE, cnpj: '1234567890' } }),
          ],
          error: null,
        },
      ]),
      price_tables: { data: [], error: null },
    });

    const lista = await getPartnerOrders(EMPRESA, {});

    for (const p of lista) {
      expect(p.importavel).toBe(false);
      expect(p.pendencias).toEqual(['cliente sem CNPJ']);
      expect(p.cliente.chave).toBeNull();
    }
  });

  it('a chave do cliente é o CNPJ só com dígitos, e novo_no_control diz se falta o código do Control', async () => {
    const { getPartnerOrders } = await carregar({
      orders: filaDaListagem([
        {
          data: [
            pedido({ customer: { ...CLIENTE, cnpj: '12.345.678/0001-99' } }),
            pedido({ id: 'o2', customer: { ...CLIENTE, erp_id: null } }),
          ],
          error: null,
        },
      ]),
      price_tables: { data: [], error: null },
    });

    const [comCodigo, semCodigo] = await getPartnerOrders(EMPRESA, {});

    // O CNPJ cru continua saindo como está no cadastro; a chave é só dígitos.
    expect(comCodigo!.cliente).toMatchObject({
      codigo_erp: 'C0001',
      cnpj: '12.345.678/0001-99',
      chave: '12345678000199',
      novo_no_control: false,
    });
    expect(comCodigo!.importavel).toBe(true);
    expect(semCodigo!.cliente).toMatchObject({ codigo_erp: null, chave: '12345678000199', novo_no_control: true });
    expect(semCodigo!.importavel).toBe(true);
    expect(semCodigo!.pendencias).toEqual([]);
  });

  it('a cor é SEMPRE 00001 e a escolha do cliente viaja na observação do item', async () => {
    const { getPartnerOrders } = await carregar({
      orders: filaDaListagem([
        {
          data: [
            pedido({
              notes: 'entregar sexta\n\n0015 3M azul\n0015 2G rosa',
              items: [ITEM, { ...ITEM, variant: { erp_sku: '0015|G', size: 'G' } }],
            }),
          ],
          error: null,
        },
      ]),
      price_tables: { data: [], error: null },
    });

    const [p] = await getPartnerOrders(EMPRESA, {});

    expect(p!.itens.map((i) => i.cor)).toEqual(['00001', '00001']);
    expect(p!.itens.map((i) => i.observacao)).toEqual(['3M azul / 2G rosa', '3M azul / 2G rosa']);
    // Só o que o representante DIGITOU — as linhas de cor já foram por item.
    expect(p!.observacoes).toBe('entregar sexta');
  });

  it('condição de pagamento ausente sai null e NÃO é pendência', async () => {
    const { getPartnerOrders } = await carregar({
      orders: filaDaListagem([{ data: [pedido({ payment_condition: null })], error: null }]),
      price_tables: { data: [], error: null },
    });

    const [p] = await getPartnerOrders(EMPRESA, {});

    expect(p!.condicao_pagamento).toBeNull();
    expect(p!.importavel).toBe(true);
  });

  it('desconto em pontos percentuais; o preço do item é o de tabela e o total já tem o desconto', async () => {
    const { getPartnerOrders } = await carregar({
      orders: filaDaListagem([{ data: [pedido({ discount_percent: '7.50' })], error: null }]),
      price_tables: { data: [], error: null },
    });

    const [p] = await getPartnerOrders(EMPRESA, {});

    expect(p!.desconto_percentual).toBe(7.5);
    expect(p!.itens[0]!.preco_unitario).toBe(50);
    expect(p!.valor_total).toBe(135);
  });

  it('sem a foto da tabela no pedido, usa a tabela do cliente; coluna padrão 1', async () => {
    const { getPartnerOrders, fake } = await carregar({
      orders: filaDaListagem([{ data: [pedido({ price_table_erp_code: null, price_column: null })], error: null }]),
      price_tables: { data: [{ id: 't1', erp_code: 'T02', price_column: null }], error: null },
    });

    const [p] = await getPartnerOrders(EMPRESA, {});

    expect(p!.tabela_preco).toEqual({ codigo_erp: 'T02', coluna: 1 });
    expect(p!.importavel).toBe(true);
    // As tabelas também vêm paginadas e em ordem estável.
    expect(fake.filtrosDe('price_tables', 'range')).toHaveLength(1);
    expect(fake.filtrosDe('price_tables', 'order').map((f) => f.args[0])).toEqual(['id']);
  });

  it('coluna de migração ausente (42703): o campo sai null/0 e a consulta não pede a coluna', async () => {
    const { getPartnerOrders, fake } = await carregar({
      // order_number e invoiced existem; payment_condition_id e discount_percent, não.
      orders: filaDaListagem(
        [{ data: [pedido({ payment_condition: undefined, discount_percent: undefined })], error: null }],
        [OK, OK, COLUNA_AUSENTE, COLUNA_AUSENTE, OK],
      ),
      price_tables: { data: [], error: null },
    });

    const [p] = await getPartnerOrders(EMPRESA, {});

    expect(p!.condicao_pagamento).toBeNull();
    expect(p!.desconto_percentual).toBe(0);
    expect(p!.numero).toBe(14627);
    const selectDaLista = fake
      .filtrosDe('orders', 'select')
      .map((f) => String(f.args[0]))
      .find((s) => s.includes('customer:customers'));
    expect(selectDaLista).toBeDefined();
    expect(selectDaLista).not.toContain('payment_condition');
    expect(selectDaLista).not.toContain('discount_percent');
    expect(selectDaLista).toContain('order_number');
  });
});

// ─── A cor pelo número do catálogo (22/09/2026) ──────────────────────────────

/**
 * Pedido do Yan (22/09/2026): no app a cor aparece pelo nome, "está ótimo";
 * "na hora de subir pro Control tem que ser Cor 1, Cor 2, do jeito que está
 * no catálogo" — o estoque confere pelo número da bolinha. As notas continuam
 * com o nome; o item do feed troca o nome pelo número, pela ficha de cores da
 * peça (product_colors). Sem casamento, o nome, como antes.
 */
describe('a cor vai ao Control pelo número da bolinha do catálogo', () => {
  const ITEM_0015_M = { ...ITEM, product_id: 'p15' };
  const ITEM_0015_G = { ...ITEM, product_id: 'p15', variant: { erp_sku: '0015|G', size: 'G' } };
  const ITEM_0020_P = {
    ...ITEM,
    product_id: 'p20',
    variant: { erp_sku: '0020|P', size: 'P' },
    product: { erp_id: '0020', sku: '0020' },
  };
  const FICHAS = [
    { product_id: 'p15', codigo: '01', nome: 'rosa', variadas: false },
    { product_id: 'p15', codigo: '02', nome: 'azul marinho', variadas: false },
    { product_id: 'p15', codigo: '03', nome: 'pink', variadas: false },
    // A peça cuja única bolinha é a VARIADAS: "Cores variadas" no app.
    { product_id: 'p20', codigo: 'VAR', nome: 'Cores variadas', variadas: true },
  ];

  it('a observação do item sai "Cor N" / "Variadas", várias cores no formato de hoje', async () => {
    const { getPartnerOrders, fake } = await carregar({
      orders: filaDaListagem([
        {
          data: [
            pedido({
              notes: 'entregar sexta\n\n0015 3M pink\n0015 2G Rosa\n0020 1P Cores variadas',
              items: [ITEM_0015_M, ITEM_0015_G, ITEM_0020_P],
            }),
          ],
          error: null,
        },
      ]),
      price_tables: { data: [], error: null },
      product_colors: { data: FICHAS, error: null },
    });

    const [p] = await getPartnerOrders(EMPRESA, {});

    expect(p!.itens.map((i) => i.observacao)).toEqual(['3M Cor 3 / 2G Cor 1', '3M Cor 3 / 2G Cor 1', 'Variadas']);
    expect(p!.itens.map((i) => i.cor)).toEqual(['00001', '00001', '00001']);
    // O recado do rep continua separado, sem as linhas de cor.
    expect(p!.observacoes).toBe('entregar sexta');
    // Uma consulta pelas peças do pedido, da empresa da chave — nunca uma por item.
    expect(fake.filtrosDe('product_colors', 'eq').map((f) => f.args)).toContainEqual(['company_id', EMPRESA]);
    const ins = fake.filtrosDe('product_colors', 'in').map((f) => f.args);
    expect(ins).toEqual([['product_id', ['p15', 'p20']]]);
  });

  it('cor sem casamento na ficha (renomeada depois) e peça sem ficha saem pelo NOME', async () => {
    const { getPartnerOrders } = await carregar({
      orders: filaDaListagem([
        {
          data: [
            pedido({
              notes: '0015 3M verde bandeira\n0020 1P azul',
              items: [ITEM_0015_M, ITEM_0020_P],
            }),
          ],
          error: null,
        },
      ]),
      price_tables: { data: [], error: null },
      // Só a 0015 tem ficha — e nela não existe "verde bandeira".
      product_colors: { data: FICHAS.filter((f) => f.product_id === 'p15'), error: null },
    });

    const [p] = await getPartnerOrders(EMPRESA, {});

    expect(p!.itens.map((i) => i.observacao)).toEqual(['verde bandeira', 'azul']);
  });

  it('banco sem a 019 (sem product_colors): a cor sai pelo nome, como antes', async () => {
    const { getPartnerOrders } = await carregar({
      orders: filaDaListagem([{ data: [pedido({ notes: '0015 3M pink', items: [ITEM_0015_M] })], error: null }]),
      price_tables: { data: [], error: null },
      product_colors: {
        data: null,
        error: { message: "Could not find the table 'public.product_colors' in the schema cache", code: 'PGRST205' },
      },
    });

    const [p] = await getPartnerOrders(EMPRESA, {});

    expect(p!.itens[0]!.observacao).toBe('pink');
  });

  it('pedido sem linha de cor não consulta as fichas', async () => {
    const { getPartnerOrders, fake } = await carregar({
      orders: filaDaListagem([{ data: [pedido({ notes: 'entregar sexta', items: [ITEM_0015_M] })], error: null }]),
      price_tables: { data: [], error: null },
      product_colors: { data: FICHAS, error: null },
    });

    const [p] = await getPartnerOrders(EMPRESA, {});

    expect(p!.itens[0]!.observacao).toBeNull();
    expect(fake.filtrosDe('product_colors')).toHaveLength(0);
  });

  it('erro ao ler as fichas SOBE — o Control nunca grava o nome no lugar do número por um soluço', async () => {
    const { getPartnerOrders } = await carregar({
      orders: filaDaListagem([{ data: [pedido({ notes: '0015 3M pink', items: [ITEM_0015_M] })], error: null }]),
      price_tables: { data: [], error: null },
      // A sonda da tabela responde; a página das fichas cai.
      product_colors: emSequencia({ data: [], error: null }, { data: null, error: { message: 'caiu' } }),
    });

    await expect(getPartnerOrders(EMPRESA, {})).rejects.toThrow(/caiu/);
  });

  it('a linha de cor de peça que SAIU do pedido não vai em observacoes — nem pelo nome, nem numerada', async () => {
    // O "editar peças" da triagem não mexe nas notas: a linha da peça tirada
    // fica lá (no banco da CS, 142 linhas em 4 pedidos, como "1036 3P Cor
    // única" no #14628). Ela ia ao Control com o NOME da cor de uma peça que
    // nem está no pedido.
    const { getPartnerOrders } = await carregar({
      orders: filaDaListagem([
        {
          data: [pedido({ notes: 'ENTREGAR SEXTA\n\n0015 3M pink\n0020 2G azul', items: [ITEM_0015_M] })],
          error: null,
        },
      ]),
      price_tables: { data: [], error: null },
      product_colors: { data: FICHAS, error: null },
    });

    const [p] = await getPartnerOrders(EMPRESA, {});

    expect(p!.itens.map((i) => i.observacao)).toEqual(['Cor 3']);
    expect(p!.observacoes).toBe('ENTREGAR SEXTA');
  });

  it('o recado do rep que cita referência continua em observacoes', async () => {
    const recados = 'Ref. 0848 mandar a cor Marrom no lugar do Rosa Claro 1p 1m 1g 2gg.\n0020 2 peças a mais se tiver';
    const { getPartnerOrders } = await carregar({
      orders: filaDaListagem([
        { data: [pedido({ notes: `${recados}\n\n0015 3M pink`, items: [ITEM_0015_M] })], error: null },
      ]),
      price_tables: { data: [], error: null },
      product_colors: { data: FICHAS, error: null },
    });

    const [p] = await getPartnerOrders(EMPRESA, {});

    expect(p!.observacoes).toBe(recados);
  });

  it('a peça COR ÚNICA sem número (bolinha "VAR" sem o selo VARIADAS) vai "Cor única", não "Cores variadas"', async () => {
    // As 9 peças da CS (0981, 0990, 1007…): o catálogo imprime ÚNICA dentro
    // da bolinha, e o banco as chama "Cores variadas" por um erro do
    // cores.mjs. O estoque não pode ler "variadas" numa peça de uma cor só.
    const ITEM_0990 = {
      ...ITEM,
      product_id: 'p990',
      variant: { erp_sku: '0990|M', size: 'M' },
      product: { erp_id: '0990', sku: '0990' },
    };
    const { getPartnerOrders } = await carregar({
      orders: filaDaListagem([
        { data: [pedido({ notes: '0990 2M Cores variadas', items: [ITEM_0990] })], error: null },
      ]),
      price_tables: { data: [], error: null },
      product_colors: {
        data: [{ product_id: 'p990', codigo: 'VAR', nome: 'Cores variadas', variadas: false }],
        error: null,
      },
    });

    const [p] = await getPartnerOrders(EMPRESA, {});

    expect(p!.itens[0]!.observacao).toBe('Cor única');
  });

  it('passa das 1.000 bolinhas do PostgREST: a ficha da segunda página também vira "Cor N"', async () => {
    // Um lote de 300 peças com 4 a 6 bolinhas passa de 1.000 linhas. Sem o
    // `.range`, a mesma consulta voltaria repetida (ou o laço não acabaria).
    const cheia = Array.from({ length: LIMITE_POSTGREST }, (_, i) => ({
      product_id: `p-outra-${Math.floor(i / 5)}`,
      codigo: String((i % 5) + 1).padStart(2, '0'),
      nome: `cor ${i}`,
      variadas: false,
    }));
    const { getPartnerOrders, fake } = await carregar({
      orders: filaDaListagem([{ data: [pedido({ notes: '0015 3M pink', items: [ITEM_0015_M] })], error: null }]),
      price_tables: { data: [], error: null },
      // A sonda da tabela; a página cheia; a página com a ficha da 0015.
      product_colors: emSequencia(
        { data: [], error: null },
        { data: cheia, error: null },
        { data: FICHAS.filter((f) => f.product_id === 'p15'), error: null },
      ),
    });

    const [p] = await getPartnerOrders(EMPRESA, {});

    expect(p!.itens[0]!.observacao).toBe('Cor 3');
    expect(fake.filtrosDe('product_colors', 'range').map((f) => f.args)).toEqual([
      [0, LIMITE_POSTGREST - 1],
      [LIMITE_POSTGREST, 2 * LIMITE_POSTGREST - 1],
    ]);
  });
});

// ─── Tabela do pedido e cadastro do cliente (fase 0) ─────────────────────────

describe('a tabela de preço é a do PEDIDO, com a coluna da tabela', () => {
  const TABELAS: RespostaTabela = {
    data: [
      { id: 't1', erp_code: 'T01', price_column: 2 },
      { id: 't3', erp_code: '00016', price_column: 3 },
      { id: 't4', erp_code: null, price_column: 4 },
    ],
    error: null,
  };

  it('pedido com price_table_id: sai a tabela do pedido com a coluna dela, não a do cliente nem orders.price_column', async () => {
    const { getPartnerOrders, fake } = await carregar({
      orders: filaDaListagem([
        {
          data: [pedido({ price_table_id: 't3', price_table_erp_code: null, price_column: 1 })],
          error: null,
        },
      ]),
      price_tables: TABELAS,
    });

    const [p] = await getPartnerOrders(EMPRESA, {});

    expect(p!.tabela_preco).toEqual({ codigo_erp: '00016', coluna: 3 });
    expect(p!.importavel).toBe(true);
    const selectDaLista = fake
      .filtrosDe('orders', 'select')
      .map((f) => String(f.args[0]))
      .find((s) => s.includes('customer:customers'));
    expect(selectDaLista!.split('customer:customers')[0]).toContain('price_table_id');
  });

  it('tabela do pedido SEM erp_code é pendência — não cai para a tabela do cliente (preço de outra tabela)', async () => {
    const { getPartnerOrders } = await carregar({
      orders: filaDaListagem([
        { data: [pedido({ price_table_id: 't4', price_table_erp_code: null, price_column: 1 })], error: null },
      ]),
      price_tables: TABELAS,
    });

    const [p] = await getPartnerOrders(EMPRESA, {});

    expect(p!.tabela_preco).toEqual({ codigo_erp: null, coluna: 4 });
    expect(p!.importavel).toBe(false);
    expect(p!.pendencias).toEqual(['pedido sem tabela de preço vinculada no ERP']);
  });

  it('pedido sem tabela: a do cliente, com a price_column DA TABELA (orders.price_column = 1 não manda)', async () => {
    const { getPartnerOrders } = await carregar({
      orders: filaDaListagem([
        {
          data: [
            pedido({
              price_table_id: null,
              price_table_erp_code: null,
              price_column: 1,
              customer: { ...CLIENTE, price_table_id: 't3' },
            }),
          ],
          error: null,
        },
      ]),
      price_tables: TABELAS,
    });

    const [p] = await getPartnerOrders(EMPRESA, {});

    expect(p!.tabela_preco).toEqual({ codigo_erp: '00016', coluna: 3 });
  });

  it('banco sem orders.price_table_id (antes da 025): não pede a coluna e usa a do cliente', async () => {
    const { getPartnerOrders, fake } = await carregar({
      orders: filaDaListagem(
        [{ data: [pedido({ price_table_erp_code: null, price_column: 1 })], error: null }],
        [OK, OK, OK, OK, COLUNA_AUSENTE],
      ),
      price_tables: TABELAS,
    });

    const [p] = await getPartnerOrders(EMPRESA, {});

    expect(p!.tabela_preco).toEqual({ codigo_erp: 'T01', coluna: 2 });
    const selectDaLista = fake
      .filtrosDe('orders', 'select')
      .map((f) => String(f.args[0]))
      .find((s) => s.includes('customer:customers'));
    expect(selectDaLista!.split('customer:customers')[0]).not.toContain('price_table_id');
  });
});

describe('o cliente do pedido ganha endereço em pedaços, IE, WhatsApp e e-mail (aditivo)', () => {
  const CADASTRO_REAL = {
    cep: '00000000',
    logradouro: 'Rua Teste',
    numero: '1',
    complemento: '',
    bairro: 'Bairro Teste',
    cidade: 'Cidade Teste',
    uf: 'SP',
    inscricao_estadual: 'ISENTO',
    whatsapp: '00000000000',
    email: 'cliente.teste@exemplo.invalid',
  };

  it('com a 041: os campos saem do cadastro e os antigos continuam com o mesmo nome', async () => {
    const { getPartnerOrders, fake } = await carregar({
      orders: filaDaListagem([{ data: [pedido({ customer: { ...CLIENTE, ...CADASTRO_REAL } })], error: null }]),
      price_tables: { data: [], error: null },
    });

    const [p] = await getPartnerOrders(EMPRESA, {});

    expect(p!.cliente).toEqual({
      codigo_erp: 'C0001',
      cnpj: '12345678000199',
      chave: '12345678000199',
      novo_no_control: false,
      razao_social: 'LOJA DA ESQUINA LTDA',
      nome_fantasia: 'ESQUINA',
      endereco: {
        cep: '00000000',
        logradouro: 'Rua Teste',
        numero: '1',
        complemento: null, // vazio sai null
        bairro: 'Bairro Teste',
        cidade: 'Cidade Teste',
        uf: 'SP',
      },
      inscricao_estadual: 'ISENTO',
      whatsapp: '00000000000',
      email: 'cliente.teste@exemplo.invalid',
    });
    const embed = fake
      .filtrosDe('orders', 'select')
      .map((f) => String(f.args[0]))
      .find((s) => s.includes('customer:customers'))!;
    expect(embed).toMatch(/customer:customers\([^)]*whatsapp, email, cep, logradouro, numero, complemento, bairro, cidade, uf, inscricao_estadual\)/);
  });

  it('sem a 041 (42703 em customers.cep): não pede as colunas e os campos saem null', async () => {
    const { getPartnerOrders, fake } = await carregar({
      orders: filaDaListagem([{ data: [pedido({ customer: { ...CLIENTE, whatsapp: '00000000000', email: null } })], error: null }]),
      customers: COLUNA_AUSENTE,
      price_tables: { data: [], error: null },
    });

    const [p] = await getPartnerOrders(EMPRESA, {});

    expect(p!.cliente.endereco).toEqual({
      cep: null,
      logradouro: null,
      numero: null,
      complemento: null,
      bairro: null,
      cidade: null,
      uf: null,
    });
    expect(p!.cliente.inscricao_estadual).toBeNull();
    expect(p!.cliente.whatsapp).toBe('00000000000');
    expect(p!.cliente.email).toBeNull();
    const embed = fake
      .filtrosDe('orders', 'select')
      .map((f) => String(f.args[0]))
      .find((s) => s.includes('customer:customers'))!;
    expect(embed).not.toContain('cep');
    expect(embed).not.toContain('inscricao_estadual');
  });
});

// ─── O confirmar ─────────────────────────────────────────────────────────────

const LIDO = (linha: Record<string, unknown> | null): RespostaTabela => ({ data: linha, error: null });
/** Aprovado E solicitado pelo financeiro (049): o que o Control pode confirmar. */
const APROVADO = LIDO({ id: 'o1', status: 'approved', erp_order_id: null, erp_requested_at: '2026-09-16T12:00:00Z' });
/** A sonda de `order_number` que a pré-checagem faz (o dono volta com o número do app). */
const SONDA = OK;
const NUMERO_LIVRE: RespostaTabela = { data: [], error: null };
const NUMERO_DO_O2: RespostaTabela = { data: [{ id: 'o2', order_number: 14600 }], error: null };
/**
 * A sonda de `orders.erp_order_source` (048) que `gravarOrigemDoNumero` faz
 * logo antes do UPDATE. OK = a coluna existe e a origem entra no patch.
 */
const SONDA_ORIGEM = OK;
const GRAVOU: RespostaTabela = { data: [{ id: 'o1', order_number: 14627 }], error: null };

describe('confirmOrderImport — o ERP devolve o número', () => {
  it('grava o número NORMALIZADO, força sent_erp, carimba synced_at/updated_at e tira a foto', async () => {
    const { confirmOrderImport, fake, registrarNoErp } = await carregar({
      orders: emSequencia(APROVADO, SONDA, NUMERO_LIVRE, SONDA_ORIGEM, GRAVOU),
    });

    const r = await confirmOrderImport(EMPRESA, 'o1', ' cs-17379 ');

    expect(r).toEqual({ outcome: 'ok', ja_confirmado: false });
    const gravado = fake.ultimaGravacao('orders', 'update')?.valores as Record<string, unknown>;
    expect(gravado).toMatchObject({ status: 'sent_erp', erp_order_id: 'CS17379' });
    expect(typeof gravado['synced_at']).toBe('string');
    expect(typeof gravado['updated_at']).toBe('string');
    expect(fake.filtrosDe('orders', 'eq').map((f) => f.args)).toContainEqual(['company_id', EMPRESA]);
    // Grava só se ninguém gravou no meio, e pede as linhas afetadas para saber.
    expect(fake.filtrosDe('orders', 'is').map((f) => f.args)).toContainEqual(['erp_order_id', null]);
    // O select do UPDATE devolve a linha gravada com o número do app (para o rastro).
    expect(fake.filtrosDe('orders', 'select').map((f) => f.args[0]).at(-1)).toBe('id, order_number');
    expect(registrarNoErp).toHaveBeenCalledWith('o1', EMPRESA, null);
  });

  it('com a 048: o UPDATE diz de onde veio o número (api) e o rastro ganha numero_gravado com o parceiro', async () => {
    const { confirmOrderImport, fake } = await carregar({
      orders: emSequencia(APROVADO, SONDA, NUMERO_LIVRE, SONDA_ORIGEM, GRAVOU),
    });

    expect(await confirmOrderImport(EMPRESA, 'o1', 'CS17379', 'control-cs')).toEqual({
      outcome: 'ok',
      ja_confirmado: false,
    });

    const gravado = fake.ultimaGravacao('orders', 'update')?.valores as Record<string, unknown>;
    expect(gravado).toMatchObject({ erp_order_source: 'api', erp_order_set_by: null });
    // Um "agora" só na mesma gravação.
    expect(gravado['erp_order_set_at']).toBe(gravado['updated_at']);

    const evento = fake.ultimaGravacao('order_erp_events', 'insert')?.valores as Record<string, unknown>;
    expect(evento).toMatchObject({
      company_id: EMPRESA,
      order_id: 'o1',
      order_number: 14627,
      tipo: 'numero_gravado',
      origem: 'api',
      parceiro: 'control-cs',
      antes: { erp_order_id: null, status: 'approved' },
      depois: { erp_order_id: 'CS17379', status: 'sent_erp' },
    });
  });

  it('sem a 048: o UPDATE é o de hoje, sem as colunas de origem, e a confirmação passa', async () => {
    const { confirmOrderImport, fake } = await carregar({
      orders: emSequencia(APROVADO, SONDA, NUMERO_LIVRE, COLUNA_AUSENTE, GRAVOU),
      order_erp_events: COLUNA_AUSENTE,
    });

    expect(await confirmOrderImport(EMPRESA, 'o1', 'CS17379', 'control-cs')).toEqual({
      outcome: 'ok',
      ja_confirmado: false,
    });

    const gravado = fake.ultimaGravacao('orders', 'update')?.valores as Record<string, unknown>;
    expect(Object.keys(gravado).sort()).toEqual(['erp_order_id', 'status', 'synced_at', 'updated_at']);
    expect(fake.ultimaGravacao('order_erp_events', 'insert')).toBeUndefined();
  });

  it('o rastro que falha ao gravar não muda a resposta da confirmação', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { confirmOrderImport } = await carregar({
      orders: emSequencia(APROVADO, SONDA, NUMERO_LIVRE, SONDA_ORIGEM, GRAVOU),
      order_erp_events: [OK, OK, { data: null, error: { message: 'insert recusado' } }],
    });

    expect(await confirmOrderImport(EMPRESA, 'o1', 'CS17379')).toEqual({ outcome: 'ok', ja_confirmado: false });
    expect(erro).toHaveBeenCalled();
    erro.mockRestore();
  });

  it('número fora da máscara (duas letras + até 10 dígitos) é recusado ANTES de tocar no banco', async () => {
    const { confirmOrderImport, fake } = await carregar({ orders: emSequencia(APROVADO) });

    for (const ruim of ['PED-00123', '17379', 'CS', 'CS123456789012', 'C17379']) {
      expect(await confirmOrderImport(EMPRESA, 'o1', ruim)).toEqual({ outcome: 'invalid_number' });
    }
    expect(fake.filtrosDe('orders')).toHaveLength(0);
  });

  it('pedido que não existe (ou é de outra empresa) é not_found', async () => {
    const { confirmOrderImport, fake } = await carregar({ orders: emSequencia(LIDO(null)) });

    expect(await confirmOrderImport(EMPRESA, 'nao-existe', 'CS17379')).toEqual({ outcome: 'not_found' });
    expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();
  });

  it('erro do banco na leitura LANÇA — timeout não é "o pedido sumiu"', async () => {
    const { confirmOrderImport, fake } = await carregar({
      orders: emSequencia({ data: null, error: { message: 'timeout' } }),
    });

    await expect(confirmOrderImport(EMPRESA, 'o1', 'CS17379')).rejects.toThrow(/timeout/);
    expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();
  });

  it('id sem forma de UUID (22P02) é not_found — não um 500 que o ERP repetiria para sempre', async () => {
    // `orders.id` é uuid: "abc" (ou um id cortado num CHAR(30) do Firebird) faz
    // o Postgres recusar o texto. Isso é "não existe pedido com esse id".
    const { confirmOrderImport, fake } = await carregar({
      orders: emSequencia({
        data: null,
        error: { message: 'invalid input syntax for type uuid: "abc"', code: '22P02' },
      }),
    });

    expect(await confirmOrderImport(EMPRESA, 'abc', 'CS17379')).toEqual({ outcome: 'not_found' });
    expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();
  });

  it('repetir com o MESMO número (em qualquer grafia) é idempotente: ok, sem gravar', async () => {
    const { confirmOrderImport, fake, registrarNoErp } = await carregar({
      orders: emSequencia(LIDO({ id: 'o1', status: 'sent_erp', erp_order_id: 'cs 17379' })),
    });

    expect(await confirmOrderImport(EMPRESA, 'o1', 'CS17379')).toEqual({ outcome: 'ok', ja_confirmado: true });
    expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();
    expect(registrarNoErp).not.toHaveBeenCalled();
  });

  it('número DIFERENTE do já gravado é conflito, com a grafia crua do banco', async () => {
    const { confirmOrderImport, fake } = await carregar({
      orders: emSequencia(LIDO({ id: 'o1', status: 'sent_erp', erp_order_id: 'CS17000' })),
    });

    expect(await confirmOrderImport(EMPRESA, 'o1', 'CS17379')).toEqual({
      outcome: 'conflict',
      pedido_erp_atual: 'CS17000',
    });
    expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();
  });

  it.each([['draft'], ['pending_rep'], ['pending_approval'], ['rejected'], ['sent_erp']])(
    'pedido em %s sem número não pode ser confirmado — o fluxo não deixa ir para sent_erp',
    async (status) => {
      const { confirmOrderImport, fake } = await carregar({
        orders: emSequencia(LIDO({ id: 'o1', status, erp_order_id: null })),
      });

      expect(await confirmOrderImport(EMPRESA, 'o1', 'CS17379')).toEqual({
        outcome: 'not_confirmable',
        situacao: status,
      });
      // Nem conferiu o número, nem gravou.
      expect(fake.filtrosDe('orders', 'neq')).toHaveLength(0);
      expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();
    },
  );

  it('com a 049: aprovado que o financeiro NÃO solicitou é recusado (not_requested), sem conferir número nem gravar', async () => {
    const { confirmOrderImport, fake, registrarNoErp } = await carregar({
      orders: emSequencia(LIDO({ id: 'o1', status: 'approved', erp_order_id: null, erp_requested_at: null }), OK),
    });

    expect(await confirmOrderImport(EMPRESA, 'o1', 'CS17379')).toEqual({ outcome: 'not_requested' });
    expect(fake.filtrosDe('orders', 'neq')).toHaveLength(0);
    expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();
    expect(registrarNoErp).not.toHaveBeenCalled();
    // O select da leitura é `*`: traz erp_requested_at onde a 049 existe.
    expect(fake.filtrosDe('orders', 'select')[0]!.args[0]).toBe('*');
  });

  describe('confirmar depois de o financeiro cancelar a solicitação (o número vence)', () => {
    const NAO_SOLICITADO = LIDO({ id: 'o1', status: 'approved', erp_order_id: null, erp_requested_at: null });

    it.each([
      ['com a 050: o rastro tem solicitacao_cancelada', 'solicitacao_cancelada'],
      ['sem a 050: o cancelamento não deixou evento, mas o pedido tinha solicitado_ao_erp', 'solicitado_ao_erp'],
    ])('%s → grava o número e o rastro diz que chegou depois do cancelamento', async (_nome, tipo) => {
      const { confirmOrderImport, fake, registrarNoErp } = await carregar({
        orders: emSequencia(NAO_SOLICITADO, OK, SONDA, NUMERO_LIVRE, SONDA_ORIGEM, GRAVOU),
        order_erp_events: emSequencia(OK, { data: [{ id: 'ev-1', tipo }], error: null }, OK),
      });

      expect(await confirmOrderImport(EMPRESA, 'o1', 'CS17379', 'control-cs')).toEqual({
        outcome: 'ok',
        ja_confirmado: false,
      });
      expect(fake.ultimaGravacao('orders', 'update')?.valores).toMatchObject({
        status: 'sent_erp',
        erp_order_id: 'CS17379',
      });
      expect(registrarNoErp).toHaveBeenCalledWith('o1', EMPRESA, null);

      // O rastro do pedido é lido pela empresa da chave e só pelos dois tipos da solicitação.
      const eqs = fake.filtrosDe('order_erp_events', 'eq').map((f) => f.args);
      expect(eqs).toContainEqual(['company_id', EMPRESA]);
      expect(eqs).toContainEqual(['order_id', 'o1']);
      expect(fake.filtrosDe('order_erp_events', 'in')[0]!.args).toEqual([
        'tipo',
        ['solicitado_ao_erp', 'solicitacao_cancelada'],
      ]);

      expect(fake.ultimaGravacao('order_erp_events', 'insert')?.valores).toMatchObject({
        tipo: 'numero_gravado',
        origem: 'api',
        parceiro: 'control-cs',
        motivo: 'confirmado pelo Control depois de a solicitação ser cancelada no app',
        depois: { erp_order_id: 'CS17379', status: 'sent_erp' },
      });
    });

    it('nunca solicitado (rastro sem solicitação) continua 409 not_requested, sem gravar', async () => {
      const { confirmOrderImport, fake } = await carregar({
        orders: emSequencia(NAO_SOLICITADO, OK),
        order_erp_events: emSequencia(OK, { data: [], error: null }),
      });

      expect(await confirmOrderImport(EMPRESA, 'o1', 'CS17379')).toEqual({ outcome: 'not_requested' });
      expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();
      expect(fake.ultimaGravacao('order_erp_events', 'insert')).toBeUndefined();
    });

    it('sem a 048 (sem rastro nenhum): not_requested, como antes', async () => {
      const { confirmOrderImport, fake } = await carregar({
        orders: emSequencia(NAO_SOLICITADO, OK),
        order_erp_events: COLUNA_AUSENTE,
      });

      expect(await confirmOrderImport(EMPRESA, 'o1', 'CS17379')).toEqual({ outcome: 'not_requested' });
      expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();
    });

    it('rastro que não responde LANÇA (500) — o robô tenta de novo, não leva um 409 definitivo', async () => {
      const { confirmOrderImport, fake } = await carregar({
        orders: emSequencia(NAO_SOLICITADO, OK),
        order_erp_events: emSequencia(OK, { data: null, error: { message: 'timeout' } }),
      });

      await expect(confirmOrderImport(EMPRESA, 'o1', 'CS17379')).rejects.toThrow(/rastro/);
      expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();
    });
  });

  it('sem a 049 (42703 na sonda): aprovado sem a solicitação confirma como antes; sonda que falha por rede LANÇA', async () => {
    const semColuna = await carregar({
      orders: emSequencia(LIDO({ id: 'o1', status: 'approved', erp_order_id: null }), COLUNA_AUSENTE, SONDA, NUMERO_LIVRE, SONDA_ORIGEM, GRAVOU),
    });
    expect(await semColuna.confirmOrderImport(EMPRESA, 'o1', 'CS17379')).toEqual({ outcome: 'ok', ja_confirmado: false });

    vi.resetModules();
    const soluco = await carregar({
      orders: emSequencia(LIDO({ id: 'o1', status: 'approved', erp_order_id: null }), { data: null, error: { message: 'timeout' } }),
    });
    await expect(soluco.confirmOrderImport(EMPRESA, 'o1', 'CS17379')).rejects.toThrow(/erp_requested_at/);
    expect(soluco.fake.ultimaGravacao('orders', 'update')).toBeUndefined();
  });

  it('pedido em error_erp pode ser confirmado — é a única outra entrada de sent_erp no fluxo', async () => {
    const { confirmOrderImport } = await carregar({
      orders: emSequencia(LIDO({ id: 'o1', status: 'error_erp', erp_order_id: null }), SONDA, NUMERO_LIVRE, SONDA_ORIGEM, GRAVOU),
    });

    expect(await confirmOrderImport(EMPRESA, 'o1', 'CS17379')).toEqual({ outcome: 'ok', ja_confirmado: false });
  });

  it('número já usado por OUTRO pedido da empresa é recusado antes de gravar, dizendo qual', async () => {
    const { confirmOrderImport, fake, registrarNoErp } = await carregar({
      orders: emSequencia(APROVADO, SONDA, NUMERO_DO_O2),
    });

    expect(await confirmOrderImport(EMPRESA, 'o1', 'cs-17379')).toEqual({
      outcome: 'number_in_use',
      pedido_em_uso: { id: 'o2', numero: 14600 },
    });
    // A pergunta é a mesma do financeiro: este número, nesta empresa, fora deste pedido.
    expect(fake.filtrosDe('orders', 'eq').map((f) => f.args)).toContainEqual(['erp_order_id', 'CS17379']);
    expect(fake.filtrosDe('orders', 'neq').map((f) => f.args)).toContainEqual(['id', 'o1']);
    expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();
    expect(registrarNoErp).not.toHaveBeenCalled();
  });

  it('sem a coluna order_number, o dono volta só com o id — e a consulta não pede a coluna', async () => {
    const { confirmOrderImport, fake } = await carregar({
      orders: emSequencia(APROVADO, COLUNA_AUSENTE, { data: [{ id: 'o2' }], error: null }),
    });

    expect(await confirmOrderImport(EMPRESA, 'o1', 'CS17379')).toEqual({
      outcome: 'number_in_use',
      pedido_em_uso: { id: 'o2', numero: null },
    });
    // O dublê devolve a linha qualquer que seja o select; o que prova o teste é
    // o select em si — pedir `order_number` num banco sem a coluna seria 42703
    // (500) em toda confirmação.
    const selects = fake.filtrosDe('orders', 'select').map((f) => String(f.args[0]));
    expect(selects).toContain('id');
    expect(selects).not.toContain('id, order_number');
  });

  it('o índice único da 042 (23505) na gravação vira o mesmo "número em uso", não 500', async () => {
    const { confirmOrderImport, fake, registrarNoErp } = await carregar({
      orders: emSequencia(
        APROVADO,
        SONDA,
        NUMERO_LIVRE, // a pré-checagem não viu: outro confirmou no mesmo instante
        SONDA_ORIGEM,
        { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } },
        NUMERO_DO_O2, // a segunda pergunta acha o dono (a sonda já está lembrada)
      ),
    });

    expect(await confirmOrderImport(EMPRESA, 'o1', 'CS17379')).toEqual({
      outcome: 'number_in_use',
      pedido_em_uso: { id: 'o2', numero: 14600 },
    });
    expect(fake.ultimaGravacao('orders', 'update')).toBeDefined();
    expect(registrarNoErp).not.toHaveBeenCalled();
  });

  it('outro erro na gravação LANÇA (vira 500 no app)', async () => {
    const { confirmOrderImport } = await carregar({
      orders: emSequencia(APROVADO, SONDA, NUMERO_LIVRE, SONDA_ORIGEM, { data: null, error: { message: 'caiu a conexão' } }),
    });

    await expect(confirmOrderImport(EMPRESA, 'o1', 'CS17379')).rejects.toThrow(/caiu a conexão/);
  });

  it('corrida: ninguém afetado porque alguém confirmou no meio com o MESMO número → idempotente', async () => {
    const { confirmOrderImport, registrarNoErp } = await carregar({
      orders: emSequencia(
        APROVADO,
        SONDA,
        NUMERO_LIVRE,
        SONDA_ORIGEM,
        { data: [], error: null }, // o `.is('erp_order_id', null)` não casou mais
        LIDO({ id: 'o1', status: 'sent_erp', erp_order_id: 'CS17379' }), // relido
      ),
    });

    expect(await confirmOrderImport(EMPRESA, 'o1', 'CS17379')).toEqual({ outcome: 'ok', ja_confirmado: true });
    // A foto é de quem gravou — esta chamada não gravou nada.
    expect(registrarNoErp).not.toHaveBeenCalled();
  });

  it('corrida: alguém confirmou no meio com OUTRO número → conflito, não sobrescreve', async () => {
    const { confirmOrderImport } = await carregar({
      orders: emSequencia(
        APROVADO,
        SONDA,
        NUMERO_LIVRE,
        SONDA_ORIGEM,
        { data: [], error: null },
        LIDO({ id: 'o1', status: 'sent_erp', erp_order_id: 'CS17000' }),
      ),
    });

    expect(await confirmOrderImport(EMPRESA, 'o1', 'CS17379')).toEqual({
      outcome: 'conflict',
      pedido_erp_atual: 'CS17000',
    });
  });
});

// ─── O controller ────────────────────────────────────────────────────────────

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

function requisicao(body: unknown, id = 'o1') {
  return { body, params: { id }, query: {}, headers: { 'x-api-key': 'chave' } } as unknown as FastifyRequest<{
    Params: { id: string };
    Body: { pedido_erp?: unknown };
  }>;
}

/** A linha de `companies` com os canais (048). Fila de um item: fica grudada. */
function canais(pedido_erp: string): RespostaTabela {
  return {
    data: {
      canal_pedido_erp: pedido_erp,
      canal_faturamento: 'manual',
      canal_cadastro: 'carga',
      canal_retrato: 'carga',
      canal_catalogo: 'carga',
    },
    error: null,
  };
}

async function carregarController(resultado: unknown, canalPedido = 'api') {
  const fake = criarSupabaseFake({ companies: canais(canalPedido) });
  vi.doMock(SUPABASE, () => ({ supabase: fake.cliente }));
  vi.doMock(AUTH, () => ({
    requirePartner: () => Promise.resolve({ name: 'control', key: 'chave', company_id: EMPRESA }),
  }));
  const confirmOrderImport = vi.fn().mockResolvedValue(resultado);
  const getPartnerOrders = vi.fn().mockResolvedValue(resultado);
  vi.doMock(SERVICO, () => ({ confirmOrderImport, getPartnerOrders }));
  vi.doMock(INTEGRACAO, () => ({
    lerSolicitacaoDeSync: vi.fn().mockResolvedValue({ migracao: true, solicitacao: null, expirado: false }),
  }));
  const { partnerConfirmOrderHandler, partnerOrdersHandler } = await import(
    '../apps/api/src/modules/partner/partner.controller.js'
  );
  return { partnerConfirmOrderHandler, partnerOrdersHandler, confirmOrderImport, getPartnerOrders, fake };
}

const SOLICITADO_EM = '2026-09-16T13:00:00.000Z';

/**
 * O /status com o pedido de sincronização (integracao.service) dublado:
 * `resposta` é "há pedido pendente?", ou um Error para lançar.
 */
async function carregarStatus(resposta: boolean | Error) {
  const fake = criarSupabaseFake({ companies: canais('api') });
  vi.doMock(SUPABASE, () => ({ supabase: fake.cliente }));
  vi.doMock(AUTH, () => ({
    requirePartner: () => Promise.resolve({ name: 'control', key: 'chave', company_id: EMPRESA }),
  }));
  vi.doMock(SERVICO, () => ({ confirmOrderImport: vi.fn(), getPartnerOrders: vi.fn() }));
  const lerSolicitacaoDeSync =
    resposta instanceof Error
      ? vi.fn().mockRejectedValue(resposta)
      : vi.fn().mockResolvedValue({
          migracao: true,
          solicitacao: resposta
            ? { solicitado_em: SOLICITADO_EM, solicitado_por: 'fin-1', solicitado_por_nome: 'Ana Financeiro' }
            : null,
          // A leitura já diz se expirou (expiracaoDoSync.ts); aqui, pedido dentro dos 15 min.
          expirado: false,
        });
  vi.doMock(INTEGRACAO, () => ({ lerSolicitacaoDeSync }));
  const { partnerStatusHandler } = await import('../apps/api/src/modules/partner/partner.controller.js');
  return { partnerStatusHandler, lerSolicitacaoDeSync };
}

describe('GET /status diz sincronizar_agora (049)', () => {
  it('true com pedido pendente — com o solicitado_em para o Control devolver, e anotado no registro', async () => {
    const { partnerStatusHandler, lerSolicitacaoDeSync } = await carregarStatus(true);
    const { reply, enviado } = replyFalso();
    const req = requisicao(undefined);

    await partnerStatusHandler(req as never, reply);

    expect(enviado.status).toBe(200);
    expect(enviado.corpo).toMatchObject({
      ok: true,
      sincronizar_agora: true,
      solicitado_em: SOLICITADO_EM,
      canais: { pedido_erp: 'api' },
    });
    expect(lerSolicitacaoDeSync).toHaveBeenCalledWith(EMPRESA);
    expect(req.partnerLog?.detalhe).toMatchObject({ sincronizar_agora: true });
  });

  it('false sem pedido pendente — sempre booleano, e solicitado_em nulo', async () => {
    const { partnerStatusHandler } = await carregarStatus(false);
    const { reply, enviado } = replyFalso();

    await partnerStatusHandler(requisicao(undefined) as never, reply);

    expect(enviado.status).toBe(200);
    expect(enviado.corpo).toMatchObject({ sincronizar_agora: false, solicitado_em: null });
  });

  it('os cinco canais da empresa saem no /status (catálogo e retrato inclusive)', async () => {
    const { partnerStatusHandler } = await carregarStatus(false);
    const { reply, enviado } = replyFalso();

    await partnerStatusHandler(requisicao(undefined) as never, reply);

    const corpo = enviado.corpo as { canais: Record<string, string> };
    expect(Object.keys(corpo.canais).sort()).toEqual(['cadastro', 'catalogo', 'faturamento', 'pedido_erp', 'retrato']);
  });

  it('banco que não responde degrada para false (é a rota de diagnóstico), sem 500, e anota', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { partnerStatusHandler } = await carregarStatus(new Error('timeout'));
    const { reply, enviado } = replyFalso();
    const req = requisicao(undefined);

    await partnerStatusHandler(req as never, reply);

    expect(enviado.status).toBe(200);
    expect(enviado.corpo).toMatchObject({ ok: true, sincronizar_agora: false, solicitado_em: null });
    expect(req.partnerLog?.detalhe).toMatchObject({ sincronizar_agora: 'nao_lido' });
    expect(erro).toHaveBeenCalled();
    erro.mockRestore();
  });
});

describe('o canal de pedidos (048) — a API só mexe na fila com canal_pedido_erp = api', () => {
  const FECHADO = {
    error: 'Canal de pedidos ainda não está ligado para a API nesta empresa',
    code: 'CANAL_FECHADO',
    statusCode: 409,
    canal: 'pedido_erp',
  };

  it.each([['manual'], ['sync_py']])('GET /pedidos com canal %s é 409 CANAL_FECHADO e nem lê a fila', async (canal) => {
    const { partnerOrdersHandler, getPartnerOrders } = await carregarController([], canal);
    const { reply, enviado } = replyFalso();

    await partnerOrdersHandler(requisicao(undefined) as never, reply);

    expect(enviado.status).toBe(409);
    expect(enviado.corpo).toEqual({ ...FECHADO, valor_atual: canal });
    expect(getPartnerOrders).not.toHaveBeenCalled();
  });

  it('POST /confirmar com canal manual é 409 CANAL_FECHADO — antes de olhar o corpo e sem gravar', async () => {
    const { partnerConfirmOrderHandler, confirmOrderImport } = await carregarController({ outcome: 'ok' }, 'manual');
    const { reply, enviado } = replyFalso();

    await partnerConfirmOrderHandler(requisicao({ pedido_erp: 'CS17379' }), reply);

    expect(enviado.status).toBe(409);
    expect(enviado.corpo).toEqual({ ...FECHADO, valor_atual: 'manual' });
    expect(confirmOrderImport).not.toHaveBeenCalled();
  });

  it('sem a 048 (coluna ausente) vale o padrão manual: fechado', async () => {
    vi.doMock(SUPABASE, () => ({
      supabase: criarSupabaseFake({
        companies: { data: null, error: { message: 'column companies.canal_pedido_erp does not exist', code: '42703' } },
      }).cliente,
    }));
    vi.doMock(AUTH, () => ({
      requirePartner: () => Promise.resolve({ name: 'control', key: 'chave', company_id: EMPRESA }),
    }));
    const getPartnerOrders = vi.fn();
    vi.doMock(SERVICO, () => ({ confirmOrderImport: vi.fn(), getPartnerOrders }));
    const { partnerOrdersHandler } = await import('../apps/api/src/modules/partner/partner.controller.js');
    const { reply, enviado } = replyFalso();

    await partnerOrdersHandler(requisicao(undefined) as never, reply);

    expect(enviado.status).toBe(409);
    expect(enviado.corpo).toMatchObject({ code: 'CANAL_FECHADO', valor_atual: 'manual' });
    expect(getPartnerOrders).not.toHaveBeenCalled();
  });

  it('banco que não responde sobre o canal LANÇA (500) — soluço não abre nem fecha canal', async () => {
    vi.doMock(SUPABASE, () => ({
      supabase: criarSupabaseFake({ companies: { data: null, error: { message: 'timeout' } } }).cliente,
    }));
    vi.doMock(AUTH, () => ({
      requirePartner: () => Promise.resolve({ name: 'control', key: 'chave', company_id: EMPRESA }),
    }));
    const getPartnerOrders = vi.fn();
    vi.doMock(SERVICO, () => ({ confirmOrderImport: vi.fn(), getPartnerOrders }));
    const { partnerOrdersHandler } = await import('../apps/api/src/modules/partner/partner.controller.js');
    const { reply } = replyFalso();

    await expect(partnerOrdersHandler(requisicao(undefined) as never, reply)).rejects.toThrow();
    expect(getPartnerOrders).not.toHaveBeenCalled();
  });

  it('GET /pedidos com canal api entrega a fila e anota o resumo da chamada (sem dado de cliente)', async () => {
    const lista = [{ id: 'o1', importavel: true }, { id: 'o2', importavel: false }];
    const { partnerOrdersHandler, getPartnerOrders } = await carregarController(lista, 'api');
    const { reply, enviado } = replyFalso();
    const req = { ...requisicao(undefined), query: { incluir: 'todos' } } as unknown as FastifyRequest<{
      Querystring: { desde?: string; incluir?: string };
    }>;

    await partnerOrdersHandler(req, reply);

    expect(enviado.status).toBe(200);
    expect(enviado.corpo).toMatchObject({ total: 2, pedidos: lista });
    expect(getPartnerOrders).toHaveBeenCalledWith(EMPRESA, { desde: undefined, incluirImportados: true });
    expect(req.partnerLog).toMatchObject({
      company_id: EMPRESA,
      parceiro: 'control',
      detalhe: { incluir: 'todos', pedidos: 2, importaveis: 1 },
    });
  });
});

describe('POST /pedidos/:id/confirmar — o que o programador do Fábio vê', () => {
  it.each([[{}], [{ pedido_erp: '   ' }], [{ pedido_erp: 17379 }], [null], [[]], ['CS17379']])(
    'corpo sem pedido_erp em texto (%j) é 400 MISSING_PEDIDO_ERP, antes de tocar no banco',
    async (body) => {
      const { partnerConfirmOrderHandler, confirmOrderImport } = await carregarController({ outcome: 'ok' });
      const { reply, enviado } = replyFalso();

      await partnerConfirmOrderHandler(requisicao(body), reply);

      expect(enviado.status).toBe(400);
      expect(enviado.corpo).toMatchObject({ code: 'MISSING_PEDIDO_ERP', statusCode: 400 });
      expect(confirmOrderImport).not.toHaveBeenCalled();
    },
  );

  it('invalid_number → 400 INVALID_PEDIDO_ERP com o formato na mensagem', async () => {
    const { partnerConfirmOrderHandler } = await carregarController({ outcome: 'invalid_number' });
    const { reply, enviado } = replyFalso();

    await partnerConfirmOrderHandler(requisicao({ pedido_erp: 'PED-00123' }), reply);

    expect(enviado.status).toBe(400);
    expect(enviado.corpo).toEqual({
      error: 'pedido_erp fora do formato: duas letras e ate 10 digitos (ex.: CS17379)',
      code: 'INVALID_PEDIDO_ERP',
      statusCode: 400,
    });
  });

  it('not_found → 404 ORDER_NOT_FOUND', async () => {
    const { partnerConfirmOrderHandler } = await carregarController({ outcome: 'not_found' });
    const { reply, enviado } = replyFalso();

    await partnerConfirmOrderHandler(requisicao({ pedido_erp: 'CS17379' }), reply);

    expect(enviado.status).toBe(404);
    expect(enviado.corpo).toMatchObject({ code: 'ORDER_NOT_FOUND', statusCode: 404 });
  });

  it('conflict → 409 ORDER_ALREADY_CONFIRMED com pedido_erp_atual', async () => {
    const { partnerConfirmOrderHandler } = await carregarController({
      outcome: 'conflict',
      pedido_erp_atual: 'CS17000',
    });
    const { reply, enviado } = replyFalso();

    await partnerConfirmOrderHandler(requisicao({ pedido_erp: 'CS17379' }), reply);

    expect(enviado.status).toBe(409);
    expect(enviado.corpo).toMatchObject({
      code: 'ORDER_ALREADY_CONFIRMED',
      statusCode: 409,
      pedido_erp_atual: 'CS17000',
    });
  });

  it('not_requested → 409 ORDER_NOT_REQUESTED', async () => {
    const { partnerConfirmOrderHandler } = await carregarController({ outcome: 'not_requested' });
    const { reply, enviado } = replyFalso();

    await partnerConfirmOrderHandler(requisicao({ pedido_erp: 'CS17379' }), reply);

    expect(enviado.status).toBe(409);
    expect(enviado.corpo).toMatchObject({ code: 'ORDER_NOT_REQUESTED', statusCode: 409 });
  });

  it('not_confirmable → 409 ORDER_NOT_APPROVED com a situação atual', async () => {
    const { partnerConfirmOrderHandler } = await carregarController({
      outcome: 'not_confirmable',
      situacao: 'draft',
    });
    const { reply, enviado } = replyFalso();

    await partnerConfirmOrderHandler(requisicao({ pedido_erp: 'CS17379' }), reply);

    expect(enviado.status).toBe(409);
    expect(enviado.corpo).toEqual({
      error: 'so pedido aprovado pode ser confirmado',
      code: 'ORDER_NOT_APPROVED',
      statusCode: 409,
      situacao: 'draft',
    });
  });

  it('number_in_use → 409 ERP_NUMBER_IN_USE com pedido_em_uso (o mesmo código do lançamento à mão)', async () => {
    const { partnerConfirmOrderHandler } = await carregarController({
      outcome: 'number_in_use',
      pedido_em_uso: { id: 'o2', numero: 14600 },
    });
    const { reply, enviado } = replyFalso();

    await partnerConfirmOrderHandler(requisicao({ pedido_erp: 'CS17379' }), reply);

    expect(enviado.status).toBe(409);
    expect(enviado.corpo).toMatchObject({
      code: 'ERP_NUMBER_IN_USE',
      statusCode: 409,
      pedido_em_uso: { id: 'o2', numero: 14600 },
    });
    expect((enviado.corpo as { error: string }).error).toContain('14600');
  });

  it('ok → 200 { ok, ja_confirmado }', async () => {
    const { partnerConfirmOrderHandler, confirmOrderImport } = await carregarController({
      outcome: 'ok',
      ja_confirmado: false,
    });
    const { reply, enviado } = replyFalso();

    await partnerConfirmOrderHandler(requisicao({ pedido_erp: 'CS17379' }), reply);

    expect(enviado.status).toBe(200);
    expect(enviado.corpo).toEqual({ ok: true, ja_confirmado: false });
    // O nome da chave desce para o rastro do pedido (048).
    expect(confirmOrderImport).toHaveBeenCalledWith(EMPRESA, 'o1', 'CS17379', 'control');
  });

  it('desfecho que o controller não conhece responde 500 INTERNAL_ERROR — nunca fica pendurado', async () => {
    const { partnerConfirmOrderHandler } = await carregarController({ outcome: 'inventado' });
    const { reply, enviado } = replyFalso();

    await partnerConfirmOrderHandler(requisicao({ pedido_erp: 'CS17379' }), reply);

    expect(enviado.status).toBe(500);
    expect(enviado.corpo).toEqual({ error: 'Erro interno do servidor', code: 'INTERNAL_ERROR', statusCode: 500 });
  });
});
