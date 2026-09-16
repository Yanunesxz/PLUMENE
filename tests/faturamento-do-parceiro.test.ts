import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { valorDaVenda } from '@csb/shared';
import { criarSupabaseFake, type RespostaTabela } from './supabaseFake.js';

/**
 * A mão do faturamento na API de Parceiro.
 *
 * O ERP do Fábio ainda não usa esta rota — ela existe pronta para o dia em que
 * ele passar a informar o que faturou. É a peça que fecha o desenho: enquanto o
 * pedido não é faturado ele é só intenção, e é o `invoiced` que acende
 * "Aprovado" para o lojista e conta como venda no painel.
 *
 * O que estes testes trancam:
 *   1. um parceiro nunca fatura pedido de outra fábrica;
 *   2. cancelamento limpa o valor junto — senão o painel somaria nota morta;
 *   3. valor zerado ou negativo é recusado, nunca gravado;
 *   4. a rota aguenta rodar antes da migração 027;
 *   5. (fase 0) reenviar é seguro: ausente mantém, nada mudou não grava;
 *   6. (fase 0) momento sem fuso e pedido não aprovado são recusados;
 *   7. (fase 0) a nota e as peças que ela levou ficam guardadas (048).
 */

const EMPRESA = 'empresa-1';

async function servico(respostas: Record<string, unknown>) {
  const fake = criarSupabaseFake(respostas as never);
  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
  const mod = await import('../apps/api/src/modules/partner/partner.faturamento.service.js');
  return { receberFaturamento: mod.receberFaturamento, fake };
}

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.doUnmock('../apps/api/src/config/supabase.js');
  vi.doUnmock('../apps/api/src/lib/detectarColuna.js');
  vi.doUnmock('../apps/api/src/modules/orders/pedidoOriginal.service.js');
  vi.doUnmock('../apps/api/src/modules/orders/orders.service.js');
  vi.doUnmock('../apps/api/src/modules/push/push.avisos.js');
});

describe('o ERP informa o que faturou', () => {
  it('grava o faturamento e o valor da nota', async () => {
    const { receberFaturamento, fake } = await servico({
      orders: [
        { data: [{ invoiced_total: null }], error: null }, // detector da 027
        { data: { id: 'o1', invoiced: false, total: 1000, status: 'approved' }, error: null },
      ],
    });

    const r = await receberFaturamento(EMPRESA, [
      { pedido_erp: '9001', faturado: true, valor_faturado: 870.5 },
    ]);

    expect(r.atualizados).toBe(1);
    expect(r.ignorados).toEqual([]);
    const gravado = fake.ultimaGravacao('orders', 'update')?.valores as Record<string, unknown>;
    expect(gravado['invoiced']).toBe(true);
    expect(gravado['invoiced_total']).toBe(870.5);
  });

  it('sempre filtra pela empresa da chave — parceiro não fatura pedido alheio', async () => {
    const { receberFaturamento, fake } = await servico({
      orders: [
        { data: [{ invoiced_total: null }], error: null },
        { data: { id: 'o1', invoiced: false, total: 100, status: 'approved' }, error: null },
      ],
    });

    await receberFaturamento(EMPRESA, [{ pedido_erp: '9001' }]);

    const porEmpresa = fake
      .filtrosDe('orders', 'eq')
      .filter((f) => f.args[0] === 'company_id' && f.args[1] === EMPRESA);
    expect(porEmpresa.length).toBeGreaterThan(0);
  });

  it('cancelar limpa a data e o valor — senão o painel somaria nota que não existe', async () => {
    const { receberFaturamento, fake } = await servico({
      orders: [
        { data: [{ invoiced_total: null }], error: null },
        { data: { id: 'o1', invoiced: true, total: 100, status: 'approved' }, error: null },
      ],
    });

    await receberFaturamento(EMPRESA, [{ pedido_erp: '9001', faturado: false }]);

    const gravado = fake.ultimaGravacao('orders', 'update')?.valores as Record<string, unknown>;
    expect(gravado['invoiced']).toBe(false);
    expect(gravado['invoiced_at']).toBeNull();
    expect(gravado['invoiced_total']).toBeNull();
  });

  it('recusa valor zerado — cancelamento se diz com faturado:false, não zerando', async () => {
    const { receberFaturamento } = await servico({
      orders: [
        { data: [{ invoiced_total: null }], error: null },
        { data: { id: 'o1', invoiced: false, total: 100, status: 'approved' }, error: null },
      ],
    });

    const r = await receberFaturamento(EMPRESA, [{ pedido_erp: '9001', valor_faturado: 0 }]);
    expect(r.atualizados).toBe(0);
    expect(r.ignorados[0]?.motivo).toContain('maior que zero');
  });

  it('recusa data inválida em vez de gravar lixo', async () => {
    const { receberFaturamento } = await servico({
      orders: [
        { data: [{ invoiced_total: null }], error: null },
        { data: { id: 'o1', invoiced: false, total: 100, status: 'approved' }, error: null },
      ],
    });

    const r = await receberFaturamento(EMPRESA, [{ pedido_erp: '9001', faturado_em: 'ontem' }]);
    expect(r.atualizados).toBe(0);
    expect(r.ignorados[0]?.motivo).toContain('ISO');
  });

  it('reporta o pedido sem identificação em vez de estourar', async () => {
    const { receberFaturamento } = await servico({ orders: { data: null, error: null } });
    const r = await receberFaturamento(EMPRESA, [{ faturado: true }]);
    expect(r.recebidos).toBe(1);
    expect(r.atualizados).toBe(0);
    expect(r.ignorados[0]?.motivo).toContain('pedido_erp');
  });

  it('reporta pedido inexistente sem derrubar o lote inteiro', async () => {
    const { receberFaturamento } = await servico({
      orders: [
        { data: [{ invoiced_total: null }], error: null },
        { data: null, error: null },
      ],
    });
    const r = await receberFaturamento(EMPRESA, [{ pedido_erp: 'nao-existe' }]);
    expect(r.ignorados[0]?.motivo).toContain('não encontrado');
  });

  it('funciona antes da migração 027 — só ignora o valor corrigido', async () => {
    const { receberFaturamento, fake } = await servico({
      orders: [
        // Detector: a coluna ainda não existe.
        { data: null, error: { message: 'column orders.invoiced_total does not exist' } },
        { data: { id: 'o1', invoiced: false, total: 100, status: 'approved' }, error: null },
      ],
    });

    const r = await receberFaturamento(EMPRESA, [{ pedido_erp: '9001', valor_faturado: 80 }]);

    expect(r.atualizados).toBe(1);
    const gravado = fake.ultimaGravacao('orders', 'update')?.valores as Record<string, unknown>;
    expect(gravado['invoiced']).toBe(true);
    expect('invoiced_total' in gravado).toBe(false);
  });

  it('`id` sem forma de UUID (22P02) é "pedido não encontrado", não "falha ao buscar"', async () => {
    // "falha ao buscar" manda o ERP reenviar na próxima rodada — e ele reenviaria
    // o mesmo id errado para sempre. Id malformado é 4xx de verdade.
    const { receberFaturamento } = await servico({
      orders: [
        { data: [{ invoiced_total: null }], error: null },
        { data: null, error: { message: 'invalid input syntax for type uuid: "abc"', code: '22P02' } },
      ],
    });

    const r = await receberFaturamento(EMPRESA, [{ id: 'abc' }]);

    expect(r.atualizados).toBe(0);
    expect(r.ignorados).toEqual([{ pedido: 'abc', motivo: 'pedido não encontrado nesta empresa' }]);
  });
});

