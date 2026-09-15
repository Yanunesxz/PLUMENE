import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { criarSupabaseFake, type RespostaTabela } from './supabaseFake.js';
import { esquecerDeteccoes } from '../apps/api/src/lib/detectarColuna.js';

/**
 * A mão dos PEDIDOS na API de Parceiro — o que o programa do Fábio puxa e o
 * que ele confirma.
 *
 * Até 15/09/2026 este módulo não tinha teste nenhum: a fila, as cinco
 * pendências, a cor sortida e os desfechos do `confirmar` só existiam no
 * código. Estes testes são a rede de segurança antes de endurecer o contrato
 * (brief da integração, §7 passo 4).
 *
 * O que fica trancado:
 *   1. a fila padrão é approved SEM número do Control; `desde` e `incluir=todos`
 *      mudam só o filtro, nunca o formato;
 *   2. as CINCO pendências têm texto exato, saem deduplicadas, e `importavel`
 *      é "nenhuma pendência";
 *   3. a cor vai SEMPRE como '00001' e a escolha do cliente viaja na
 *      observação do item; a observação do pedido sai sem as linhas de cor;
 *   4. condição de pagamento ausente não é pendência; desconto sai em pontos
 *      percentuais; coluna de migração ausente degrada para null/0 sem quebrar;
 *   5. o `confirmar` grava o número normalizado e tira a foto da 046, repete
 *      idempotente com o mesmo número e recusa número diferente.
 */

const EMPRESA = 'empresa-1';
const SUPABASE = '../apps/api/src/config/supabase.js';
const ERP_SYNC = '../apps/api/src/modules/orders/erpSync.service.js';
const AUTH = '../apps/api/src/modules/partner/partner.auth.js';
const SERVICO = '../apps/api/src/modules/partner/partner.service.js';

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
 * A fila de `orders` para a listagem: as QUATRO sondas de coluna
 * (order_number, invoiced, payment_condition_id, discount_percent) disparam
 * juntas antes de qualquer resposta, depois vêm as páginas.
 */
function filaDaListagem(paginas: RespostaTabela[], sondas: RespostaTabela[] = [OK, OK, OK, OK]) {
  return [...sondas, ...sondas, ...emSequencia(...paginas)];
}

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

beforeEach(() => {
  vi.resetModules();
  esquecerDeteccoes();
});
afterEach(() => {
  vi.doUnmock(SUPABASE);
  vi.doUnmock(ERP_SYNC);
  vi.doUnmock(AUTH);
  vi.doUnmock(SERVICO);
});

// ─── A fila ──────────────────────────────────────────────────────────────────

