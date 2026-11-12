import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { criarSupabaseFake, type ConsultaFeita, type RespostaTabela } from './supabaseFake.js';

/**
 * As rotas /cashback (058) contra um banco de mentira que REAGE: o uso grava
 * de verdade na lista, a observação muda no pedido, e a leitura seguinte já
 * enxerga o saldo novo.
 */

const EMPRESA = 'empresa-1';
const SEGREDO = 'segredo-de-teste-nao-usar-em-producao'; // igual ao tests/setup.ts
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
function assinar(payload: Record<string, unknown>): string {
  const cabecalho = b64({ alg: 'HS256', typ: 'JWT' });
  const agora = Math.floor(Date.now() / 1000);
  const corpo = b64({ ...payload, iat: agora, exp: agora + 3600 });
  const assinatura = crypto.createHmac('sha256', SEGREDO).update(`${cabecalho}.${corpo}`).digest('base64url');
  return `${cabecalho}.${corpo}.${assinatura}`;
}
const base = { email: 'x@csb.com', company_id: EMPRESA, price_table_id: 'tabela-1' };
const TOKEN = {
  simone: assinar({ ...base, sub: 'simone', name: 'SIMONE', role: 'rep', venda_interna: true }),
  repComum: assinar({ ...base, sub: 'reinaldo', name: 'REINALDO', role: 'rep' }),
  financeiro: assinar({ ...base, sub: 'larissa', name: 'LARISSA', role: 'financeiro' }),
  gerente: assinar({ ...base, sub: 'ger-1', name: 'WESLEY', role: 'manager', permissions: null }),
  visualizador: assinar({ ...base, sub: 'joao', name: 'JOAO', role: 'visualizador' }),
  loja: assinar({ ...base, sub: 'loja-1', name: 'LOJA', role: 'store', customer_id: 'c1' }),
};

// Faturado há 10 dias: R$ 1.000 de nota → R$ 30 de cashback, vence em 80 dias.
const FATURADO_EM = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString();

interface Pedido {
  id: string;
  order_number: number;
  customer_id: string | null;
  rep_id: string;
  status: string;
  invoiced: boolean;
  invoiced_at: string | null;
  invoiced_total: number | null;
  total: number;
  notes: string | null;
  inactive: boolean;
}

function filtro(c: ConsultaFeita, metodo: string, coluna: string): unknown {
  return c.filtros.find((f) => f.metodo === metodo && f.args[0] === coluna)?.args[1];
}

