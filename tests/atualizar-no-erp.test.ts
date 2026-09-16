import { describe, it, expect, vi, beforeEach } from 'vitest';
import { criarSupabaseFake, type RespostaTabela } from './supabaseFake.js';

/**
 * "ATUALIZAR NO ERP" (migração 046).
 *
 * Pedido do Yan (11/09/2026): "depois que o pedido for enviado pelas vendedoras
 * internas e elas alterarem ele, temos que ter um botão depois que editou as
 * peças como 'atualizar no ERP', porque se ela mudar por lá tem que mudar no
 * ERP principal também".
 *
 * O buraco que isto fecha: a venda interna mexe no PRÓPRIO pedido até o carimbo
 * de faturado (regra da 031), inclusive depois de a Larissa lançar no Control.
 * Sem aviso, a nota sai pelo pedido velho.
 *
 * O que estes testes trancam: o lançamento tira a foto; pedir só vale em pedido
 * já lançado; confirmar tira a foto DE NOVO (e é isso que apaga a divergência,
 * em vez de um booleano que pode dessincronizar); e sem a 046 nada quebra.
 */

async function carregarServico(respostas: Record<string, RespostaTabela | RespostaTabela[]>) {
  const fake = criarSupabaseFake(respostas as never);
  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
  const mod = await import('../apps/api/src/modules/orders/erpSync.service.js');
  return { ...mod, fake };
}

const EMPRESA = 'empresa-1';
const PEDIDO_LANCADO = {
  id: 'o1',
  order_number: 14627,
  erp_order_id: 'CS17379',
  total: 500,
  items: [{ quantity: 12 }, { quantity: 8 }],
};

const SEM_A_TABELA: RespostaTabela = {
  data: null,
  error: { message: 'relation "order_erp_sync" does not exist', code: '42P01' },
};

// `vi.resetModules()` já isola: cada import dinâmico reavalia detectarColuna.js
// numa instância nova, com a memória de sondas vazia.
beforeEach(() => {
  vi.resetModules();
});

describe('registrarNoErp — a foto do que o Control conhece', () => {
  it('grava as peças e o número do Control no lançamento', async () => {
    const { registrarNoErp, fake } = await carregarServico({
      order_erp_sync: [{ data: [], error: null }, { data: null, error: null }],
      orders: { data: PEDIDO_LANCADO, error: null },
    });

    expect(await registrarNoErp('o1', EMPRESA, 'larissa')).toBe('guardada');
    const gravado = fake.ultimaGravacao('order_erp_sync')?.valores as {
      pecas: number;
      total: number;
      erp_order_id: string;
      pedido_em: string | null;
    };
    expect(gravado).toMatchObject({ pecas: 20, total: 500, erp_order_id: 'CS17379' });
    // Foto nova zera o pedido de atualização: o que foi pedido acabou de ser feito.
    expect(gravado.pedido_em).toBeNull();
  });

  it('sem a migração 046, o lançamento continua acontecendo — só sem foto', async () => {
    const { registrarNoErp, fake } = await carregarServico({ order_erp_sync: SEM_A_TABELA });

    expect(await registrarNoErp('o1', EMPRESA)).toBe('sem_tabela');
    expect(fake.ultimaGravacao('order_erp_sync')).toBeUndefined();
  });
});