/**
 * Os seis motivos de `ignorados` são contrato publicado (docs/API-PARCEIRO.md e
 * api-parceiro.html): o parser do Fábio decide por eles. Texto exato, com acento.
 */
describe('os seis motivos de ignorado, letra por letra', () => {
  const PEDIDO = { data: { id: 'o1', invoiced: false, total: 100, status: 'approved' }, error: null };
  const SONDA = { data: [{ invoiced_total: null }], error: null };
  // Linha de enchimento: o dublê pré-busca a próxima resposta a cada consulta.
  // No "erro ao gravar" a foto da 044 (guardarOriginal) também lê `orders`.
  const VAZIO = { data: [], error: null };

  it.each<[string, Record<string, unknown>, RegExp | string, Array<{ data: unknown; error: unknown }>]>([
    ['sem identificação', {}, 'informe "pedido_erp" ou "id"', [SONDA]],
    ['erro na busca', { pedido_erp: 'CS17379' }, /^falha ao buscar: timeout$/, [SONDA, { data: null, error: { message: 'timeout' } }]],
    ['pedido inexistente', { pedido_erp: 'CS17379' }, 'pedido não encontrado nesta empresa', [SONDA, { data: null, error: null }]],
    ['data inválida', { pedido_erp: 'CS17379', faturado_em: 'ontem' }, '"faturado_em" não é uma data ISO', [SONDA, PEDIDO]],
    ['valor zerado', { pedido_erp: 'CS17379', valor_faturado: 0 }, '"valor_faturado" precisa ser maior que zero', [SONDA, PEDIDO]],
    ['erro ao gravar', { pedido_erp: 'CS17379' }, /^falha ao gravar: caiu$/, [SONDA, VAZIO, PEDIDO, VAZIO, PEDIDO, VAZIO, { data: null, error: { message: 'caiu' } }]],
  ])('%s', async (_nome, item, motivo, orders) => {
    const { receberFaturamento } = await servico({ orders });

    const r = await receberFaturamento(EMPRESA, [item]);

    expect(r.ignorados).toHaveLength(1);
    if (typeof motivo === 'string') expect(r.ignorados[0]!.motivo).toBe(motivo);
    else expect(r.ignorados[0]!.motivo).toMatch(motivo);
  });
});

describe('quanto o pedido vale como venda', () => {
  it('vale a NOTA quando o ERP informou', () => {
    expect(valorDaVenda({ total: 1000, invoiced_total: 870.5 })).toBe(870.5);
  });

  it('cai para o total do pedido enquanto o ERP não informa', () => {
    expect(valorDaVenda({ total: 1000, invoiced_total: null })).toBe(1000);
    expect(valorDaVenda({ total: 1000 })).toBe(1000);
  });

  it('a nota costuma ser MENOR — o que faltou no estoque não é faturado', () => {
    const pedido = { total: 1000, invoiced_total: 870.5 };
    expect(valorDaVenda(pedido)).toBeLessThan(pedido.total);
  });

  it('pedido sem total nenhum vale zero, não NaN', () => {
    expect(valorDaVenda({})).toBe(0);
  });
});

// ─── Fase 0: reenvio seguro, fuso, situação, notas e peças ───────────────────

/**
 * O serviço com as sondas de schema, a foto da 044, a última compra e o push
 * trocados por dublês — assim cada teste registra só as respostas das
 * consultas que importam, e confere o que foi chamado e em que ordem.
 */
async function servicoDaFase0(
  respostas: Record<string, RespostaTabela | RespostaTabela[]>,
  opcoes: { ausentes?: string[]; avisoLanca?: boolean; soluco?: string[] } = {},
) {
  const fake = criarSupabaseFake(respostas);
  const ausentes = new Set(opcoes.ausentes ?? []);
  /** Sondas em que o banco "não respondeu": `detectar` diz não, `detectarOuFalhar` lança. */
  const soluco = new Set(opcoes.soluco ?? []);
  const chave = (tabela: string, coluna?: string) => (coluna ? `${tabela}.${coluna}` : tabela);
  const existe = (tabela: string, coluna?: string) =>
    !ausentes.has(chave(tabela, coluna)) && !soluco.has(chave(tabela, coluna));
  const chamadas = {
    /** Quantas gravações já tinham acontecido quando a foto da 044 foi pedida. */
    original: [] as number[],
    compra: [] as unknown[][],
    aviso: [] as unknown[][],
  };

  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
  vi.doMock('../apps/api/src/lib/detectarColuna.js', () => ({
    detectar: async (t: string, c?: string) => existe(t, c),
    detectarOuFalhar: async (t: string, c?: string) => {
      if (soluco.has(chave(t, c))) throw new Error(`Falha ao sondar ${chave(t, c)}: o banco não respondeu sobre o schema`);
      return existe(t, c);
    },
    detectarComCerteza: async (t: string, c?: string) =>
      soluco.has(chave(t, c)) ? 'nao_sei' : existe(t, c) ? 'existe' : 'nao_existe',
    esquecerDeteccoes: () => undefined,
  }));
  vi.doMock('../apps/api/src/modules/orders/pedidoOriginal.service.js', () => ({
    guardarOriginal: async () => {
      chamadas.original.push(fake.gravacoes.length);
      return 'guardada';
    },
    lerOriginal: async () => null,
  }));
  vi.doMock('../apps/api/src/modules/orders/orders.service.js', () => ({
    registrarCompraDoCliente: async (...args: unknown[]) => {
      chamadas.compra.push(args);
    },
  }));
  vi.doMock('../apps/api/src/modules/push/push.avisos.js', () => ({
    avisarFaturadoAoRep: (...args: unknown[]) => {
      chamadas.aviso.push(args);
      if (opcoes.avisoLanca) throw new Error('push fora do ar');
    },
  }));

  const mod = await import('../apps/api/src/modules/partner/partner.faturamento.service.js');
  return { ...mod, fake, chamadas };
}