function montarBanco(opcoes: { semMigracao?: boolean } = {}) {
  const pedidos: Pedido[] = [
    {
      id: 'o1', order_number: 101, customer_id: 'c1', rep_id: 'simone', status: 'approved', invoiced: true,
      invoiced_at: FATURADO_EM, invoiced_total: 1000, total: 1100, notes: null, inactive: false,
    },
    {
      id: 'o2', order_number: 102, customer_id: 'c1', rep_id: 'simone', status: 'approved', invoiced: false,
      invoiced_at: null, invoiced_total: null, total: 500, notes: 'Boleto 30/60', inactive: false,
    },
    // Do representante comum: faturado, mas não gera cashback.
    {
      id: 'o3', order_number: 103, customer_id: 'c1', rep_id: 'reinaldo', status: 'approved', invoiced: true,
      invoiced_at: FATURADO_EM, invoiced_total: 5000, total: 5000, notes: null, inactive: false,
    },
  ];
  const usos: Array<Record<string, unknown>> = [];

  const orders = (c: ConsultaFeita): RespostaTabela => {
    const select = String(c.filtros.find((f) => f.metodo === 'select')?.args[0] ?? '');
    if (c.operacao === 'update') {
      const p = pedidos.find((x) => x.id === filtro(c, 'eq', 'id'));
      if (p) Object.assign(p, c.valores);
      return { data: null, error: null };
    }
    if (select === 'inactive') return { data: [], error: null };
    const id = filtro(c, 'eq', 'id');
    if (c.umaLinha) return { data: pedidos.find((p) => p.id === id) ?? null, error: null };
    let lista = pedidos;
    const ids = c.filtros.find((f) => f.metodo === 'in' && f.args[0] === 'id')?.args[1] as string[] | undefined;
    if (ids) lista = lista.filter((p) => ids.includes(p.id));
    const reps = c.filtros.find((f) => f.metodo === 'in' && f.args[0] === 'rep_id')?.args[1] as string[] | undefined;
    if (reps) lista = lista.filter((p) => reps.includes(p.rep_id));
    if (filtro(c, 'eq', 'invoiced') === true) lista = lista.filter((p) => p.invoiced);
    const cliente = filtro(c, 'eq', 'customer_id');
    if (cliente) lista = lista.filter((p) => p.customer_id === cliente);
    return { data: lista, error: null };
  };

  const cashbackUsos = (c: ConsultaFeita): RespostaTabela => {
    if (opcoes.semMigracao) {
      return { data: null, error: { code: '42P01', message: 'relation "cashback_usos" does not exist' } };
    }
    if (c.operacao === 'insert') {
      const v = c.valores as Record<string, unknown>;
      if (usos.some((u) => u['order_id'] === v['order_id'])) {
        return { data: null, error: { code: '23505', message: 'duplicate key' } };
      }
      const linha = { id: `u${usos.length + 1}`, usado_em: new Date().toISOString(), ...v };
      usos.push(linha);
      return { data: linha, error: null };
    }
    if (c.operacao === 'delete') {
      const id = filtro(c, 'eq', 'id');
      const i = usos.findIndex((u) => u['id'] === id);
      if (i >= 0) usos.splice(i, 1);
      return { data: null, error: null };
    }
    const order = filtro(c, 'eq', 'order_id');
    if (c.umaLinha) return { data: usos.find((u) => u['order_id'] === order) ?? null, error: null };
    return { data: usos, error: null };
  };

  const fake = criarSupabaseFake({
    orders,
    cashback_usos: cashbackUsos,
    users: (c) => ({ data: filtro(c, 'eq', 'venda_interna') === true ? [{ id: 'simone' }] : [], error: null }),
    companies: () => ({ data: { cashback_inicio: '2026-01-01T00:00:00Z' }, error: null }),
    customers: () => ({ data: [{ id: 'c1', name: 'LOJA DA ANA LTDA', trade_name: 'Loja da Ana', erp_id: '00779' }], error: null }),
  });
  return { fake, pedidos, usos };
}

async function subirApp(banco: ReturnType<typeof montarBanco>) {
  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: banco.fake.cliente }));
  const { buildApp } = await import('../apps/api/src/app.js');
  const app = await buildApp();
  await app.ready();
  return app;
}

const pedir = (method: 'GET' | 'POST' | 'DELETE', url: string, token: string, payload?: unknown) => ({
  method,
  url,
  headers: { authorization: `Bearer ${token}` },
  ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
});

beforeEach(() => {
  vi.resetModules();
});

describe('GET /cashback/clientes', () => {
  it('a venda interna vê o cliente com os 3% do pedido dela — o do rep comum não conta', async () => {
    const app = await subirApp(montarBanco());
    const res = await app.inject(pedir('GET', '/cashback/clientes', TOKEN.simone));
    expect(res.statusCode).toBe(200);
    const { clientes, programa } = res.json().data;
    expect(programa).toMatchObject({ percentual: 3, validade_dias: 90 });
    expect(clientes).toHaveLength(1);
    expect(clientes[0]).toMatchObject({ customer_id: 'c1', saldo: 30, total_ganho: 30, total_usado: 0 });
    expect(clientes[0].proximo_vencimento).toMatchObject({ valor: 30, dias: 80 });
  });

  it('o rep comum toma 403; o escritório e o visualizador leem', async () => {
    const app = await subirApp(montarBanco());
    expect((await app.inject(pedir('GET', '/cashback/clientes', TOKEN.repComum))).statusCode).toBe(403);
    expect((await app.inject(pedir('GET', '/cashback/clientes', TOKEN.visualizador))).statusCode).toBe(200);
    expect((await app.inject(pedir('GET', '/cashback/clientes', TOKEN.gerente))).statusCode).toBe(200);
    expect((await app.inject(pedir('GET', '/cashback/clientes', TOKEN.loja))).statusCode).toBe(403);
  });

  it('sem a 058: 503 MIGRACAO_PENDENTE', async () => {
    const app = await subirApp(montarBanco({ semMigracao: true }));
    const res = await app.inject(pedir('GET', '/cashback/clientes', TOKEN.simone));
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('MIGRACAO_PENDENTE');
  });
});