describe('pedirAtualizacao — o botão da venda interna', () => {
  it('registra quem pediu, quando e o recado', async () => {
    const { pedirAtualizacao, fake } = await carregarServico({
      order_erp_sync: [
        { data: [], error: null }, // detecção
        // O dublê adianta a próxima resposta a cada consulta; esta linha é o
        // espaço dessa antecipação, para a seguinte cair na ida certa ao banco.
        { data: [], error: null },
        { data: { order_id: 'o1' }, error: null }, // já foi lançado
        {
          data: {
            erp_order_id: 'CS17379',
            total: 500,
            pecas: 20,
            snapshot: PEDIDO_LANCADO,
            confirmado_em: '2026-09-11T10:00:00Z',
            pedido_em: '2026-09-11T14:00:00Z',
            observacao: 'tirei 6 pecas da 0124',
          },
          error: null,
        },
      ],
      orders: { data: { invoiced: false }, error: null }, // sem nota: dá para pedir
    });

    const r = await pedirAtualizacao('o1', EMPRESA, 'simone', '  tirei 6 pecas da 0124  ');

    expect(r.ok).toBe(true);
    const pedido = fake.ultimaGravacao('order_erp_sync', 'update')?.valores as {
      pedido_por: string;
      observacao: string;
    };
    expect(pedido).toMatchObject({ pedido_por: 'simone', observacao: 'tirei 6 pecas da 0124' });
  });

  it('pedido que nunca foi ao Control não tem o que atualizar lá', async () => {
    const { pedirAtualizacao, fake } = await carregarServico({
      order_erp_sync: [
        { data: [], error: null }, // detecção
        { data: null, error: null }, // sem foto: nunca lançado
      ],
    });

    expect(await pedirAtualizacao('o1', EMPRESA, 'simone')).toEqual({
      ok: false,
      motivo: 'nao_lancado',
    });
    expect(fake.ultimaGravacao('order_erp_sync', 'update')).toBeUndefined();
  });
});

describe('confirmarAtualizacao — "já atualizei no Control"', () => {
  it('tira a foto DE NOVO, que é o que apaga a divergência', async () => {
    const { confirmarAtualizacao, fake } = await carregarServico({
      order_erp_sync: [
        { data: [], error: null }, // detecção
        { data: [], error: null }, // o espaço da antecipação do dublê
        { data: { order_id: 'o1' }, error: null }, // existe
        {
          data: {
            erp_order_id: 'CS17379',
            total: 420,
            pecas: 14,
            snapshot: { ...PEDIDO_LANCADO, items: [{ quantity: 6 }, { quantity: 8 }] },
            confirmado_em: '2026-09-11T15:00:00Z',
            pedido_em: null,
            observacao: null,
          },
          error: null,
        },
      ],
      orders: { data: { ...PEDIDO_LANCADO, total: 420, items: [{ quantity: 6 }, { quantity: 8 }] }, error: null },
    });

    const r = await confirmarAtualizacao('o1', EMPRESA, 'larissa');

    expect(r.ok).toBe(true);
    const gravado = fake.ultimaGravacao('order_erp_sync')?.valores as {
      pecas: number;
      confirmado_por: string;
      pedido_em: string | null;
    };
    // A foto passa a ser o pedido de HOJE: 14 peças, não as 20 do lançamento.
    expect(gravado).toMatchObject({ pecas: 14, confirmado_por: 'larissa' });
    expect(gravado.pedido_em).toBeNull();
  });
});

/**
 * O número do Control também chega SEM a Larissa digitar: o ERP do parceiro
 * confirma a importação por POST /partner/v1/pedidos/:id/confirmar. Esse
 * caminho grava o número e força sent_erp — e precisa tirar a mesma foto,
 * senão pedido confirmado pela API nunca acusaria "mudou depois de ir para
 * o ERP" quando a venda interna editasse.
 */
describe('a confirmação pela API do parceiro também tira a foto', () => {
  it('grava a foto com o número que o ERP mandou', async () => {
    // A ordem das consultas do confirmar (contrato de 15/09/2026): lê o
    // pedido, sonda `order_number`, confere se o número já é de outro pedido,
    // grava — e só então a foto. Entre uma e outra vai o espaço da
    // antecipação do dublê.
    const fake = criarSupabaseFake({
      orders: [
        { data: { id: 'o1', status: 'approved', erp_order_id: null, erp_requested_at: '2026-09-16T12:00:00Z' }, error: null }, // o pedido (solicitado ao Control)
        { data: [], error: null }, // o espaço da antecipação do dublê
        { data: [], error: null }, // a sonda de order_number (existe)
        { data: [], error: null }, // espaço
        { data: [], error: null }, // ninguém usa o número
        { data: [], error: null }, // espaço
        { data: [{ id: 'o1' }], error: null }, // o update (uma linha afetada)
        { data: [], error: null }, // espaço
        { data: { ...PEDIDO_LANCADO, erp_order_id: 'SX14627' }, error: null }, // a foto
      ],
      order_erp_sync: [
        { data: [], error: null }, // detecção
        { data: null, error: null }, // o upsert
      ],
    } as never);
    vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
    const { confirmOrderImport } = await import('../apps/api/src/modules/partner/partner.service.js');

    const r = await confirmOrderImport(EMPRESA, 'o1', 'sx-14627');

    expect(r).toEqual({ outcome: 'ok', ja_confirmado: false });
    const foto = fake.ultimaGravacao('order_erp_sync', 'upsert')?.valores as {
      erp_order_id: string;
      pecas: number;
    };
    expect(foto).toMatchObject({ erp_order_id: 'SX14627', pecas: 20 });
  });
});