/**
 * Fila de respostas para várias consultas seguidas na MESMA tabela: o dublê
 * adianta uma resposta a cada consulta, então entre duas respostas vai uma
 * linha de enchimento.
 */
function fila(...respostas: RespostaTabela[]): RespostaTabela[] {
  return respostas.flatMap((r, i) => (i === 0 ? [r] : [{ data: null, error: null }, r]));
}

const NADA: RespostaTabela = { data: null, error: null };

/** Pedido fictício aprovado e ainda não faturado. */
const APROVADO = {
  id: 'o1',
  status: 'approved',
  invoiced: false,
  invoiced_at: null,
  invoiced_total: null,
  customer_id: 'cliente-teste',
  order_number: 14600,
  rep_id: 'rep-teste',
  guest_name: null,
};

/** O mesmo pedido já faturado pelo ERP: 13/08 às 14:02 em Brasília, R$ 870,50. */
const FATURADO = {
  ...APROVADO,
  invoiced: true,
  invoiced_at: '2026-08-13T17:02:00+00:00',
  invoiced_total: 870.5,
};

const pedidoNoBanco = (p: Record<string, unknown>): RespostaTabela => ({ data: p, error: null });

function updateDoPedido(fake: { ultimaGravacao: (t: string, o?: 'update') => { valores: unknown } | undefined }) {
  return fake.ultimaGravacao('orders', 'update')?.valores as Record<string, unknown> | undefined;
}

function eventos(fake: { gravacoes: Array<{ tabela: string; operacao: string; valores: unknown }> }) {
  return fake.gravacoes
    .filter((g) => g.tabela === 'order_erp_events' && g.operacao === 'insert')
    .map((g) => g.valores as Record<string, unknown>);
}

describe('reenviar é seguro: ausente mantém, nada mudou não grava', () => {
  it('reenvio idêntico não grava nada e conta em "inalterados"', async () => {
    const { receberFaturamento, fake, chamadas } = await servicoDaFase0({ orders: pedidoNoBanco(FATURADO) });

    const r = await receberFaturamento(EMPRESA, [
      { pedido_erp: 'ZZ0000001', faturado_em: '2026-08-13T14:02:00-03:00', valor_faturado: 870.5 },
    ]);

    expect(r).toMatchObject({ recebidos: 1, atualizados: 0, inalterados: 1, ignorados: [] });
    expect(fake.gravacoes).toEqual([]);
    expect(chamadas.original).toEqual([]);
    expect(chamadas.compra).toEqual([]);
    expect(chamadas.aviso).toEqual([]);
  });

  it('reenvio só com o número, em pedido já faturado, também é inalterado', async () => {
    const { receberFaturamento, fake } = await servicoDaFase0({ orders: pedidoNoBanco(FATURADO) });

    const r = await receberFaturamento(EMPRESA, [{ pedido_erp: 'ZZ0000001' }]);

    expect(r.inalterados).toBe(1);
    expect(fake.gravacoes).toEqual([]);
  });

  it('valor novo sem "faturado_em": grava só o valor, a data da nota fica', async () => {
    const { receberFaturamento, fake, chamadas } = await servicoDaFase0({ orders: pedidoNoBanco(FATURADO) });

    const r = await receberFaturamento(EMPRESA, [{ pedido_erp: 'ZZ0000001', valor_faturado: 800 }], {
      parceiro: 'Control Teste',
    });

    expect(r.atualizados).toBe(1);
    const gravado = updateDoPedido(fake)!;
    expect(Object.keys(gravado).sort()).toEqual(['invoiced_total', 'updated_at']);
    expect(gravado['invoiced_total']).toBe(800);
    expect(eventos(fake).map((e) => e['tipo'])).toEqual(['faturamento_alterado']);
    expect(eventos(fake)[0]).toMatchObject({ origem: 'api', parceiro: 'Control Teste', order_id: 'o1' });
    // Não é compra nova nem notícia nova.
    expect(chamadas.compra).toEqual([]);
    expect(chamadas.aviso).toEqual([]);
  });

  it('"valor_faturado": null explícito limpa o valor (e não mexe na data)', async () => {
    const { receberFaturamento, fake } = await servicoDaFase0({ orders: pedidoNoBanco(FATURADO) });

    await receberFaturamento(EMPRESA, [{ pedido_erp: 'ZZ0000001', valor_faturado: null }]);

    const gravado = updateDoPedido(fake)!;
    expect(gravado['invoiced_total']).toBeNull();
    expect('invoiced_at' in gravado).toBe(false);
  });

  it('pedido ainda não faturado sem "faturado_em" fatura agora', async () => {
    const { receberFaturamento, fake } = await servicoDaFase0({ orders: pedidoNoBanco(APROVADO) });
    const antes = Date.now();

    await receberFaturamento(EMPRESA, [{ pedido_erp: 'ZZ0000001' }]);

    const gravado = updateDoPedido(fake)!;
    expect(gravado['invoiced']).toBe(true);
    expect(Date.parse(String(gravado['invoiced_at']))).toBeGreaterThanOrEqual(antes - 1000);
    // Valor ausente em pedido novo: não manda a coluna.
    expect('invoiced_total' in gravado).toBe(false);
  });
});