describe('a fila de pedidos para o ERP', () => {
  it('padrão: aprovados sem número do Control, só da empresa da chave', async () => {
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
    expect(fake.filtrosDe('orders', 'in')).toHaveLength(0);
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

  it('`incluir=todos` traz aprovados E já enviados — a reconciliação', async () => {
    const { getPartnerOrders, fake } = await carregar({
      orders: filaDaListagem([{ data: [pedido({ status: 'sent_erp', erp_order_id: 'CS17379' })], error: null }]),
      price_tables: { data: [], error: null },
    });

    const lista = await getPartnerOrders(EMPRESA, { incluirImportados: true });

    expect(fake.filtrosDe('orders', 'in').map((f) => f.args)).toContainEqual([
      'status',
      ['approved', 'sent_erp'],
    ]);
    expect(fake.filtrosDe('orders', 'eq').map((f) => f.args)).not.toContainEqual(['status', 'approved']);
    expect(fake.filtrosDe('orders', 'is')).toHaveLength(0);
    // O enviado sai com o número que o Control deu — é por ele que o parceiro reconcilia.
    expect(lista[0]).toMatchObject({ situacao: 'sent_erp', pedido_erp: 'CS17379' });
  });

  it('ordena por created_at crescente — o mais antigo é o primeiro a ser lançado', async () => {
    const { getPartnerOrders, fake } = await carregar({
      orders: filaDaListagem([{ data: [], error: null }]),
      price_tables: { data: [], error: null },
    });

    await getPartnerOrders(EMPRESA, {});

    expect(fake.filtrosDe('orders', 'order').map((f) => f.args)).toContainEqual([
      'created_at',
      { ascending: true },
    ]);
  });

  it('erro do banco na listagem sobe — nunca "200 com lista vazia"', async () => {
    const { getPartnerOrders } = await carregar({
      orders: filaDaListagem([{ data: null, error: { message: 'timeout' } }]),
      price_tables: { data: [], error: null },
    });

    await expect(getPartnerOrders(EMPRESA, {})).rejects.toThrow(/timeout/);
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
    expect(quaseTudo!.pendencias).toEqual([
      'cliente sem código do ERP',
      'cliente sem representante vinculado no ERP',
      'pedido sem tabela de preço vinculada no ERP',
      'item sem vínculo de produto/tamanho com o ERP',
    ]);
    expect(semItens!.importavel).toBe(false);
    expect(semItens!.pendencias).toEqual(['pedido sem itens']);
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
    const { getPartnerOrders } = await carregar({
      orders: filaDaListagem([{ data: [pedido({ price_table_erp_code: null, price_column: null })], error: null }]),
      price_tables: { data: [{ id: 't1', erp_code: 'T02', price_column: null }], error: null },
    });

    const [p] = await getPartnerOrders(EMPRESA, {});

    expect(p!.tabela_preco).toEqual({ codigo_erp: 'T02', coluna: 1 });
    expect(p!.importavel).toBe(true);
  });

  it('coluna de migração ausente (42703): o campo sai null/0 e a consulta não pede a coluna', async () => {
    const { getPartnerOrders, fake } = await carregar({
      // order_number e invoiced existem; payment_condition_id e discount_percent, não.
      orders: filaDaListagem(
        [{ data: [pedido({ payment_condition: undefined, discount_percent: undefined })], error: null }],
        [OK, OK, COLUNA_AUSENTE, COLUNA_AUSENTE],
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

// ─── O confirmar ─────────────────────────────────────────────────────────────

const LIDO = (linha: Record<string, unknown> | null): RespostaTabela => ({ data: linha, error: null });

describe('confirmOrderImport — o ERP devolve o número', () => {
  it('grava o número NORMALIZADO, força sent_erp, carimba synced_at/updated_at e tira a foto', async () => {
    const { confirmOrderImport, fake, registrarNoErp } = await carregar({
      orders: emSequencia(LIDO({ id: 'o1', status: 'approved', erp_order_id: null }), LIDO(null)),
    });

    const r = await confirmOrderImport(EMPRESA, 'o1', ' cs-17379 ');

    expect(r).toEqual({ outcome: 'ok', ja_confirmado: false });
    const gravado = fake.ultimaGravacao('orders', 'update')?.valores as Record<string, unknown>;
    expect(gravado).toMatchObject({ status: 'sent_erp', erp_order_id: 'CS17379' });
    expect(typeof gravado['synced_at']).toBe('string');
    expect(typeof gravado['updated_at']).toBe('string');
    expect(fake.filtrosDe('orders', 'eq').map((f) => f.args)).toContainEqual(['company_id', EMPRESA]);
    expect(registrarNoErp).toHaveBeenCalledWith('o1', EMPRESA, null);
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

  it('pedido que não existe (ou é de outra empresa) é not_found', async () => {
    const { confirmOrderImport, fake } = await carregar({ orders: emSequencia(LIDO(null)) });

    expect(await confirmOrderImport(EMPRESA, 'nao-existe', 'CS17379')).toEqual({ outcome: 'not_found' });
    expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();
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
    Body: { pedido_erp?: string };
  }>;
}

async function carregarController(resultado: unknown) {
  vi.doMock(SUPABASE, () => ({ supabase: criarSupabaseFake({}).cliente }));
  vi.doMock(AUTH, () => ({
    requirePartner: () => Promise.resolve({ name: 'control', key: 'chave', company_id: EMPRESA }),
  }));
  const confirmOrderImport = vi.fn().mockResolvedValue(resultado);
  vi.doMock(SERVICO, () => ({ confirmOrderImport, getPartnerOrders: vi.fn() }));
  const { partnerConfirmOrderHandler } = await import('../apps/api/src/modules/partner/partner.controller.js');
  return { partnerConfirmOrderHandler, confirmOrderImport };
}

describe('POST /pedidos/:id/confirmar — o que o programador do Fábio vê', () => {
  it.each([[{}], [{ pedido_erp: '   ' }], [null]])(
    'corpo sem pedido_erp (%j) é 400 MISSING_PEDIDO_ERP, antes de tocar no banco',
    async (body) => {
      const { partnerConfirmOrderHandler, confirmOrderImport } = await carregarController({ outcome: 'ok' });
      const { reply, enviado } = replyFalso();

      await partnerConfirmOrderHandler(requisicao(body), reply);

      expect(enviado.status).toBe(400);
      expect(enviado.corpo).toMatchObject({ code: 'MISSING_PEDIDO_ERP', statusCode: 400 });
      expect(confirmOrderImport).not.toHaveBeenCalled();
    },
  );

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

  it('ok → 200 { ok, ja_confirmado }', async () => {
    const { partnerConfirmOrderHandler, confirmOrderImport } = await carregarController({
      outcome: 'ok',
      ja_confirmado: false,
    });
    const { reply, enviado } = replyFalso();

    await partnerConfirmOrderHandler(requisicao({ pedido_erp: 'CS17379' }), reply);

    expect(enviado.status).toBe(200);
    expect(enviado.corpo).toEqual({ ok: true, ja_confirmado: false });
    expect(confirmOrderImport).toHaveBeenCalledWith(EMPRESA, 'o1', 'CS17379');
  });
});