// ─── Consertos da revisão adversarial (15/09/2026) ───────────────────────────

describe('confirmarAtualizacao — o que ainda não foi lançado', () => {
  it('pedido sem foto não é "confirmado": nada é gravado', async () => {
    const { confirmarAtualizacao, fake } = await carregarServico({
      order_erp_sync: [
        { data: [], error: null }, // detecção
        { data: null, error: null }, // sem foto: nunca lançado
      ],
    });

    expect(await confirmarAtualizacao('o1', EMPRESA, 'larissa')).toEqual({ ok: false, motivo: 'nao_lancado' });
    expect(fake.ultimaGravacao('order_erp_sync', 'upsert')).toBeUndefined();
  });
});

describe('confirmarAtualizacao — a Larissa confirma o que VIU', () => {
  it('se a venda interna mexeu de novo no meio, a confirmação é recusada e a foto não muda', async () => {
    const { assinaturaDoPedido } = await import('@csb/shared');
    const vista = assinaturaDoPedido({
      items: [{ id: 'i1', order_id: 'o1', product_id: 'p1', variant_id: null, quantity: 12, unit_price: 10, total: 120 }],
    });
    const { confirmarAtualizacao, fake } = await carregarServico({
      order_erp_sync: [
        { data: [], error: null }, // detecção
        { data: { order_id: 'o1' }, error: null }, // existe
      ],
      // o pedido de AGORA: a Simone baixou para 4 enquanto a Larissa digitava
      orders: {
        data: {
          id: 'o1',
          items: [{ id: 'i1', order_id: 'o1', product_id: 'p1', variant_id: null, quantity: 4, unit_price: 10, total: 40 }],
        },
        error: null,
      },
    });

    expect(await confirmarAtualizacao('o1', EMPRESA, 'larissa', vista)).toEqual({ ok: false, motivo: 'mudou_de_novo' });
    expect(fake.ultimaGravacao('order_erp_sync', 'upsert')).toBeUndefined();
  });
});

describe('garantirFotoDoErp — os pedidos lançados antes da 046', () => {
  it('pedido que não foi para o Control não ganha foto', async () => {
    const { garantirFotoDoErp, fake } = await carregarServico({});
    expect(await garantirFotoDoErp({ id: 'o1', status: 'approved' }, EMPRESA)).toBe('nao_lancado');
    expect(fake.filtrosDe('order_erp_sync')).toHaveLength(0);
  });

  it('pedido lançado SEM foto ganha a primeira, por INSERT (não sobrescreve ninguém)', async () => {
    const { garantirFotoDoErp, fake } = await carregarServico({
      order_erp_sync: [
        { data: [], error: null }, // detecção
        { data: null, error: null }, // ainda não há foto
        { data: null, error: null }, // o insert
      ],
      orders: { data: PEDIDO_LANCADO, error: null },
    });

    expect(await garantirFotoDoErp({ id: 'o1', status: 'sent_erp' }, EMPRESA)).toBe('guardada');
    expect(fake.ultimaGravacao('order_erp_sync', 'insert')?.valores).toMatchObject({ pecas: 20, erp_order_id: 'CS17379' });
    expect(fake.ultimaGravacao('order_erp_sync', 'upsert')).toBeUndefined();
  });

  it('pedido que JÁ tem foto mantém a dele — a edição de hoje não apaga a divergência que cria', async () => {
    const { garantirFotoDoErp, fake } = await carregarServico({
      order_erp_sync: [
        { data: [], error: null }, // detecção
        { data: { order_id: 'o1' }, error: null }, // já tem
      ],
    });

    expect(await garantirFotoDoErp({ id: 'o1', status: 'sent_erp' }, EMPRESA)).toBe('ja_tinha');
    expect(fake.ultimaGravacao('order_erp_sync')).toBeUndefined();
  });
});