describe('momento com fuso e só pedido aprovado ou enviado ao ERP', () => {
  it.each(['2026-08-13T14:02:00', '2026-08-13'])('"%s" sem fuso é recusado', async (faturado_em) => {
    const { receberFaturamento, fake } = await servicoDaFase0({ orders: pedidoNoBanco(APROVADO) });

    const r = await receberFaturamento(EMPRESA, [{ pedido_erp: 'ZZ0000001', faturado_em }]);

    expect(r.ignorados).toEqual([
      { pedido: 'ZZ0000001', motivo: '"faturado_em" precisa de fuso (Z ou -03:00)' },
    ]);
    expect(fake.gravacoes).toEqual([]);
  });

  it.each(['2026-08-13T17:02:00Z', '2026-08-13T14:02:00-03:00', '2026-08-13T14:02:00.000-03:00'])(
    '"%s" passa',
    async (faturado_em) => {
      const { receberFaturamento, fake } = await servicoDaFase0({ orders: pedidoNoBanco(APROVADO) });

      const r = await receberFaturamento(EMPRESA, [{ pedido_erp: 'ZZ0000001', faturado_em }]);

      expect(r.atualizados).toBe(1);
      expect(updateDoPedido(fake)!['invoiced_at']).toBe(faturado_em);
    },
  );

  it.each(['draft', 'pending_approval', 'rejected'])('pedido "%s" é ignorado com a situação', async (status) => {
    const { receberFaturamento, fake } = await servicoDaFase0({ orders: pedidoNoBanco({ ...APROVADO, status }) });

    const r = await receberFaturamento(EMPRESA, [{ pedido_erp: 'ZZ0000001' }]);

    expect(r.ignorados).toEqual([
      { pedido: 'ZZ0000001', motivo: 'pedido não está aprovado nem enviado ao ERP', situacao: status },
    ]);
    expect(fake.gravacoes).toEqual([]);
  });

  it('pedido enviado ao ERP fatura', async () => {
    const { receberFaturamento } = await servicoDaFase0({
      orders: pedidoNoBanco({ ...APROVADO, status: 'sent_erp' }),
    });

    const r = await receberFaturamento(EMPRESA, [{ pedido_erp: 'ZZ0000001' }]);

    expect(r.atualizados).toBe(1);
  });
});

describe('a transição para faturado', () => {
  it('empurra a última compra pelo DIA de Brasília, avisa o representante uma vez e deixa rastro', async () => {
    const { receberFaturamento, fake, chamadas } = await servicoDaFase0({ orders: pedidoNoBanco(APROVADO) });

    // 01:30 de 14/08 em UTC = 22:30 de 13/08 em São Paulo.
    await receberFaturamento(EMPRESA, [{ pedido_erp: 'ZZ0000001', faturado_em: '2026-08-14T01:30:00Z' }], {
      parceiro: 'Control Teste',
    });

    expect(chamadas.compra).toEqual([['cliente-teste', '2026-08-13', EMPRESA]]);
    expect(chamadas.aviso).toEqual([
      [EMPRESA, { id: 'o1', order_number: 14600, rep_id: 'rep-teste', guest_name: null }, 'api-parceiro'],
    ]);
    // A foto da 044 antes de qualquer gravação.
    expect(chamadas.original).toEqual([0]);
    const [evento] = eventos(fake);
    expect(evento).toMatchObject({ tipo: 'faturado', origem: 'api', parceiro: 'Control Teste' });
    expect(evento?.['depois']).toMatchObject({ invoiced: true, invoiced_at: '2026-08-14T01:30:00Z' });
  });

  it('o aviso ao representante que falha não derruba a rota', async () => {
    const { receberFaturamento, chamadas } = await servicoDaFase0(
      { orders: pedidoNoBanco(APROVADO) },
      { avisoLanca: true },
    );

    const r = await receberFaturamento(EMPRESA, [{ pedido_erp: 'ZZ0000001' }]);

    expect(chamadas.aviso).toHaveLength(1);
    expect(r).toMatchObject({ atualizados: 1, ignorados: [] });
  });

  it('desfazer limpa data e valor, cancela as notas ativas e não recua a última compra', async () => {
    const { receberFaturamento, fake, chamadas } = await servicoDaFase0({
      orders: pedidoNoBanco(FATURADO),
      order_invoices: fila(
        { data: [{ id: 'n1', numero: '123', serie: '1' }], error: null }, // notas ativas
        NADA, // o cancelamento
      ),
    });

    const r = await receberFaturamento(EMPRESA, [{ pedido_erp: 'ZZ0000001', faturado: false }]);

    expect(r.atualizados).toBe(1);
    const pedido = updateDoPedido(fake)!;
    expect(pedido).toMatchObject({ invoiced: false, invoiced_at: null, invoiced_total: null });
    const cancelamento = fake.ultimaGravacao('order_invoices', 'update')?.valores as Record<string, unknown>;
    expect(typeof cancelamento['cancelada_em']).toBe('string');
    expect(fake.filtrosDe('order_invoices', 'is')[0]?.args).toEqual(['cancelada_em', null]);
    // A nota cancelada é registrada logo depois de gravada, antes do pedido.
    expect(eventos(fake).map((e) => e['tipo'])).toEqual(['nota_cancelada', 'faturamento_desfeito']);
    expect(chamadas.compra).toEqual([]);
    expect(chamadas.aviso).toEqual([]);
    expect(chamadas.original).toEqual([]);
  });

  it('desfazer o que já estava desfeito não grava nada', async () => {
    const { receberFaturamento, fake } = await servicoDaFase0({
      orders: pedidoNoBanco(APROVADO),
      order_invoices: { data: [], error: null },
    });

    const r = await receberFaturamento(EMPRESA, [{ pedido_erp: 'ZZ0000001', faturado: false }]);

    expect(r.inalterados).toBe(1);
    expect(fake.gravacoes).toEqual([]);
  });
});