describe('usar o cashback no pedido', () => {
  it('abate, escreve "Utilizado R$ 20,00 do cashback" na observação e o saldo cai', async () => {
    const banco = montarBanco();
    const app = await subirApp(banco);

    const cartao = await app.inject(pedir('GET', '/cashback/pedidos/o2', TOKEN.simone));
    expect(cartao.json().data).toMatchObject({ limite: 30, sem_uso: null, uso: null });

    const res = await app.inject(pedir('POST', '/cashback/pedidos/o2/uso', TOKEN.simone, { valor: 20 }));
    expect(res.statusCode).toBe(201);
    expect(banco.pedidos.find((p) => p.id === 'o2')?.notes).toBe('Boleto 30/60\nUtilizado R$ 20,00 do cashback');
    expect(banco.usos).toHaveLength(1);
    expect(banco.usos[0]).toMatchObject({ order_id: 'o2', valor: 20, usado_por: 'simone', usado_por_nome: 'SIMONE' });

    const depois = await app.inject(pedir('GET', '/cashback/clientes', TOKEN.simone));
    expect(depois.json().data.clientes[0]).toMatchObject({ saldo: 10, total_usado: 20 });
  });

  it('acima do saldo é recusado e nada é gravado', async () => {
    const banco = montarBanco();
    const app = await subirApp(banco);
    const res = await app.inject(pedir('POST', '/cashback/pedidos/o2/uso', TOKEN.simone, { valor: 30.01 }));
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('ACIMA_DO_SALDO');
    expect(banco.usos).toHaveLength(0);
    expect(banco.pedidos.find((p) => p.id === 'o2')?.notes).toBe('Boleto 30/60');
  });

  it('um uso por pedido: o segundo é recusado', async () => {
    const banco = montarBanco();
    const app = await subirApp(banco);
    await app.inject(pedir('POST', '/cashback/pedidos/o2/uso', TOKEN.simone, { valor: 5 }));
    const res = await app.inject(pedir('POST', '/cashback/pedidos/o2/uso', TOKEN.simone, { valor: 5 }));
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('JA_USADO');
    expect(banco.usos).toHaveLength(1);
  });

  it('pedido já faturado não aceita mais', async () => {
    const banco = montarBanco();
    const app = await subirApp(banco);
    const res = await app.inject(pedir('POST', '/cashback/pedidos/o1/uso', TOKEN.financeiro, { valor: 5 }));
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('PEDIDO_FECHADO');
  });

  it('gerente, visualizador e rep comum não usam', async () => {
    const banco = montarBanco();
    const app = await subirApp(banco);
    for (const token of [TOKEN.gerente, TOKEN.visualizador, TOKEN.repComum]) {
      const res = await app.inject(pedir('POST', '/cashback/pedidos/o2/uso', token, { valor: 5 }));
      expect(res.statusCode).toBe(403);
    }
    expect(banco.usos).toHaveLength(0);
  });

  it('desfazer tira a linha da observação e devolve o saldo', async () => {
    const banco = montarBanco();
    const app = await subirApp(banco);
    await app.inject(pedir('POST', '/cashback/pedidos/o2/uso', TOKEN.simone, { valor: 20 }));
    const res = await app.inject(pedir('DELETE', '/cashback/pedidos/o2/uso', TOKEN.simone));
    expect(res.statusCode).toBe(200);
    expect(banco.pedidos.find((p) => p.id === 'o2')?.notes).toBe('Boleto 30/60');
    expect(banco.usos).toHaveLength(0);
  });
});

describe('a loja vê o próprio cashback', () => {
  it('GET /cashback/meu traz o extrato do cliente do login', async () => {
    const app = await subirApp(montarBanco());
    const res = await app.inject(pedir('GET', '/cashback/meu', TOKEN.loja));
    expect(res.statusCode).toBe(200);
    const { extrato } = res.json().data;
    expect(extrato.saldo).toBe(30);
    expect(extrato.creditos[0]).toMatchObject({ order_number: 101, valor: 30, valor_faturado: 1000 });
  });

  it('só a loja entra nessa rota', async () => {
    const app = await subirApp(montarBanco());
    expect((await app.inject(pedir('GET', '/cashback/meu', TOKEN.simone))).statusCode).toBe(403);
  });
});