describe('divergenciaComOErp — as quatro portas', () => {
  const item = (quantity: number) => ({
    id: 'i1',
    order_id: 'o1',
    product_id: 'p1',
    variant_id: null,
    quantity,
    unit_price: 10,
    total: quantity * 10,
  });

  it('desconto trocado depois do lançamento acusa divergência mesmo com as mesmas peças', async () => {
    const { divergenciaComOErp } = await import('@csb/shared');
    const d = divergenciaComOErp(
      { items: [item(5)], discount_percent: 5 },
      { items: [item(5)], discount_percent: 8 },
    );
    expect(d.mudou).toBe(true);
    expect(d.itens.mudou).toBe(false);
    expect(d.desconto).toEqual({ antes: 5, depois: 8 });
  });

  it('condição de pagamento e observação também contam', async () => {
    const { divergenciaComOErp } = await import('@csb/shared');
    expect(divergenciaComOErp({ items: [], payment_condition_id: 'c1' }, { items: [], payment_condition_id: 'c2' }).condicaoMudou).toBe(true);
    expect(divergenciaComOErp({ items: [], notes: 'entregar sexta' }, { items: [], notes: 'entregar segunda' }).observacaoMudou).toBe(true);
  });

  it('foto sem a coluna (undefined) e pedido sem condição (null) são o mesmo "sem condição"', async () => {
    const { divergenciaComOErp } = await import('@csb/shared');
    const d = divergenciaComOErp({ items: [item(3)] }, { items: [item(3)], payment_condition_id: null, notes: '  ' });
    expect(d.mudou).toBe(false);
  });

  it('troca de preço sozinha não pede atualização no Control', async () => {
    const { divergenciaComOErp } = await import('@csb/shared');
    const d = divergenciaComOErp({ items: [item(5)] }, { items: [{ ...item(5), unit_price: 9, total: 45 }] });
    expect(d.mudou).toBe(false);
  });
});

describe('assinaturaDoPedido', () => {
  it('não depende da ordem em que o banco devolve as linhas', async () => {
    const { assinaturaDoPedido } = await import('@csb/shared');
    const a = { id: 'a', order_id: 'o1', product_id: 'p1', variant_id: 'm', quantity: 2, unit_price: 1, total: 2 };
    const b = { id: 'b', order_id: 'o1', product_id: 'p2', variant_id: null, quantity: 3, unit_price: 1, total: 3 };
    expect(assinaturaDoPedido({ items: [a, b] })).toBe(assinaturaDoPedido({ items: [b, a] }));
  });

  it('muda quando muda quantidade, desconto, condição ou observação', async () => {
    const { assinaturaDoPedido } = await import('@csb/shared');
    const i = { id: 'a', order_id: 'o1', product_id: 'p1', variant_id: null, quantity: 2, unit_price: 1, total: 2 };
    const base = assinaturaDoPedido({ items: [i] });
    expect(assinaturaDoPedido({ items: [{ ...i, quantity: 3 }] })).not.toBe(base);
    expect(assinaturaDoPedido({ items: [i], discount_percent: 5 })).not.toBe(base);
    expect(assinaturaDoPedido({ items: [i], payment_condition_id: 'c1' })).not.toBe(base);
    expect(assinaturaDoPedido({ items: [i], notes: 'x' })).not.toBe(base);
  });
});

// ─── Segunda revisão (15/09/2026) ────────────────────────────────────────────