describe('a nota fiscal e as peças que ela levou (048)', () => {
  const NOTA = {
    numero: '000123',
    serie: '1',
    chave: '0000',
    emitida_em: '2026-08-13T14:02:00-03:00',
    valor: 150,
  };

  it('nota nova: grava a nota, as peças com a variante do catálogo e toca o pedido', async () => {
    const { receberFaturamento, fake, chamadas } = await servicoDaFase0({
      orders: pedidoNoBanco(APROVADO),
      order_invoices: fila(NADA /* ainda não existe */, { data: { id: 'n1' }, error: null } /* upsert */),
      product_variants: fila(
        { data: [{ id: 'v1', erp_sku: '0124|M' }], error: null }, // pelo erp_sku
        { data: [{ id: 'v9', product_id: 'p9', size: 'G' }], error: null }, // pelo produto + tamanho
      ),
      products: { data: [{ id: 'p9', erp_id: '0777' }], error: null },
      order_invoice_items: NADA,
    });

    const r = await receberFaturamento(
      EMPRESA,
      [
        {
          pedido_erp: 'ZZ0000001',
          faturado_em: '2026-08-13T14:02:00-03:00',
          valor_faturado: 150,
          nota: NOTA,
          itens: [
            { produto: '0124', tamanho: 'm', quantidade: 4, preco_unitario: 24.9 },
            { produto: '0777', tamanho: 'G', quantidade: 2 },
            { produto: '9999', tamanho: 'P', quantidade: 1 },
          ],
        },
      ],
      { parceiro: 'Control Teste' },
    );

    expect(r).toMatchObject({ atualizados: 1, inalterados: 0, ignorados: [] });
    expect(r.avisos).toEqual([
      { pedido: 'ZZ0000001', aviso: 'peça 9999 tamanho P sem variante no catálogo: guardada sem vínculo' },
    ]);

    const nota = fake.ultimaGravacao('order_invoices', 'upsert')?.valores as Record<string, unknown>;
    expect(nota).toMatchObject({
      company_id: EMPRESA,
      order_id: 'o1',
      numero: '000123',
      serie: '1',
      chave: '0000',
      emitida_em: '2026-08-13T14:02:00-03:00',
      valor: 150,
      cancelada_em: null,
      origem: 'api',
    });

    const pecas = fake.ultimaGravacao('order_invoice_items', 'insert')?.valores as Array<Record<string, unknown>>;
    expect(pecas.map((p) => [p['produto'], p['tamanho'], p['variant_id'], p['quantidade'], p['preco_unitario']])).toEqual([
      ['0124', 'M', 'v1', 4, 24.9],
      ['0777', 'G', 'v9', 2, null],
      ['9999', 'P', null, 1, null],
    ]);
    expect(pecas.every((p) => p['invoice_id'] === 'n1' && p['order_id'] === 'o1' && p['company_id'] === EMPRESA)).toBe(true);
    // Só as peças DAQUELA nota são substituídas.
    const apagou = fake.filtrosDe('order_invoice_items', 'eq').map((f) => f.args);
    expect(apagou).toContainEqual(['invoice_id', 'n1']);
    expect(apagou).toContainEqual(['company_id', EMPRESA]);

    // Ordem: foto da 044 → nota → peças → pedido.
    expect(chamadas.original).toEqual([0]);
    const ordem = fake.gravacoes.filter((g) => g.tabela !== 'order_erp_events').map((g) => `${g.tabela}.${g.operacao}`);
    expect(ordem).toEqual([
      'order_invoices.upsert',
      'order_invoice_items.delete',
      'order_invoice_items.insert',
      'orders.update',
    ]);
    expect(updateDoPedido(fake)).toMatchObject({ invoiced: true, invoiced_total: 150 });

    const tipos = eventos(fake).map((e) => e['tipo']);
    expect(tipos).toEqual(['nota_registrada', 'faturado']);
    expect(eventos(fake)[0]?.['depois']).toMatchObject({ numero: '000123', serie: '1', pecas: 7 });
  });

  it('número em texto ("870.50", "2") é aceito na nota e nas peças, como no valor_faturado', async () => {
    // Muito ERP manda NUMERIC como texto. Exigir número JSON só na nota faria o
    // MESMO registro ser aceito no valor_faturado e recusado na nota — e a
    // recusa derruba o registro inteiro, faturamento junto.
    const { receberFaturamento, fake } = await servicoDaFase0({
      orders: pedidoNoBanco(APROVADO),
      order_invoices: fila(NADA, { data: { id: 'n1' }, error: null }),
      product_variants: fila({ data: [{ id: 'v1', erp_sku: '0124|M' }], error: null }, { data: [], error: null }),
      products: { data: [], error: null },
      order_invoice_items: NADA,
    });

    const r = await receberFaturamento(EMPRESA, [
      {
        pedido_erp: 'ZZ0000001',
        valor_faturado: '870.50',
        nota: { numero: '000123', valor: '870.50' },
        itens: [{ produto: '0124', tamanho: 'M', quantidade: '2', preco_unitario: '24.90' }],
      },
    ]);

    expect(r.ignorados).toEqual([]);
    expect(r.atualizados).toBe(1);
    expect(fake.ultimaGravacao('order_invoices', 'upsert')?.valores).toMatchObject({ valor: 870.5 });
    const pecas = fake.ultimaGravacao('order_invoice_items', 'insert')?.valores as Array<Record<string, unknown>>;
    expect(pecas[0]).toMatchObject({ quantidade: 2, preco_unitario: 24.9 });
    expect(updateDoPedido(fake)).toMatchObject({ invoiced_total: 870.5 });
  });

  it('texto que não é número continua recusado, com o motivo de sempre', async () => {
    const { receberFaturamento, fake } = await servicoDaFase0({ orders: pedidoNoBanco(APROVADO) });

    const r = await receberFaturamento(EMPRESA, [
      { pedido_erp: 'ZZ0000001', nota: { numero: '000123', valor: 'muito' } },
    ]);

    expect(r.ignorados).toEqual([{ pedido: 'ZZ0000001', motivo: '"nota.valor" precisa ser maior que zero' }]);
    expect(fake.gravacoes).toEqual([]);
  });

  it('o pedido falhou depois da nota: a nota fica com o rastro, o ERP reenvia e só o pedido grava', async () => {
    const { receberFaturamento, fake } = await servicoDaFase0({
      orders: fila(pedidoNoBanco(APROVADO), { data: null, error: { message: 'caiu' } }),
      order_invoices: fila(NADA, { data: { id: 'n1' }, error: null }),
    });

    const r = await receberFaturamento(EMPRESA, [{ pedido_erp: 'ZZ0000001', nota: { numero: '000123' } }]);

    expect(r.ignorados).toEqual([{ pedido: 'ZZ0000001', motivo: 'falha ao gravar: caiu' }]);
    expect(eventos(fake).map((e) => e['tipo'])).toEqual(['nota_registrada']);
  });

  it('a mesma nota com as mesmas peças, reenviada, não grava nada', async () => {
    const { receberFaturamento, fake } = await servicoDaFase0({
      orders: pedidoNoBanco({ ...FATURADO, invoiced_total: 150 }),
      order_invoices: {
        data: { id: 'n1', chave: '0000', emitida_em: '2026-08-13T17:02:00+00:00', valor: '150.00', cancelada_em: null },
        error: null,
      },
      product_variants: { data: [{ id: 'v1', erp_sku: '0124|M' }], error: null },
      order_invoice_items: {
        data: [{ produto: '0124', tamanho: 'M', variant_id: 'v1', quantidade: 4, preco_unitario: '24.90' }],
        error: null,
      },
    });

    const r = await receberFaturamento(EMPRESA, [
      {
        pedido_erp: 'ZZ0000001',
        faturado_em: '2026-08-13T14:02:00-03:00',
        valor_faturado: 150,
        nota: NOTA,
        itens: [{ produto: '0124', tamanho: 'M', quantidade: 4, preco_unitario: 24.9 }],
      },
    ]);

    expect(r).toMatchObject({ atualizados: 0, inalterados: 1, ignorados: [], avisos: [] });
    expect(fake.gravacoes).toEqual([]);
  });

  it('peças diferentes na mesma nota: substitui só as dela e toca o updated_at do pedido', async () => {
    const { receberFaturamento, fake, chamadas } = await servicoDaFase0({
      orders: pedidoNoBanco({ ...FATURADO, invoiced_total: 150 }),
      order_invoices: {
        data: { id: 'n1', chave: '0000', emitida_em: '2026-08-13T17:02:00+00:00', valor: 150, cancelada_em: null },
        error: null,
      },
      product_variants: { data: [{ id: 'v1', erp_sku: '0124|M' }], error: null },
      order_invoice_items: fila(
        { data: [{ produto: '0124', tamanho: 'M', variant_id: 'v1', quantidade: 4, preco_unitario: 24.9 }], error: null },
        NADA, // delete
        NADA, // insert
      ),
    });

    const r = await receberFaturamento(EMPRESA, [
      {
        pedido_erp: 'ZZ0000001',
        nota: NOTA,
        itens: [{ produto: '0124', tamanho: 'M', quantidade: 3, preco_unitario: 24.9 }],
      },
    ]);

    expect(r.atualizados).toBe(1);
    expect(fake.ultimaGravacao('order_invoices')).toBeUndefined();
    const pecas = fake.ultimaGravacao('order_invoice_items', 'insert')?.valores as Array<Record<string, unknown>>;
    expect(pecas).toHaveLength(1);
    expect(pecas[0]).toMatchObject({ invoice_id: 'n1', quantidade: 3 });
    expect(Object.keys(updateDoPedido(fake)!)).toEqual(['updated_at']);
    expect(eventos(fake).map((e) => e['tipo'])).toEqual(['nota_registrada']);
    // Já estava faturado: nem compra nova, nem aviso novo.
    expect(chamadas.compra).toEqual([]);
    expect(chamadas.aviso).toEqual([]);
  });

  it('campo da nota que não veio não apaga; null explícito limpa', async () => {
    const { receberFaturamento, fake } = await servicoDaFase0({
      orders: pedidoNoBanco({ ...FATURADO, invoiced_total: 150 }),
      order_invoices: fila(
        {
          data: { id: 'n1', chave: '0000', emitida_em: '2026-08-13T17:02:00+00:00', valor: 150, cancelada_em: null },
          error: null,
        },
        NADA,
      ),
    });

    await receberFaturamento(EMPRESA, [{ pedido_erp: 'ZZ0000001', nota: { numero: '000123', serie: '1', chave: null } }]);

    const patch = fake.ultimaGravacao('order_invoices', 'update')?.valores as Record<string, unknown>;
    expect(Object.keys(patch).sort()).toEqual(['chave', 'updated_at']);
    expect(patch['chave']).toBeNull();
  });

  it('sem a 048: nota e peças ficam de fora com aviso, e o faturamento grava', async () => {
    const { receberFaturamento, fake } = await servicoDaFase0(
      { orders: pedidoNoBanco(APROVADO) },
      { ausentes: ['order_invoices.id', 'order_invoice_items.id', 'order_erp_events.id'] },
    );

    const r = await receberFaturamento(EMPRESA, [
      { pedido_erp: 'ZZ0000001', nota: NOTA, itens: [{ produto: '0124', tamanho: 'M', quantidade: 4 }] },
    ]);

    expect(r).toMatchObject({ atualizados: 1, ignorados: [] });
    expect(r.avisos).toEqual([
      { pedido: 'ZZ0000001', aviso: 'notas e itens faturados ficam guardados depois da migração 048' },
    ]);
    expect(fake.gravacoes.map((g) => `${g.tabela}.${g.operacao}`)).toEqual(['orders.update']);
    expect(updateDoPedido(fake)).toMatchObject({ invoiced: true });
  });

  it.each<[string, Record<string, unknown>]>([
    ['nota com peças', { faturado: true }],
    ['faturamento desfeito', { faturado: false }],
  ])('%s com o banco sem responder sobre a 048: registro ignorado para reenvio, nada gravado', async (_nome, extra) => {
    const pedido = extra['faturado'] === false ? FATURADO : APROVADO;
    const { receberFaturamento, fake } = await servicoDaFase0(
      { orders: pedidoNoBanco(pedido) },
      { soluco: ['order_invoices.id'] },
    );

    const r = await receberFaturamento(EMPRESA, [
      extra['faturado'] === false
        ? { pedido_erp: 'ZZ0000001', faturado: false }
        : { pedido_erp: 'ZZ0000001', nota: NOTA, itens: [{ produto: '0124', tamanho: 'M', quantidade: 4 }] },
    ]);

    expect(r.atualizados).toBe(0);
    expect(r.avisos).toEqual([]);
    expect(r.ignorados).toHaveLength(1);
    expect(r.ignorados[0]?.motivo).toMatch(/^falha ao buscar: /);
    expect(fake.gravacoes).toEqual([]);
  });

  it.each<[string, Record<string, unknown>, string]>([
    ['nota sem número', { nota: { serie: '1' } }, '"nota.numero" é obrigatório quando "nota" vem'],
    ['emissão sem fuso', { nota: { numero: '1', emitida_em: '2026-08-13T14:02:00' } }, '"nota.emitida_em" precisa de fuso (Z ou -03:00)'],
    ['valor da nota zerado', { nota: { numero: '1', valor: 0 } }, '"nota.valor" precisa ser maior que zero'],
    ['peças sem nota', { itens: [{ produto: '0124', tamanho: 'M', quantidade: 1 }] }, '"itens" precisa vir junto com "nota" (informe "nota.numero")'],
    ['quantidade zero', { nota: { numero: '1' }, itens: [{ produto: '0124', tamanho: 'M', quantidade: 0 }] }, '"itens[0]" precisa de "produto", "tamanho" e "quantidade" inteira maior que zero'],
    ['quantidade fracionada', { nota: { numero: '1' }, itens: [{ produto: '0124', tamanho: 'M', quantidade: 1.5 }] }, '"itens[0]" precisa de "produto", "tamanho" e "quantidade" inteira maior que zero'],
    ['peça sem tamanho', { nota: { numero: '1' }, itens: [{ produto: '0124', quantidade: 2 }] }, '"itens[0]" precisa de "produto", "tamanho" e "quantidade" inteira maior que zero'],
  ])('%s: o registro inteiro é recusado, nada gravado', async (_nome, extra, motivo) => {
    const { receberFaturamento, fake } = await servicoDaFase0({ orders: pedidoNoBanco(APROVADO) });

    const r = await receberFaturamento(EMPRESA, [{ pedido_erp: 'ZZ0000001', ...extra }]);

    expect(r.ignorados).toEqual([{ pedido: 'ZZ0000001', motivo }]);
    expect(fake.gravacoes).toEqual([]);
  });

  it('erro ao ler a nota é "falha ao buscar" — nada gravado, o ERP reenvia', async () => {
    const { receberFaturamento, fake } = await servicoDaFase0({
      orders: pedidoNoBanco(APROVADO),
      order_invoices: { data: null, error: { message: 'timeout' } },
    });

    const r = await receberFaturamento(EMPRESA, [{ pedido_erp: 'ZZ0000001', nota: NOTA }]);

    expect(r.ignorados).toEqual([{ pedido: 'ZZ0000001', motivo: 'falha ao buscar: timeout' }]);
    expect(fake.gravacoes).toEqual([]);
  });
});