describe('pedido faturado não tem o que atualizar no Control — para ninguém', () => {
  it('pedir é recusado e nada é gravado', async () => {
    const { pedirAtualizacao, fake } = await carregarServico({
      order_erp_sync: [
        { data: [], error: null }, // detecção
        { data: { order_id: 'o1' }, error: null }, // lançado
      ],
      orders: { data: { invoiced: true }, error: null },
    });

    expect(await pedirAtualizacao('o1', EMPRESA, 'larissa')).toEqual({ ok: false, motivo: 'ja_faturado' });
    expect(fake.ultimaGravacao('order_erp_sync', 'update')).toBeUndefined();
  });

  it('confirmar também', async () => {
    const { confirmarAtualizacao, fake } = await carregarServico({
      order_erp_sync: [
        { data: [], error: null },
        { data: { order_id: 'o1' }, error: null },
      ],
      orders: { data: { ...PEDIDO_LANCADO, invoiced: true }, error: null },
    });

    expect(await confirmarAtualizacao('o1', EMPRESA, 'larissa', 'qualquer')).toEqual({
      ok: false,
      motivo: 'ja_faturado',
    });
    expect(fake.ultimaGravacao('order_erp_sync', 'upsert')).toBeUndefined();
  });
});

describe('confirmar com a lista que a Larissa conferiu IGUAL à do banco', () => {
  it('passa, e grava exatamente a foto que foi conferida', async () => {
    const { assinaturaDoPedido } = await import('@csb/shared');
    // Como a TELA monta: itens com referência e tamanho, desconto como número.
    const naTela = {
      items: [
        {
          id: 'i1',
          order_id: 'o1',
          product_id: 'p1',
          variant_id: 'v-m',
          quantity: 6,
          unit_price: 24.9,
          total: 149.4,
          product: { sku: '0124', name: 'PIJAMA' },
          variant: { size: 'M' },
        },
      ],
      discount_percent: 5,
      payment_condition_id: null,
      notes: 'entregar sexta',
    };
    // Como o BANCO devolve: sem os embeds, NUMERIC como texto, observação com espaço no fim.
    const noBanco = {
      id: 'o1',
      erp_order_id: 'CS17379',
      total: 141.93,
      invoiced: false,
      discount_percent: '5.00',
      payment_condition_id: null,
      notes: 'entregar sexta  ',
      items: [{ id: 'i1', order_id: 'o1', product_id: 'p1', variant_id: 'v-m', quantity: 6, unit_price: 24.9, total: 149.4 }],
    };
    const { confirmarAtualizacao, fake } = await carregarServico({
      order_erp_sync: [
        { data: [], error: null }, // detecção
        { data: [], error: null }, // o espaço da antecipação do dublê
        { data: { order_id: 'o1' }, error: null }, // existe
        {
          data: {
            erp_order_id: 'CS17379',
            total: 141.93,
            pecas: 6,
            snapshot: noBanco,
            confirmado_em: '2026-09-15T15:00:00Z',
            pedido_em: null,
            observacao: null,
          },
          error: null,
        },
      ],
      orders: { data: noBanco, error: null },
    });

    const r = await confirmarAtualizacao('o1', EMPRESA, 'larissa', assinaturaDoPedido(naTela));

    expect(r.ok).toBe(true);
    expect(fake.ultimaGravacao('order_erp_sync', 'upsert')?.valores).toMatchObject({ pecas: 6, confirmado_por: 'larissa' });
    // Uma leitura do pedido só: conferir e gravar a MESMA foto.
    expect(fake.filtrosDe('orders', 'select')).toHaveLength(1);
  });
});

// ─── Terceira revisão (15/09/2026) ───────────────────────────────────────────

describe('garantirFotoDoErp — dúvida não é ausência', () => {
  const SOLUCO: RespostaTabela = { data: null, error: { message: 'fetch failed', code: '' } };

  it('se não deu para perguntar se a tabela existe, a edição PARA (falhou), em vez de gravar sem foto', async () => {
    const { garantirFotoDoErp, fake } = await carregarServico({ order_erp_sync: SOLUCO });

    expect(await garantirFotoDoErp({ id: 'o1', status: 'sent_erp' }, EMPRESA)).toBe('falhou');
    expect(fake.ultimaGravacao('order_erp_sync')).toBeUndefined();
  });

  it('se a busca pela foto falhar, também para — não se sabe se já havia foto', async () => {
    const { garantirFotoDoErp, fake } = await carregarServico({
      order_erp_sync: [
        { data: [], error: null }, // a tabela existe
        SOLUCO, // a busca pela foto falha
      ],
      // O pedido existe: sem a checagem da busca, a foto sairia e seria gravada.
      orders: { data: PEDIDO_LANCADO, error: null },
    });

    expect(await garantirFotoDoErp({ id: 'o1', status: 'sent_erp' }, EMPRESA)).toBe('falhou');
    expect(fake.ultimaGravacao('order_erp_sync', 'insert')).toBeUndefined();
  });

  it('tabela que NÃO existe continua deixando a edição passar, como antes da 046', async () => {
    const { garantirFotoDoErp } = await carregarServico({ order_erp_sync: SEM_A_TABELA });
    expect(await garantirFotoDoErp({ id: 'o1', status: 'sent_erp' }, EMPRESA)).toBe('sem_tabela');
  });
});

describe('pedirAtualizacao — a impressão do pedido no momento do aviso', () => {
  const PEDIDO_NO_BANCO = {
    id: 'o1',
    invoiced: false,
    discount_percent: 0,
    payment_condition_id: null,
    notes: null,
    items: [{ id: 'i1', order_id: 'o1', product_id: 'p1', variant_id: null, quantity: 6, unit_price: 10, total: 60 }],
  };
  const LINHA_LIDA = {
    erp_order_id: 'CS17379',
    total: 120,
    pecas: 12,
    snapshot: PEDIDO_LANCADO,
    confirmado_em: '2026-09-15T10:00:00Z',
    pedido_em: '2026-09-15T11:00:00Z',
    observacao: null,
  };

  it('guarda a impressão calculada do BANCO, não do aparelho', async () => {
    const { assinaturaDoPedido } = await import('@csb/shared');
    const { pedirAtualizacao, fake } = await carregarServico({
      order_erp_sync: [
        { data: [], error: null }, // a tabela existe
        { data: [], error: null }, // espaço da antecipação do dublê
        { data: { order_id: 'o1' }, error: null }, // já lançado
        { data: [], error: null }, // espaço
        { data: [], error: null }, // a coluna assinatura_pedida existe
        { data: LINHA_LIDA, error: null }, // o update, e a leitura final
      ],
      orders: { data: PEDIDO_NO_BANCO, error: null },
    });

    expect((await pedirAtualizacao('o1', EMPRESA, 'simone')).ok).toBe(true);
    const gravado = fake.ultimaGravacao('order_erp_sync', 'update')?.valores as Record<string, unknown>;
    expect(gravado.assinatura_pedida).toBe(assinaturaDoPedido(PEDIDO_NO_BANCO));
  });

  it('sem a coluna (tabela criada antes dela), grava o aviso sem ela — e não derruba a gravação', async () => {
    const { pedirAtualizacao, fake } = await carregarServico({
      order_erp_sync: [
        { data: [], error: null },
        { data: [], error: null },
        { data: { order_id: 'o1' }, error: null },
        { data: [], error: null },
        { data: null, error: { message: 'column order_erp_sync.assinatura_pedida does not exist', code: '42703' } },
        { data: LINHA_LIDA, error: null },
      ],
      orders: { data: PEDIDO_NO_BANCO, error: null },
    });

    expect((await pedirAtualizacao('o1', EMPRESA, 'simone')).ok).toBe(true);
    const gravado = fake.ultimaGravacao('order_erp_sync', 'update')?.valores as Record<string, unknown>;
    expect(gravado).not.toHaveProperty('assinatura_pedida');
    expect(gravado.pedido_por).toBe('simone');
  });
});