// ─── Uma nota por pedido: a nova substitui a anterior (049) ──────────────────

describe('um pedido tem UMA nota: nota nova substitui a anterior (049)', () => {
  const NOTA_NOVA = { numero: '000124', serie: '1', valor: 140 };
  const ANTIGA = { id: 'n1', numero: '000123', serie: '1' };

  it('nota com número diferente: grava a nova, a antiga fica cancelada e substituída por ela, com o rastro', async () => {
    const { receberFaturamento, fake } = await servicoDaFase0({
      orders: pedidoNoBanco({ ...FATURADO, invoiced_total: 150 }),
      order_invoices: fila(
        NADA, // a nova ainda não existe
        { data: [ANTIGA], error: null }, // as outras ativas do pedido
        { data: { id: 'n2' }, error: null }, // o upsert da nova
        NADA, // a substituição da antiga
      ),
      product_variants: fila({ data: [{ id: 'v1', erp_sku: '0124|M' }], error: null }, { data: [], error: null }),
      products: { data: [], error: null },
      order_invoice_items: NADA,
    });

    const r = await receberFaturamento(
      EMPRESA,
      [{ pedido_erp: 'ZZ0000001', valor_faturado: 140, nota: NOTA_NOVA, itens: [{ produto: '0124', tamanho: 'M', quantidade: 3 }] }],
      { parceiro: 'Control Teste' },
    );

    expect(r).toMatchObject({ atualizados: 1, inalterados: 0, ignorados: [], avisos: [] });

    // A leitura das outras ativas é do pedido, da empresa, sem a própria nota.
    expect(fake.filtrosDe('order_invoices', 'is').map((f) => f.args)).toContainEqual(['cancelada_em', null]);

    const substituicao = fake.gravacoes.filter((g) => g.tabela === 'order_invoices' && g.operacao === 'update');
    expect(substituicao).toHaveLength(1);
    expect(substituicao[0]!.valores).toMatchObject({ substituida_por: 'n2' });
    const valores = substituicao[0]!.valores as Record<string, unknown>;
    expect(typeof valores['cancelada_em']).toBe('string');
    expect(valores['substituida_em']).toBe(valores['cancelada_em']);
    expect(valores['updated_at']).toBe(valores['cancelada_em']);
    // Só as OUTRAS notas ativas do pedido: nunca a nova.
    expect(fake.filtrosDe('order_invoices', 'neq').map((f) => f.args)).toContainEqual(['id', 'n2']);

    // Ordem: nota nova → peças → substituição → pedido.
    const ordem = fake.gravacoes.filter((g) => g.tabela !== 'order_erp_events').map((g) => `${g.tabela}.${g.operacao}`);
    expect(ordem).toEqual([
      'order_invoices.upsert',
      'order_invoice_items.delete',
      'order_invoice_items.insert',
      'order_invoices.update',
      'orders.update',
    ]);
    expect(updateDoPedido(fake)).toMatchObject({ invoiced_total: 140 });

    const tipos = eventos(fake).map((e) => e['tipo']);
    expect(tipos).toEqual(['nota_registrada', 'nota_substituida', 'faturamento_alterado']);
    const substituida = eventos(fake)[1]!;
    expect(substituida).toMatchObject({
      origem: 'api',
      parceiro: 'Control Teste',
      motivo: 'nota 000123 série 1 substituída pela nota 000124 série 1',
      antes: { numero: '000123', serie: '1', cancelada_em: null },
    });
    expect(substituida['depois']).toMatchObject({ numero: '000124', serie: '1' });
    expect(typeof (substituida['depois'] as Record<string, unknown>)['cancelada_em']).toBe('string');
  });

  it('a MESMA nota reenviada (sem outra ativa) continua inalterada', async () => {
    const { receberFaturamento, fake } = await servicoDaFase0({
      orders: pedidoNoBanco({ ...FATURADO, invoiced_total: 150 }),
      order_invoices: fila(
        { data: { id: 'n1', chave: null, emitida_em: null, valor: '150.00', cancelada_em: null }, error: null },
        { data: [], error: null }, // nenhuma outra ativa
      ),
    });

    const r = await receberFaturamento(EMPRESA, [{ pedido_erp: 'ZZ0000001', valor_faturado: 150, nota: { numero: '000123', serie: '1', valor: 150 } }]);

    expect(r).toMatchObject({ atualizados: 0, inalterados: 1, ignorados: [] });
    expect(fake.gravacoes).toEqual([]);
  });

  it('a mesma nota reenviada com OUTRA ativa por perto (reenvio que caiu no meio, ou duas de antes da 049): acerta', async () => {
    const { receberFaturamento, fake } = await servicoDaFase0({
      orders: pedidoNoBanco({ ...FATURADO, invoiced_total: 150 }),
      order_invoices: fila(
        { data: { id: 'n2', chave: null, emitida_em: null, valor: '150.00', cancelada_em: null }, error: null },
        { data: [ANTIGA], error: null },
        NADA,
      ),
    });

    const r = await receberFaturamento(EMPRESA, [{ pedido_erp: 'ZZ0000001', valor_faturado: 150, nota: { numero: '000124', serie: '1', valor: 150 } }]);

    expect(r).toMatchObject({ atualizados: 1, inalterados: 0 });
    expect(fake.ultimaGravacao('order_invoices', 'upsert')).toBeUndefined();
    expect(fake.ultimaGravacao('order_invoices', 'update')?.valores).toMatchObject({ substituida_por: 'n2' });
    expect(eventos(fake).map((e) => e['tipo'])).toEqual(['nota_substituida']);
    // O pedido só ganha o carimbo de alteração.
    expect(Object.keys(updateDoPedido(fake)!)).toEqual(['updated_at']);
  });

  it('a nota substituída que o Control manda de novo volta a valer e tira a outra de cena', async () => {
    const { receberFaturamento, fake } = await servicoDaFase0({
      orders: pedidoNoBanco({ ...FATURADO, invoiced_total: 150 }),
      order_invoices: fila(
        { data: { id: 'n1', chave: null, emitida_em: null, valor: '150.00', cancelada_em: '2026-09-16T12:00:00Z' }, error: null },
        { data: [{ id: 'n2', numero: '000124', serie: '1' }], error: null },
        NADA, // o update da que volta
        NADA, // a substituição da outra
      ),
    });

    const r = await receberFaturamento(EMPRESA, [{ pedido_erp: 'ZZ0000001', nota: { numero: '000123', serie: '1' } }]);

    expect(r.atualizados).toBe(1);
    const updates = fake.gravacoes.filter((g) => g.tabela === 'order_invoices' && g.operacao === 'update').map((g) => g.valores as Record<string, unknown>);
    expect(updates[0]).toMatchObject({ cancelada_em: null, substituida_por: null, substituida_em: null });
    expect(updates[1]).toMatchObject({ substituida_por: 'n1' });
    expect(eventos(fake).map((e) => e['tipo'])).toEqual(['nota_registrada', 'nota_substituida']);
  });

  it('SEM a 049: a nota nova convive com a antiga, como era', async () => {
    const { receberFaturamento, fake } = await servicoDaFase0(
      {
        orders: pedidoNoBanco({ ...FATURADO, invoiced_total: 150 }),
        order_invoices: fila(NADA, { data: { id: 'n2' }, error: null }),
      },
      { ausentes: ['order_invoices.substituida_por'] },
    );

    const r = await receberFaturamento(EMPRESA, [{ pedido_erp: 'ZZ0000001', nota: NOTA_NOVA }]);

    expect(r.atualizados).toBe(1);
    expect(fake.gravacoes.filter((g) => g.tabela === 'order_invoices' && g.operacao === 'update')).toEqual([]);
    expect(eventos(fake).map((e) => e['tipo'])).toEqual(['nota_registrada']);
  });

  it('o banco sem responder sobre a 049: registro ignorado para reenvio, nada gravado', async () => {
    const { receberFaturamento, fake } = await servicoDaFase0(
      { orders: pedidoNoBanco({ ...FATURADO, invoiced_total: 150 }), order_invoices: NADA },
      { soluco: ['order_invoices.substituida_por'] },
    );

    const r = await receberFaturamento(EMPRESA, [{ pedido_erp: 'ZZ0000001', nota: NOTA_NOVA }]);

    expect(r.ignorados).toHaveLength(1);
    expect(r.ignorados[0]?.motivo).toMatch(/^falha ao buscar: /);
    expect(fake.gravacoes).toEqual([]);
  });

  it('a substituição que falha ao gravar é "falha ao gravar a nota" — o reenvio acerta', async () => {
    const { receberFaturamento, fake } = await servicoDaFase0({
      orders: pedidoNoBanco({ ...FATURADO, invoiced_total: 150 }),
      order_invoices: fila(NADA, { data: [ANTIGA], error: null }, { data: { id: 'n2' }, error: null }, { data: null, error: { message: 'caiu' } }),
    });

    const r = await receberFaturamento(EMPRESA, [{ pedido_erp: 'ZZ0000001', nota: NOTA_NOVA }]);

    expect(r.ignorados).toEqual([{ pedido: 'ZZ0000001', motivo: 'falha ao gravar a nota: caiu' }]);
    expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();
    expect(eventos(fake)).toEqual([]);
  });
});

describe('o dia de Brasília', () => {
  it('converte o momento para o dia em São Paulo', async () => {
    const { diaEmSaoPaulo } = await servicoDaFase0({});
    expect(diaEmSaoPaulo('2026-08-13T23:30:00-03:00')).toBe('2026-08-13');
    expect(diaEmSaoPaulo('2026-08-14T01:30:00Z')).toBe('2026-08-13');
    expect(diaEmSaoPaulo('2026-08-14T03:00:00Z')).toBe('2026-08-14');
    expect(diaEmSaoPaulo('ontem')).toBeNull();
  });
});
