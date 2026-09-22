import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import { criarSupabaseFake, type ConsultaFeita, type RespostaTabela, type Responder } from './supabaseFake.js';

/**
 * Editar o cadastro do cliente e levar a mudança ao Control (migração 051).
 *
 * Pedido do Yan (17/09/2026): "Não tem como alterar esses dados nem sendo admin
 * lá dentro. Quero poder mudar sim, e quando mudar lá tem que mudar no ERP do
 * Fábio também."
 *
 * O que estes testes trancam:
 *   • quem edita: rep e venda interna na própria carteira (fora dela, 404);
 *     gerente, admin e financeiro em qualquer cliente; relacionamento e loja,
 *     403. CPF/CNPJ só admin e financeiro (403 DOCUMENTO_SO_ESCRITORIO, sem
 *     ler o banco);
 *   • duas pessoas editando: o valor visto diferente do banco é 409
 *     MUDOU_DE_NOVO, e a edição que cai entre a leitura e o UPDATE também —
 *     o UPDATE leva cada coluna na condição (compare-and-set);
 *   • sem mudança real, nada é gravado; documento duplicado é de OUTRO cliente;
 *   • o histórico guarda antes/depois normalizados, a linha `address`
 *     recalculada, e fica pendente só com erp_id;
 *   • o histórico que não grava desfaz o cliente (503); sem a 051, nada
 *     acontece (503);
 *   • (revisão de 17/09/2026) erro não é "não gravou": o UPDATE e o insert do
 *     histórico cuja resposta se perdeu depois do commit são conferidos por
 *     releitura antes de dizer "Nada foi alterado" ou de desfazer;
 *   • o push vai só com pendência e canal de cadastro fora da API;
 *   • a ficha traz as alterações; a fila e o "Já atualizei no Control";
 *   • as funções em lote que a API de Parceiro usa.
 *
 * Todos os nomes, documentos e códigos daqui são fictícios.
 */

const EMPRESA = 'empresa-ficticia-1';
const OUTRA_EMPRESA = 'empresa-ficticia-2';
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
  rep: assinar({ ...base, sub: 'rep-ficticio', name: 'REP FICTICIO', role: 'rep', erp_rep_id: '00779' }),
  outroRep: assinar({ ...base, sub: 'rep-outro', name: 'OUTRO REP FICTICIO', role: 'rep', erp_rep_id: '00780' }),
  vendaInterna: assinar({
    ...base,
    sub: 'vi-ficticia',
    name: 'VENDA INTERNA FICTICIA',
    role: 'rep',
    venda_interna: true,
  }),
  relacionamento: assinar({ ...base, sub: 'rel-ficticio', name: 'RELACIONAMENTO FICTICIO', role: 'relacionamento' }),
  loja: assinar({ ...base, sub: 'loja-ficticia', name: 'LOJA FICTICIA', role: 'store', customer_id: 'x' }),
};

const CLIENTE_ID = '00000000-0000-4000-8000-000000000001';
const OUTRO_CLIENTE_ID = '00000000-0000-4000-8000-000000000002';
const CNPJ = '11222333000181';
const OUTRO_CNPJ = '22518613000158'; // DV válido, fictício neste teste

// ─── Um banco de mentira que REAGE ───────────────────────────────────────────
//
// A edição faz compare-and-set (UPDATE com os valores antigos na condição) e,
// na falha do histórico, o compare-and-set inverso. Uma fila de respostas não
// enxerga isso; este banco aplica os filtros de verdade nas linhas.

type Linha = Record<string, unknown>;

interface Banco {
  tabelas: Record<string, Linha[]>;
  /** Tabelas ('customer_changes') ou colunas ('customers.cep') que não existem. */
  ausentes: Set<string>;
  /** Tabelas que não respondem (rede, timeout). */
  mudas: Set<string>;
  /** Chamado antes de cada consulta; devolvendo uma resposta, ela vale no lugar. */
  interceptar?: (c: ConsultaFeita, banco: Banco) => RespostaTabela | undefined;
}

const argsDe = (c: ConsultaFeita, metodo: string) => c.filtros.filter((f) => f.metodo === metodo).map((f) => f.args);

function casaOr(linha: Linha, expressao: string): boolean {
  return expressao.split(',').some((parte) => {
    const [coluna, ...resto] = parte.split('.');
    const op = resto.join('.');
    const v = linha[coluna!];
    if (op === 'not.is.null') return v != null;
    if (op === 'is.null') return v == null;
    if (op.startsWith('eq.')) return String(v) === op.slice(3);
    throw new Error(`or não suportado no banco de teste: ${parte}`);
  });
}

function casa(linha: Linha, c: ConsultaFeita): boolean {
  for (const { metodo, args } of c.filtros) {
    const [coluna, valor, terceiro] = args as [string, unknown, unknown];
    if (metodo === 'eq' && linha[coluna] !== valor) return false;
    if (metodo === 'neq' && linha[coluna] === valor) return false;
    if (metodo === 'is' && (valor === null ? linha[coluna] != null : linha[coluna] !== valor)) return false;
    if (metodo === 'in' && !(valor as unknown[]).includes(linha[coluna])) return false;
    if (metodo === 'not' && valor === 'is' && terceiro === null && linha[coluna] == null) return false;
    if (metodo === 'or' && !casaOr(linha, coluna)) return false;
  }
  return true;
}

function projetar(linha: Linha, c: ConsultaFeita): Linha {
  const sel = argsDe(c, 'select')[0]?.[0];
  if (typeof sel !== 'string' || sel.includes('*')) return { ...linha };
  const saida: Linha = {};
  for (const col of sel.split(',').map((s) => s.trim())) if (col in linha) saida[col] = linha[col];
  return saida;
}

function ordenarEFatiar(linhas: Linha[], c: ConsultaFeita): Linha[] {
  const ordens = argsDe(c, 'order') as Array<[string, { ascending?: boolean } | undefined]>;
  const copia = [...linhas].sort((a, b) => {
    for (const [col, op] of ordens) {
      const x = String(a[col] ?? '');
      const y = String(b[col] ?? '');
      if (x !== y) return (x < y ? -1 : 1) * (op?.ascending === false ? -1 : 1);
    }
    return 0;
  });
  let r = copia;
  const range = argsDe(c, 'range')[0] as [number, number] | undefined;
  if (range) r = r.slice(range[0], range[1] + 1);
  const limite = argsDe(c, 'limit')[0]?.[0];
  if (typeof limite === 'number') r = r.slice(0, limite);
  return r;
}

const apenasDigitos = (v: unknown) => String(v ?? '').replace(/\D/g, '');

function completar(tabela: string, linha: Linha): Linha {
  if (tabela === 'customer_changes') {
    return {
      id: crypto.randomUUID(),
      alterado_em: new Date().toISOString(),
      erp_pendente: false,
      erp_atualizado_em: null,
      erp_atualizado_por: null,
      erp_atualizado_por_nome: null,
      erp_atualizado_via: null,
      ...linha,
    };
  }
  return { id: crypto.randomUUID(), ...linha };
}

/** A coluna gerada da 041. */
function recalcular(tabela: string, linha: Linha): void {
  if (tabela === 'customers' && 'cnpj' in linha) linha['cnpj_digits'] = apenasDigitos(linha['cnpj']);
}

function responderDo(banco: Banco): (tabela: string) => Responder {
  return (tabela) => (c) => {
    const interceptada = banco.interceptar?.(c, banco);
    if (interceptada) return interceptada;
    if (banco.mudas.has(tabela)) return { data: null, error: { message: 'fetch failed' } };
    if (banco.ausentes.has(tabela)) {
      return { data: null, error: { message: `relation "public.${tabela}" does not exist`, code: '42P01' } };
    }
    const sel = argsDe(c, 'select')[0]?.[0];
    if (typeof sel === 'string') {
      const faltando = sel.split(',').map((s) => s.trim()).find((col) => banco.ausentes.has(`${tabela}.${col}`));
      if (faltando) return { data: null, error: { message: `column ${tabela}.${faltando} does not exist`, code: '42703' } };
    }

    const linhas = (banco.tabelas[tabela] ??= []);
    if (c.operacao === 'insert') {
      const novas = (Array.isArray(c.valores) ? c.valores : [c.valores]).map((v) => completar(tabela, { ...(v as Linha) }));
      novas.forEach((n) => recalcular(tabela, n));
      linhas.push(...novas);
      return { data: novas.map((n) => projetar(n, c)), error: null };
    }
    if (c.operacao === 'update') {
      const alvo = linhas.filter((l) => casa(l, c));
      for (const l of alvo) {
        Object.assign(l, c.valores as Linha);
        recalcular(tabela, l);
      }
      return { data: argsDe(c, 'select').length ? alvo.map((l) => projetar(l, c)) : null, error: null };
    }
    if (c.operacao === 'delete') {
      banco.tabelas[tabela] = linhas.filter((l) => !casa(l, c));
      return { data: null, error: null };
    }
    return { data: ordenarEFatiar(linhas.filter((l) => casa(l, c)), c).map((l) => projetar(l, c)), error: null };
  };
}

const TABELAS = ['customers', 'customer_changes', 'users', 'orders', 'companies', 'push_subscriptions', 'price_tables'];

function novoBanco(tabelas: Record<string, Linha[]> = {}): Banco {
  return {
    tabelas: {
      companies: [{ id: EMPRESA, canal_pedido_erp: 'manual', canal_faturamento: 'manual', canal_cadastro: 'carga', canal_retrato: 'carga', canal_catalogo: 'carga' }],
      ...tabelas,
    },
    ausentes: new Set(),
    mudas: new Set(),
  };
}

function fakeDo(banco: Banco) {
  const responder = responderDo(banco);
  return criarSupabaseFake(Object.fromEntries(TABELAS.map((t) => [t, responder(t)])));
}

/** O cliente de sempre: já no Control, da carteira do rep pelo código, cadastro completo. */
function cliente(sobrescrever: Linha = {}): Linha {
  const linha: Linha = {
    id: CLIENTE_ID,
    company_id: EMPRESA,
    name: 'LOJA FICTICIA LTDA',
    trade_name: 'LOJA FICTICIA',
    cnpj: CNPJ,
    whatsapp: '32999990000',
    email: 'loja@exemplo.com',
    address: 'Rua Ficticia, 10 - Centro - Juiz de Fora/MG - CEP 36000-000',
    cep: '36000000',
    logradouro: 'Rua Ficticia',
    numero: '10',
    complemento: null,
    bairro: 'Centro',
    cidade: 'Juiz de Fora',
    uf: 'MG',
    inscricao_estadual: null,
    observacoes: null,
    credit_limit: null,
    blocked: false,
    block_reason: null,
    price_table_id: null,
    erp_id: '09999',
    rep_id: null,
    rep_erp_id: '00779',
    updated_at: '2026-09-01T12:00:00.000Z',
    ...sobrescrever,
  };
  recalcular('customers', linha);
  return linha;
}

let aviso: ReturnType<typeof vi.fn>;

async function subirApp(banco: Banco) {
  const fake = fakeDo(banco);
  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
  aviso = vi.fn(async () => ({ financeiro: 1, admin: 1 }));
  vi.doMock('../apps/api/src/modules/push/push.avisos.js', async (importar) => ({
    ...(await importar<typeof import('../apps/api/src/modules/push/push.avisos.js')>()),
    avisarCadastroAlteradoNoControl: aviso,
  }));
  const { buildApp } = await import('../apps/api/src/app.js');
  const app = await buildApp();
  await app.ready();
  return { app, fake };
}

type Corpo = Record<string, unknown>;

async function editar(banco: Banco, payload: unknown, token = TOKEN.financeiro, id = CLIENTE_ID) {
  const { app, fake } = await subirApp(banco);
  const res = await app.inject({
    method: 'PATCH',
    url: `/customers/${id}/cadastro`,
    headers: { authorization: `Bearer ${token}` },
    payload: payload as Corpo,
  });
  await app.close();
  return { res, fake, corpo: res.json() as Corpo };
}

const doCliente = (banco: Banco) => banco.tabelas['customers']!.find((l) => l['id'] === CLIENTE_ID)!;
const historico = (banco: Banco) => banco.tabelas['customer_changes'] ?? [];
const gravacoesEm = (fake: ReturnType<typeof fakeDo>) => fake.gravacoes.map((g) => `${g.tabela}.${g.operacao}`);

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock('../apps/api/src/config/supabase.js');
  vi.doUnmock('../apps/api/src/modules/push/push.avisos.js');
  vi.doUnmock('../apps/api/src/config/env.js');
  vi.doUnmock('../apps/api/src/modules/push/webpush.js');
  vi.restoreAllMocks();
});

const WHATSAPP_NOVO = { novo: { whatsapp: '32988880000' }, vistos: { whatsapp: '32999990000' } };
/**
 * A edição de exemplo dos testes genéricos (pendência, aviso, compare-and-set,
 * falhas). Era o WhatsApp até 22/09/2026, quando ele virou dado só do app — a
 * edição só dele não fica pendente nem avisa o financeiro. O e-mail vai ao
 * Control: as mesmas asserções seguem valendo com ele.
 */
const EMAIL_NOVO = { novo: { email: 'novo@exemplo.com' }, vistos: { email: 'loja@exemplo.com' } };

// ─── Quem pode ───────────────────────────────────────────────────────────────

describe('PATCH /customers/:id/cadastro — quem pode', () => {
  it('rep na própria carteira (pelo código do Control): 200, grava e registra', async () => {
    const banco = novoBanco({ customers: [cliente()] });
    const { res, corpo } = await editar(banco, EMAIL_NOVO, TOKEN.rep);

    expect(res.statusCode).toBe(200);
    expect(doCliente(banco)['email']).toBe('novo@exemplo.com');
    expect(historico(banco)).toHaveLength(1);
    expect(historico(banco)[0]).toMatchObject({
      company_id: EMPRESA,
      customer_id: CLIENTE_ID,
      alterado_por: 'rep-ficticio',
      alterado_por_nome: 'REP FICTICIO',
      campos: { email: { antes: 'loja@exemplo.com', depois: 'novo@exemplo.com' } },
      erp_pendente: true,
    });
    expect((corpo['data'] as Corpo)['email']).toBe('novo@exemplo.com');
    expect(corpo['erp_pendente']).toBe(true);
    expect(corpo['avisados']).toEqual({ financeiro: 1, admin: 1 });
  });

  it('rep que cadastrou o cliente (rep_id) também edita', async () => {
    const banco = novoBanco({ customers: [cliente({ rep_id: 'rep-outro', rep_erp_id: null })] });
    const { res } = await editar(banco, EMAIL_NOVO, TOKEN.outroRep);
    expect(res.statusCode).toBe(200);
  });

  it('rep com cliente de OUTRA carteira: 404, nada gravado', async () => {
    const banco = novoBanco({ customers: [cliente()] });
    const { res, fake, corpo } = await editar(banco, EMAIL_NOVO, TOKEN.outroRep);

    expect(res.statusCode).toBe(404);
    expect(corpo['code']).toBe('NOT_FOUND');
    expect(fake.gravacoes).toHaveLength(0);
    expect(doCliente(banco)['email']).toBe('loja@exemplo.com');
  });

  for (const [papel, token] of [
    ['relacionamento', TOKEN.relacionamento],
    ['loja', TOKEN.loja],
  ] as const) {
    it(`${papel}: 403 sem tocar no banco`, async () => {
      const banco = novoBanco({ customers: [cliente()] });
      const { res, fake } = await editar(banco, EMAIL_NOVO, token);
      expect(res.statusCode).toBe(403);
      expect(fake.filtros).toHaveLength(0);
    });
  }

  for (const [papel, token] of [
    ['representante', TOKEN.rep],
    ['gerente', TOKEN.gerente],
    ['venda interna', TOKEN.vendaInterna],
  ] as const) {
    it(`${papel} mandando CPF/CNPJ: 403 DOCUMENTO_SO_ESCRITORIO, sem ler nada`, async () => {
      const banco = novoBanco({ customers: [cliente()] });
      const { res, fake, corpo } = await editar(
        banco,
        { novo: { cnpj: OUTRO_CNPJ }, vistos: { cnpj: CNPJ } },
        token,
      );
      expect(res.statusCode).toBe(403);
      expect(corpo['code']).toBe('DOCUMENTO_SO_ESCRITORIO');
      expect(fake.filtros).toHaveLength(0);
      expect(fake.gravacoes).toHaveLength(0);
    });
  }

  for (const [papel, token, sub] of [
    ['financeiro', TOKEN.financeiro, 'fin-ficticio'],
    ['admin', TOKEN.admin, 'adm-ficticio'],
  ] as const) {
    it(`${papel} troca o CPF/CNPJ de qualquer cliente: grava só dígitos, histórico normalizado`, async () => {
      const banco = novoBanco({ customers: [cliente({ cnpj: '11.222.333/0001-81' })] });
      const { res } = await editar(
        banco,
        { novo: { cnpj: '22.518.613/0001-58' }, vistos: { cnpj: '11.222.333/0001-81' } },
        token,
      );

      expect(res.statusCode).toBe(200);
      expect(doCliente(banco)['cnpj']).toBe(OUTRO_CNPJ);
      expect(historico(banco)[0]).toMatchObject({
        alterado_por: sub,
        campos: { cnpj: { antes: CNPJ, depois: OUTRO_CNPJ } },
      });
    });
  }

  it('gerente edita cliente de qualquer carteira', async () => {
    const banco = novoBanco({ customers: [cliente({ rep_erp_id: '01234' })] });
    const { res } = await editar(banco, EMAIL_NOVO, TOKEN.gerente);
    expect(res.statusCode).toBe(200);
  });

  it('id que não é UUID: 404 sem consultar o banco', async () => {
    const { res, fake } = await editar(novoBanco(), EMAIL_NOVO, TOKEN.admin, 'nao-e-um-id');
    expect(res.statusCode).toBe(404);
    expect(fake.filtros).toHaveLength(0);
  });
});

// ─── O corpo ─────────────────────────────────────────────────────────────────

describe('PATCH /customers/:id/cadastro — o corpo', () => {
  it('campo que não se edita por aqui (erp_id, address, blocked): 400', async () => {
    for (const novo of [{ erp_id: '01234' }, { address: 'outra linha' }, { blocked: 'true' }]) {
      const banco = novoBanco({ customers: [cliente()] });
      const { res, fake } = await editar(banco, { novo, vistos: novo }, TOKEN.admin);
      expect(res.statusCode).toBe(400);
      expect(fake.gravacoes).toHaveLength(0);
    }
  });

  it('campo novo sem o valor visto: 400', async () => {
    const banco = novoBanco({ customers: [cliente()] });
    const { res, fake } = await editar(banco, { novo: { whatsapp: '32988880000' }, vistos: {} }, TOKEN.admin);
    expect(res.statusCode).toBe(400);
    expect(fake.gravacoes).toHaveLength(0);
  });

  it('observação longa gravada pelo Control (acima de 5.000) pode ser encurtada e apagada: o visto não tem teto', async () => {
    // Revisão de 17/09/2026: o POST /partner/v1/clientes grava a observação do
    // tamanho que vier, e o teto do valor novo valia também para o visto — o 400
    // "Texto grande demais" travava o campo para sempre pelo app.
    const longa = 'Entregar no depósito dos fundos. '.repeat(187); // 6.171 caracteres
    expect(longa.length).toBeGreaterThan(5000);

    const encurtar = novoBanco({ customers: [cliente({ observacoes: longa })] });
    const r1 = await editar(
      encurtar,
      { novo: { observacoes: 'Entregar só de manhã.' }, vistos: { observacoes: longa } },
      TOKEN.financeiro,
    );
    expect(r1.res.statusCode).toBe(200);
    expect(doCliente(encurtar)['observacoes']).toBe('Entregar só de manhã.');
    expect(historico(encurtar)[0]!['campos']).toEqual({
      observacoes: { antes: longa.trim(), depois: 'Entregar só de manhã.' },
    });

    vi.resetModules();
    const apagar = novoBanco({ customers: [cliente({ observacoes: longa })] });
    const r2 = await editar(apagar, { novo: { observacoes: null }, vistos: { observacoes: longa } }, TOKEN.admin);
    expect(r2.res.statusCode).toBe(200);
    expect(doCliente(apagar)['observacoes']).toBeNull();

    // O valor NOVO continua com teto.
    vi.resetModules();
    const grande = novoBanco({ customers: [cliente()] });
    const r3 = await editar(grande, { novo: { observacoes: longa }, vistos: { observacoes: null } }, TOKEN.admin);
    expect(r3.res.statusCode).toBe(400);
    expect(r3.fake.gravacoes).toHaveLength(0);
  });

  it('valor inválido: 400 VALIDATION_ERROR com a mensagem por campo, nada gravado', async () => {
    const banco = novoBanco({ customers: [cliente()] });
    const { res, fake, corpo } = await editar(
      banco,
      { novo: { email: 'sem-arroba', name: 'X' }, vistos: { email: 'loja@exemplo.com', name: 'LOJA FICTICIA LTDA' } },
      TOKEN.admin,
    );
    expect(res.statusCode).toBe(400);
    expect(corpo['code']).toBe('VALIDATION_ERROR');
    expect(corpo['campos']).toEqual({
      name: 'Nome / razão social é obrigatório',
      email: 'E-mail inválido — ou deixe em branco',
    });
    expect(fake.gravacoes).toHaveLength(0);
  });
});

// ─── Duas pessoas editando ───────────────────────────────────────────────────

describe('PATCH /customers/:id/cadastro — alguém mudou no meio', () => {
  it('o valor visto já não é o do banco: 409 MUDOU_DE_NOVO com a ficha de agora, nada gravado', async () => {
    const banco = novoBanco({ customers: [cliente({ email: 'outra@exemplo.com' })] });
    const { res, fake, corpo } = await editar(banco, EMAIL_NOVO, TOKEN.rep);

    expect(res.statusCode).toBe(409);
    expect(corpo['code']).toBe('MUDOU_DE_NOVO');
    expect(corpo['campos']).toEqual(['email']);
    expect((corpo['data'] as Corpo)['email']).toBe('outra@exemplo.com');
    expect(fake.gravacoes).toHaveLength(0);
  });

  it('a edição que cai entre a leitura e o UPDATE: o compare-and-set afeta 0 linhas → 409, sem histórico', async () => {
    const banco = novoBanco({ customers: [cliente()] });
    banco.interceptar = (c, b) => {
      // Outra pessoa grava o e-mail um instante antes deste UPDATE.
      if (c.tabela === 'customers' && c.operacao === 'update') doCliente(b)['email'] = 'outro@exemplo.com';
      return undefined;
    };
    const { res, fake, corpo } = await editar(banco, EMAIL_NOVO, TOKEN.rep);

    expect(res.statusCode).toBe(409);
    expect(corpo['code']).toBe('MUDOU_DE_NOVO');
    expect(corpo['campos']).toEqual(['email']);
    expect(doCliente(banco)['email']).toBe('outro@exemplo.com'); // a edição do outro ficou
    expect(gravacoesEm(fake)).toEqual(['customers.update']);
    expect(historico(banco)).toHaveLength(0);

    // A condição do UPDATE: id, empresa e o valor que estava no banco.
    const eqDoUpdate = fake.filtrosDe('customers', 'eq').map((f) => f.args);
    expect(eqDoUpdate).toContainEqual(['email', 'loja@exemplo.com']);
    expect(eqDoUpdate).toContainEqual(['company_id', EMPRESA]);
  });

  // ─── A releitura da ficha que falha não é "fora da carteira" (revisão de 17/09/2026) ─
  //
  // A leitura da ficha engolia o erro do banco e devolvia nulo: no 409 do
  // compare-and-set e no "nada mudou", um timeout virava 404 "Cliente não
  // encontrado na sua carteira" — o representante lia que o cliente tinha
  // saído da carteira dele, com o cliente lá e nada gravado.
  const TIMEOUT: RespostaTabela = { data: null, error: { message: 'canceling statement due to statement timeout', code: '57014' } };
  /** Só a leitura do DETALHE (a ficha) — a única que pede o limite de crédito. */
  const ehALeituraDaFicha = (c: ConsultaFeita) =>
    c.tabela === 'customers' && c.operacao === 'select' && String(argsDe(c, 'select')[0]?.[0] ?? '').includes('credit_limit');

  it('0 linhas no compare-and-set e a releitura da ficha falha: 409 MUDOU_DE_NOVO sem a ficha (a tela relê) — nunca 404 de carteira', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const banco = novoBanco({ customers: [cliente()] });
    let fichasQueFalharam = 0;
    banco.interceptar = (c, b) => {
      // Outra pessoa grava o e-mail um instante antes deste UPDATE…
      if (c.tabela === 'customers' && c.operacao === 'update') doCliente(b)['email'] = 'outro@exemplo.com';
      // …e a releitura da ficha, logo depois, dá timeout.
      if (ehALeituraDaFicha(c)) {
        fichasQueFalharam++;
        return TIMEOUT;
      }
      return undefined;
    };
    const { res, fake, corpo } = await editar(banco, EMAIL_NOVO, TOKEN.rep);

    expect(fichasQueFalharam).toBe(1);
    expect(res.statusCode).toBe(409);
    expect(corpo['code']).toBe('MUDOU_DE_NOVO');
    expect(corpo['data']).toBeNull();
    expect(String(corpo['error'])).not.toContain('carteira');
    // Nada gravado: o UPDATE não achou o cadastro como lido; o cliente segue na carteira do rep.
    expect(gravacoesEm(fake)).toEqual(['customers.update']);
    expect(doCliente(banco)).toMatchObject({ email: 'outro@exemplo.com', rep_erp_id: '00779' });
    expect(historico(banco)).toHaveLength(0);
  });

  it('nada mudou de verdade e a releitura da ficha falha: 503 TENTE_DE_NOVO, nada gravado — nunca 404 de carteira', async () => {
    const banco = novoBanco({ customers: [cliente()] });
    banco.interceptar = (c) => (ehALeituraDaFicha(c) ? TIMEOUT : undefined);
    const { res, fake, corpo } = await editar(
      banco,
      { novo: { whatsapp: '32999990000' }, vistos: { whatsapp: '32999990000' } },
      TOKEN.rep,
    );

    expect(res.statusCode).toBe(503);
    expect(corpo['code']).toBe('TENTE_DE_NOVO');
    expect(String(corpo['error'])).toContain('Nada foi alterado');
    expect(fake.gravacoes).toHaveLength(0);
  });

  it('coluna que estava nula entra na condição com IS NULL', async () => {
    const banco = novoBanco({ customers: [cliente({ email: null })] });
    const { res, fake } = await editar(
      banco,
      { novo: { email: 'nova@exemplo.com' }, vistos: { email: '' } },
      TOKEN.rep,
    );
    expect(res.statusCode).toBe(200);
    expect(fake.filtrosDe('customers', 'is').map((f) => f.args)).toContainEqual(['email', null]);
  });

  it('documento legado com máscara, visto sem máscara: não é conflito — e igual ao novo, é "sem mudança"', async () => {
    const banco = novoBanco({ customers: [cliente({ cnpj: '11.222.333/0001-81' })] });
    const { res, fake, corpo } = await editar(
      banco,
      { novo: { cnpj: CNPJ, whatsapp: ' 32999990000 ' }, vistos: { cnpj: CNPJ, whatsapp: '32999990000' } },
      TOKEN.financeiro,
    );

    expect(res.statusCode).toBe(200);
    expect(corpo['sem_mudanca']).toBe(true);
    expect((corpo['data'] as Corpo)['id']).toBe(CLIENTE_ID);
    expect(fake.gravacoes).toHaveLength(0);
    expect(aviso).not.toHaveBeenCalled();
  });
});

// ─── Documento duplicado ─────────────────────────────────────────────────────

describe('PATCH /customers/:id/cadastro — documento de outro cliente', () => {
  it('o documento novo já é de outro cliente da empresa: 409 DOCUMENTO_DUPLICADO, nada gravado', async () => {
    const banco = novoBanco({
      customers: [
        cliente(),
        cliente({ id: OUTRO_CLIENTE_ID, name: 'OUTRA LOJA FICTICIA', cnpj: '22.518.613/0001-58', erp_id: '08888' }),
      ],
    });
    const { res, fake, corpo } = await editar(banco, { novo: { cnpj: OUTRO_CNPJ }, vistos: { cnpj: CNPJ } });

    expect(res.statusCode).toBe(409);
    expect(corpo['code']).toBe('DOCUMENTO_DUPLICADO');
    expect(String(corpo['error'])).toContain('OUTRA LOJA FICTICIA');
    expect(fake.gravacoes).toHaveLength(0);
  });

  it('a busca do documento não responde: 503 TENTE_DE_NOVO e nada gravado — nunca "ninguém tem"', async () => {
    // Revisão de 17/09/2026: o erro dessa leitura era lido como "sem duplicado"
    // e o índice de cnpj_digits da 041 não é UNIQUE — as duas lojas ficavam com
    // o mesmo CNPJ e a troca ia para a fila do Control.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const banco = novoBanco({
      customers: [
        cliente(),
        cliente({ id: OUTRO_CLIENTE_ID, name: 'OUTRA LOJA FICTICIA', cnpj: OUTRO_CNPJ, erp_id: '08888', rep_erp_id: '00780' }),
      ],
    });
    let interceptadas = 0;
    banco.interceptar = (c) => {
      const buscaDoDuplicado = c.tabela === 'customers' && c.operacao === 'select' && argsDe(c, 'neq').length > 0;
      if (!buscaDoDuplicado) return undefined;
      interceptadas++;
      return { data: null, error: { message: 'upstream request timeout' } };
    };
    const { res, fake, corpo } = await editar(banco, { novo: { cnpj: OUTRO_CNPJ }, vistos: { cnpj: CNPJ } });

    expect(interceptadas).toBe(1);
    expect(res.statusCode).toBe(503);
    expect(corpo['code']).toBe('TENTE_DE_NOVO');
    expect(String(corpo['error'])).toContain('Nada foi alterado');
    expect(fake.gravacoes).toHaveLength(0);
    expect(historico(banco)).toHaveLength(0);
    expect(doCliente(banco)['cnpj_digits']).toBe(CNPJ);
    expect(aviso).not.toHaveBeenCalled();
  });

  it('a busca exclui o próprio cliente', async () => {
    // cnpj_digits desatualizado de propósito: só o próprio cliente "tem" o documento novo.
    const proprio = cliente();
    proprio['cnpj_digits'] = OUTRO_CNPJ;
    const banco = novoBanco({ customers: [proprio] });
    const { res, fake } = await editar(banco, { novo: { cnpj: OUTRO_CNPJ }, vistos: { cnpj: CNPJ } });

    expect(res.statusCode).toBe(200);
    expect(fake.filtrosDe('customers', 'neq').map((f) => f.args)).toContainEqual(['id', CLIENTE_ID]);
    expect(fake.filtrosDe('customers', 'eq').map((f) => f.args)).toContainEqual(['cnpj_digits', OUTRO_CNPJ]);
  });
});

// ─── O histórico ─────────────────────────────────────────────────────────────

describe('PATCH /customers/:id/cadastro — o histórico', () => {
  it('cliente legado (só a linha) ganha o endereço em campos: a linha é recalculada e vai para o histórico', async () => {
    const banco = novoBanco({
      customers: [
        cliente({
          address: 'R FICTICIA 10 CENTRO JF',
          cep: null,
          logradouro: null,
          numero: null,
          bairro: null,
          cidade: null,
          uf: null,
          erp_id: null, // nasceu no app, ainda não está no Control
        }),
      ],
    });
    const endereco = {
      cep: '36000-000',
      logradouro: 'Rua Ficticia',
      numero: '10',
      bairro: 'Centro',
      cidade: 'Juiz de Fora',
      uf: 'mg',
    };
    const vistos = { cep: null, logradouro: null, numero: null, bairro: null, cidade: null, uf: null };
    const { res, corpo } = await editar(banco, { novo: endereco, vistos }, TOKEN.gerente);

    expect(res.statusCode).toBe(200);
    const linhaNova = 'Rua Ficticia, 10 - Centro - Juiz de Fora/MG - CEP 36000-000';
    expect(doCliente(banco)).toMatchObject({ cep: '36000000', uf: 'MG', address: linhaNova });
    const campos = historico(banco)[0]!['campos'] as Corpo;
    expect(campos['address']).toEqual({ antes: 'R FICTICIA 10 CENTRO JF', depois: linhaNova });
    expect(campos['cep']).toEqual({ antes: null, depois: '36000000' });
    expect(campos['uf']).toEqual({ antes: null, depois: 'MG' });
    // Sem código do Control: não fica pendente e ninguém é avisado.
    expect(historico(banco)[0]!['erp_pendente']).toBe(false);
    expect(corpo['erp_pendente']).toBe(false);
    expect(corpo['avisados']).toBeNull();
    expect(aviso).not.toHaveBeenCalled();
  });

  it('cliente legado edita só o WhatsApp sem ser obrigado a preencher endereço', async () => {
    const banco = novoBanco({
      customers: [cliente({ address: 'R FICTICIA 10', cep: null, logradouro: null, numero: null, bairro: null, cidade: null, uf: null })],
    });
    const { res } = await editar(banco, WHATSAPP_NOVO, TOKEN.rep);
    expect(res.statusCode).toBe(200);
    expect(historico(banco)[0]!['campos']).toEqual({ whatsapp: { antes: '32999990000', depois: '32988880000' } });
    expect(doCliente(banco)['address']).toBe('R FICTICIA 10');
  });

  it('meio endereço num cliente legado: 400 com as peças que faltam, nada gravado', async () => {
    const banco = novoBanco({
      customers: [cliente({ address: 'R FICTICIA 10', cep: null, logradouro: null, numero: null, bairro: null, cidade: null, uf: null })],
    });
    const { res, fake, corpo } = await editar(banco, { novo: { cep: '36000000' }, vistos: { cep: null } }, TOKEN.rep);
    expect(res.statusCode).toBe(400);
    expect(Object.keys(corpo['campos'] as Corpo)).toEqual(['logradouro', 'numero', 'bairro', 'cidade', 'uf']);
    expect(fake.gravacoes).toHaveLength(0);
  });

  it('a linha do endereço que já não era a das peças: a troca vai marcada no histórico (e a de sempre, não)', async () => {
    // O Control mandou o endereço em texto: só a linha mudou; as peças ficaram.
    const banco = novoBanco({
      customers: [cliente({ address: 'Avenida Nova, 99 - Bela Vista - Juiz de Fora/MG - CEP 36000-000' })],
    });
    const { res, corpo } = await editar(
      banco,
      { novo: { complemento: 'Sala 2' }, vistos: { complemento: null } },
      TOKEN.rep,
    );

    expect(res.statusCode).toBe(200);
    const linhaNova = 'Rua Ficticia, 10 Sala 2 - Centro - Juiz de Fora/MG - CEP 36000-000';
    expect(doCliente(banco)['address']).toBe(linhaNova);
    // Sem a marca, o cartão escondia a troca da rua (só "Complemento: → Sala 2").
    expect((historico(banco)[0]!['campos'] as Corpo)['address']).toEqual({
      antes: 'Avenida Nova, 99 - Bela Vista - Juiz de Fora/MG - CEP 36000-000',
      depois: linhaNova,
      linha_fora_das_pecas: true,
    });
    expect(((corpo['alteracao'] as Corpo)['campos'] as Corpo)['address']).toMatchObject({ linha_fora_das_pecas: true });

    vi.resetModules();
    const deSempre = novoBanco({ customers: [cliente()] });
    await editar(deSempre, { novo: { numero: '12' }, vistos: { numero: '10' } }, TOKEN.rep);
    expect((historico(deSempre)[0]!['campos'] as Corpo)['address']).toEqual({
      antes: 'Rua Ficticia, 10 - Centro - Juiz de Fora/MG - CEP 36000-000',
      depois: 'Rua Ficticia, 12 - Centro - Juiz de Fora/MG - CEP 36000-000',
    });
  });

  it('só o que mudou vai para o banco e para o histórico, com updated_at', async () => {
    const banco = novoBanco({ customers: [cliente()] });
    const { res, fake } = await editar(
      banco,
      {
        novo: { whatsapp: '32988880000', email: 'loja@exemplo.com', trade_name: 'LOJA NOVA FICTICIA' },
        vistos: { whatsapp: '32999990000', email: 'loja@exemplo.com', trade_name: 'LOJA FICTICIA' },
      },
      TOKEN.rep,
    );
    expect(res.statusCode).toBe(200);
    const update = fake.ultimaGravacao('customers', 'update')!.valores as Corpo;
    expect(Object.keys(update).sort()).toEqual(['trade_name', 'updated_at', 'whatsapp']);
    expect(Object.keys(historico(banco)[0]!['campos'] as Corpo).sort()).toEqual(['trade_name', 'whatsapp']);
  });
});

// ─── Falhas e migrações ──────────────────────────────────────────────────────

describe('PATCH /customers/:id/cadastro — falhas', () => {
  it('o histórico não grava: o cliente é desfeito e a resposta é 503 ALTERACAO_NAO_REGISTRADA', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const banco = novoBanco({ customers: [cliente()] });
    banco.interceptar = (c) =>
      c.tabela === 'customer_changes' && c.operacao === 'insert'
        ? { data: null, error: { message: 'permission denied' } }
        : undefined;
    const { res, fake, corpo } = await editar(banco, EMAIL_NOVO, TOKEN.rep);

    expect(res.statusCode).toBe(503);
    expect(corpo['code']).toBe('ALTERACAO_NAO_REGISTRADA');
    expect(gravacoesEm(fake)).toEqual(['customers.update', 'customer_changes.insert', 'customers.update']);
    // Voltou como estava, e o desfazer só valia onde ainda estava o que esta edição gravou.
    expect(doCliente(banco)['email']).toBe('loja@exemplo.com');
    expect(fake.filtrosDe('customers', 'eq').map((f) => f.args)).toContainEqual(['email', 'novo@exemplo.com']);
    expect(aviso).not.toHaveBeenCalled();
  });

  it('o histórico não grava E o desfazer não acha o cliente como a edição deixou: 500 e log alto, sem nome de cliente', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const banco = novoBanco({ customers: [cliente()] });
    banco.interceptar = (c, b) => {
      if (c.tabela === 'customer_changes' && c.operacao === 'insert') {
        doCliente(b)['email'] = 'terceiro@exemplo.com'; // alguém gravou no meio
        return { data: null, error: { message: 'permission denied' } };
      }
      return undefined;
    };
    const { res, corpo } = await editar(banco, EMAIL_NOVO, TOKEN.rep);

    expect(res.statusCode).toBe(500);
    expect(corpo['code']).toBe('ALTERACAO_SEM_HISTORICO');
    expect(log).toHaveBeenCalled();
    const mensagens = log.mock.calls.map((c) => String(c[0])).join('\n');
    expect(mensagens).toContain('SEM HISTÓRICO');
    expect(mensagens).toContain(CLIENTE_ID);
    expect(mensagens).not.toContain('LOJA FICTICIA');
    expect(mensagens).not.toContain(CNPJ);
  });

  it('o histórico não grava e, antes do desfazer, o cadastro já VOLTOU ao valor de antes: 503 "nada mudou", sem alerta falso', async () => {
    // Revisão de 17/09/2026. O lote do Control leu o e-mail novo sem pendência
    // (o histórico falhou) e gravou o antigo de volta — o compare-and-set dele
    // passa, a condição é o próprio valor novo. O desfazer sai sem erro e com 0
    // linhas: antes, 500 "O cadastro foi alterado… avise o suporte" com o
    // cadastro igual ao de antes e ao do Control.
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const banco = novoBanco({ customers: [cliente()] });
    banco.interceptar = (c, b) => {
      if (c.tabela === 'customer_changes' && c.operacao === 'insert') {
        doCliente(b)['email'] = 'loja@exemplo.com'; // o valor de antes, gravado no meio
        return { data: null, error: { message: 'insert or update on table "customer_changes" violates foreign key constraint', code: '23503' } };
      }
      return undefined;
    };
    const { res, corpo, fake } = await editar(banco, EMAIL_NOVO, TOKEN.rep);

    expect(res.statusCode).toBe(503);
    expect(corpo['code']).toBe('ALTERACAO_NAO_REGISTRADA');
    expect(gravacoesEm(fake)).toEqual(['customers.update', 'customer_changes.insert', 'customers.update']);
    expect(doCliente(banco)['email']).toBe('loja@exemplo.com');
    expect(historico(banco)).toHaveLength(0);
    const mensagens = log.mock.calls.map((c) => String(c[0])).join('\n');
    expect(mensagens).not.toContain('SEM HISTÓRICO');
    expect(mensagens).not.toContain('ALERTA');
    expect(aviso).not.toHaveBeenCalled();
  });

  it('o desfazer sai sem erro e com 0 linhas, e a releitura não responde: 503 GRAVACAO_NAO_CONFIRMADA — nem "alterado" nem "nada mudou"', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const banco = novoBanco({ customers: [cliente()] });
    let updates = 0;
    banco.interceptar = (c, b) => {
      if (c.tabela === 'customer_changes' && c.operacao === 'insert') {
        doCliente(b)['email'] = 'terceiro@exemplo.com'; // alguém gravou no meio
        return { data: null, error: { message: 'permission denied' } };
      }
      if (c.tabela !== 'customers') return undefined;
      if (c.operacao === 'update') updates++;
      // Depois do desfazer (o segundo UPDATE), o banco para de responder.
      return updates >= 2 && c.operacao === 'select' ? { data: null, error: { message: 'fetch failed' } } : undefined;
    };
    const { res, corpo } = await editar(banco, EMAIL_NOVO, TOKEN.rep);

    expect(res.statusCode).toBe(503);
    expect(corpo['code']).toBe('GRAVACAO_NAO_CONFIRMADA');
    const mensagens = log.mock.calls.map((c) => String(c[0])).join('\n');
    expect(mensagens).toContain('ALERTA');
    expect(mensagens).not.toContain('LOJA FICTICIA');
  });

  // ─── A resposta que se perde depois do commit (revisão de 17/09/2026) ──────
  //
  // O postgrest-js não repete PATCH nem POST: a conexão que cai (ou o 502/504
  // do gateway) DEPOIS de o banco gravar chega ao service como erro. Estes
  // casos gravam de verdade no banco de teste e devolvem o erro de rede.

  /** Aplica a consulta no banco de teste, sem passar pelo interceptador. */
  const aplicar = (c: ConsultaFeita, b: Banco) => responderDo({ ...b, interceptar: undefined })(c.tabela)(c);
  const REDE_CAIU: RespostaTabela = { data: null, error: { message: 'TypeError: fetch failed' } };

  it('o UPDATE gravou e a resposta se perdeu: relê, vê a edição aplicada e segue para o histórico — 200, com pendência e aviso', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const banco = novoBanco({ customers: [cliente()] });
    let perdida = false;
    banco.interceptar = (c, b) => {
      if (perdida || c.tabela !== 'customers' || c.operacao !== 'update') return undefined;
      perdida = true;
      aplicar(c, b);
      return REDE_CAIU;
    };
    const { res, corpo, fake } = await editar(banco, EMAIL_NOVO, TOKEN.rep);

    // Antes: 500 "Nada foi alterado" com o cliente alterado e nenhuma linha no
    // histórico — a mudança nunca chegava à fila do Control.
    expect(res.statusCode).toBe(200);
    expect(doCliente(banco)['email']).toBe('novo@exemplo.com');
    expect(historico(banco)).toHaveLength(1);
    expect(historico(banco)[0]).toMatchObject({
      campos: { email: { antes: 'loja@exemplo.com', depois: 'novo@exemplo.com' } },
      erp_pendente: true,
    });
    expect(gravacoesEm(fake)).toEqual(['customers.update', 'customer_changes.insert']);
    expect(corpo['erp_pendente']).toBe(true);
    expect(aviso).toHaveBeenCalledTimes(1);
  });

  it('o UPDATE respondeu erro e não gravou: 500 UPDATE_FAILED "Nada foi alterado", sem histórico', async () => {
    const banco = novoBanco({ customers: [cliente()] });
    banco.interceptar = (c) => (c.tabela === 'customers' && c.operacao === 'update' ? REDE_CAIU : undefined);
    const { res, corpo, fake } = await editar(banco, EMAIL_NOVO, TOKEN.rep);

    expect(res.statusCode).toBe(500);
    expect(corpo['code']).toBe('UPDATE_FAILED');
    expect(String(corpo['error'])).toContain('Nada foi alterado');
    expect(doCliente(banco)['email']).toBe('loja@exemplo.com');
    expect(gravacoesEm(fake)).toEqual(['customers.update']);
    expect(historico(banco)).toHaveLength(0);
  });

  it('o UPDATE respondeu erro e nem a releitura responde: 503 GRAVACAO_NAO_CONFIRMADA — nunca "Nada foi alterado"', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const banco = novoBanco({ customers: [cliente()] });
    let gravou = false;
    banco.interceptar = (c, b) => {
      if (c.tabela !== 'customers') return undefined;
      if (c.operacao === 'update') {
        gravou = true;
        aplicar(c, b);
        return REDE_CAIU;
      }
      return gravou ? REDE_CAIU : undefined;
    };
    const { res, corpo } = await editar(banco, EMAIL_NOVO, TOKEN.rep);

    expect(res.statusCode).toBe(503);
    expect(corpo['code']).toBe('GRAVACAO_NAO_CONFIRMADA');
    expect(String(corpo['error'])).not.toContain('Nada foi alterado');
    expect(String(corpo['error'])).toContain('conferir');
    const mensagens = log.mock.calls.map((c) => String(c[0])).join('\n');
    expect(mensagens).toContain('ALERTA');
    expect(mensagens).toContain(CLIENTE_ID);
    expect(mensagens).not.toContain('LOJA FICTICIA');
  });

  it('o UPDATE gravou, a resposta se perdeu e outra mão trocou UMA das colunas: 503, nunca "Nada foi alterado" com a edição no banco', async () => {
    // Revisão de 17/09/2026. A releitura era tudo ou nada: bastava uma coluna do
    // patch fora do valor mandado para o service dizer "não gravou" — e a API
    // respondia 500 "Nada foi alterado" com o WhatsApp já trocado no banco e
    // `customer_changes` VAZIO (sem cartão, sem push, sem fila do Control). E a
    // segunda tentativa, com o mesmo formulário, levava 409 pela própria edição.
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const banco = novoBanco({ customers: [cliente()] });
    let gravou = false;
    banco.interceptar = (c, b) => {
      if (c.tabela !== 'customers' || c.operacao !== 'update' || gravou) return undefined;
      gravou = true;
      aplicar(c, b); // o UPDATE commitou as duas colunas…
      doCliente(b)['email'] = 'terceiro@exemplo.com'; // …e outra mão trocou só o e-mail
      return REDE_CAIU; // a resposta se perdeu (502/504 do gateway)
    };
    const { res, corpo, fake } = await editar(banco, {
      novo: { whatsapp: '32988880000', email: 'novo@exemplo.com' },
      vistos: { whatsapp: '32999990000', email: 'loja@exemplo.com' },
    });

    expect(res.statusCode).toBe(503);
    expect(corpo['code']).toBe('GRAVACAO_NAO_CONFIRMADA');
    expect(String(corpo['error'])).not.toContain('Nada foi alterado');
    // A edição ESTÁ no banco: o whatsapp saiu de `antes` e está no valor mandado.
    expect(doCliente(banco)['whatsapp']).toBe('32988880000');
    expect(gravacoesEm(fake)).toEqual(['customers.update']);
    expect(historico(banco)).toHaveLength(0);
    const mensagens = log.mock.calls.map((c) => String(c[0])).join('\n');
    expect(mensagens).toContain('ALERTA');
    expect(mensagens).toContain(CLIENTE_ID);
    expect(mensagens).not.toContain('LOJA FICTICIA');
  });

  it('o UPDATE não gravou e outra mão mexeu numa das colunas: 503, porque "tudo como antes" é o único "nada mudou"', async () => {
    // O contrário do caso acima: nenhuma coluna ficou com o valor da edição, mas
    // uma está num terceiro valor — não dá para afirmar que nada foi alterado.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const banco = novoBanco({ customers: [cliente()] });
    banco.interceptar = (c, b) => {
      if (c.tabela !== 'customers' || c.operacao !== 'update') return undefined;
      doCliente(b)['email'] = 'terceiro@exemplo.com';
      return REDE_CAIU;
    };
    const { res, corpo, fake } = await editar(banco, {
      novo: { whatsapp: '32988880000', email: 'novo@exemplo.com' },
      vistos: { whatsapp: '32999990000', email: 'loja@exemplo.com' },
    });

    expect(res.statusCode).toBe(503);
    expect(corpo['code']).toBe('GRAVACAO_NAO_CONFIRMADA');
    expect(doCliente(banco)['whatsapp']).toBe('32999990000');
    expect(gravacoesEm(fake)).toEqual(['customers.update']);
    expect(historico(banco)).toHaveLength(0);
  });

  it('o histórico gravou e a resposta se perdeu: a linha é achada pelo id gerado na API e a edição fica — 200, sem pendência fantasma', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const banco = novoBanco({ customers: [cliente()] });
    banco.interceptar = (c, b) => {
      if (c.tabela !== 'customer_changes' || c.operacao !== 'insert') return undefined;
      aplicar(c, b);
      return REDE_CAIU;
    };
    const { res, corpo, fake } = await editar(banco, EMAIL_NOVO, TOKEN.rep);

    // Antes: 503 "Nada foi alterado", o cliente desfeito — e a linha do
    // histórico ficava pendente, pedindo ao financeiro um valor que o app não tem.
    expect(res.statusCode).toBe(200);
    expect(doCliente(banco)['email']).toBe('novo@exemplo.com');
    expect(gravacoesEm(fake)).toEqual(['customers.update', 'customer_changes.insert']);
    const idMandado = (fake.ultimaGravacao('customer_changes', 'insert')!.valores as Corpo)['id'];
    expect(String(idMandado)).toMatch(/^[0-9a-f-]{36}$/);
    expect(historico(banco)).toHaveLength(1);
    expect(historico(banco)[0]!['id']).toBe(idMandado);
    expect((corpo['alteracao'] as Corpo)['id']).toBe(idMandado);
    expect(aviso).toHaveBeenCalledTimes(1);
  });

  it('o insert do histórico respondeu erro e a conferência não responde: apaga a linha pelo id e só então desfaz — 503, sem pendência', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const banco = novoBanco({ customers: [cliente()] });
    let inseriu = false;
    banco.interceptar = (c, b) => {
      if (c.tabela !== 'customer_changes') return undefined;
      if (c.operacao === 'insert') {
        inseriu = true;
        aplicar(c, b);
        return REDE_CAIU;
      }
      return inseriu && c.operacao === 'select' ? REDE_CAIU : undefined;
    };
    const { res, corpo, fake } = await editar(banco, EMAIL_NOVO, TOKEN.rep);

    expect(res.statusCode).toBe(503);
    expect(corpo['code']).toBe('ALTERACAO_NAO_REGISTRADA');
    expect(gravacoesEm(fake)).toEqual([
      'customers.update',
      'customer_changes.insert',
      'customer_changes.delete',
      'customers.update',
    ]);
    const idMandado = (fake.ultimaGravacao('customer_changes', 'insert')!.valores as Corpo)['id'];
    expect(fake.filtrosDe('customer_changes', 'eq').map((f) => f.args)).toContainEqual(['id', idMandado]);
    expect(historico(banco)).toHaveLength(0);
    expect(doCliente(banco)['email']).toBe('loja@exemplo.com');
    expect(aviso).not.toHaveBeenCalled();
  });

  it('nem a conferência nem o apagar respondem: NÃO desfaz o cliente (seria a pendência fantasma) — 500 e alerta', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const banco = novoBanco({ customers: [cliente()] });
    let inseriu = false;
    banco.interceptar = (c, b) => {
      if (c.tabela !== 'customer_changes') return undefined;
      if (c.operacao === 'insert') {
        inseriu = true;
        aplicar(c, b);
        return REDE_CAIU;
      }
      return inseriu ? REDE_CAIU : undefined;
    };
    const { res, corpo, fake } = await editar(banco, EMAIL_NOVO, TOKEN.rep);

    expect(res.statusCode).toBe(500);
    expect(corpo['code']).toBe('ALTERACAO_SEM_HISTORICO');
    expect(gravacoesEm(fake)).toEqual(['customers.update', 'customer_changes.insert', 'customer_changes.delete']);
    expect(doCliente(banco)['email']).toBe('novo@exemplo.com');
    const mensagens = log.mock.calls.map((c) => String(c[0])).join('\n');
    expect(mensagens).toContain('ALERTA');
    expect(mensagens).not.toContain('LOJA FICTICIA');
  });

  // O desfazer é um UPDATE como os outros: a resposta dele também se perde.
  /** O histórico falha de verdade (login apagado com o token ainda válido) e o desfazer responde como `desfazer` mandar. */
  const historicoRecusadoE = (desfazer: (c: ConsultaFeita, b: Banco) => RespostaTabela | undefined, depois?: (c: ConsultaFeita) => RespostaTabela | undefined) => {
    let updates = 0;
    return (c: ConsultaFeita, b: Banco): RespostaTabela | undefined => {
      if (c.tabela === 'customer_changes' && c.operacao === 'insert') {
        return { data: null, error: { message: 'insert or update on table "customer_changes" violates foreign key constraint', code: '23503' } };
      }
      if (c.tabela !== 'customers') return undefined;
      if (c.operacao === 'update') {
        updates++;
        return updates === 2 ? desfazer(c, b) : undefined;
      }
      return updates >= 2 ? depois?.(c) : undefined;
    };
  };

  it('o desfazer gravou e a resposta se perdeu: relê, vê o cadastro de volta — 503 ALTERACAO_NAO_REGISTRADA, sem alerta falso', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const banco = novoBanco({ customers: [cliente()] });
    banco.interceptar = historicoRecusadoE((c, b) => {
      aplicar(c, b);
      return REDE_CAIU;
    });
    const { res, corpo, fake } = await editar(banco, EMAIL_NOVO, TOKEN.rep);

    // Antes: 500 "O cadastro foi alterado… avise o suporte" com o cadastro já de
    // volta — a tela fechava o diálogo e a digitação sumia.
    expect(res.statusCode).toBe(503);
    expect(corpo['code']).toBe('ALTERACAO_NAO_REGISTRADA');
    expect(doCliente(banco)['email']).toBe('loja@exemplo.com');
    expect(historico(banco)).toHaveLength(0);
    expect(gravacoesEm(fake)).toEqual(['customers.update', 'customer_changes.insert', 'customers.update']);
    const mensagens = log.mock.calls.map((c) => String(c[0])).join('\n');
    expect(mensagens).not.toContain('SEM HISTÓRICO');
    expect(aviso).not.toHaveBeenCalled();
  });

  it('o desfazer respondeu erro e NÃO desfez: relê, vê a edição ainda lá — 500 ALTERACAO_SEM_HISTORICO com alerta', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const banco = novoBanco({ customers: [cliente()] });
    banco.interceptar = historicoRecusadoE(() => REDE_CAIU);
    const { res, corpo } = await editar(banco, EMAIL_NOVO, TOKEN.rep);

    expect(res.statusCode).toBe(500);
    expect(corpo['code']).toBe('ALTERACAO_SEM_HISTORICO');
    expect(doCliente(banco)['email']).toBe('novo@exemplo.com');
    const mensagens = log.mock.calls.map((c) => String(c[0])).join('\n');
    expect(mensagens).toContain('SEM HISTÓRICO');
  });

  it('o desfazer respondeu erro e nem a releitura responde: 503 GRAVACAO_NAO_CONFIRMADA — nem "alterado" nem "nada mudou"', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const banco = novoBanco({ customers: [cliente()] });
    banco.interceptar = historicoRecusadoE(
      (c, b) => {
        aplicar(c, b);
        return REDE_CAIU;
      },
      () => REDE_CAIU,
    );
    const { res, corpo } = await editar(banco, EMAIL_NOVO, TOKEN.rep);

    expect(res.statusCode).toBe(503);
    expect(corpo['code']).toBe('GRAVACAO_NAO_CONFIRMADA');
    const mensagens = log.mock.calls.map((c) => String(c[0])).join('\n');
    expect(mensagens).toContain('ALERTA');
    expect(mensagens).not.toContain('LOJA FICTICIA');
  });

  it('gravou e registrou, mas a releitura da ficha falhou: 500 SALVO_SEM_RELER_A_FICHA — nunca 404 — e o aviso sai', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const banco = novoBanco({ customers: [cliente()] });
    let gravou = false;
    banco.interceptar = (c) => {
      if (c.tabela === 'customers' && c.operacao === 'update') gravou = true;
      else if (gravou && c.tabela === 'customers' && c.operacao === 'select') {
        return { data: null, error: { message: 'fetch failed' } };
      }
      return undefined;
    };
    const { res, corpo } = await editar(banco, EMAIL_NOVO, TOKEN.rep);

    // A edição ficou: dizer "cliente não encontrado" faria a pessoa digitar tudo de novo.
    expect(res.statusCode).toBe(500);
    expect(corpo['code']).toBe('SALVO_SEM_RELER_A_FICHA');
    expect(String(corpo['error'])).toContain('foi salvo');
    expect(doCliente(banco)['email']).toBe('novo@exemplo.com');
    expect(historico(banco)).toHaveLength(1);
    expect(corpo['erp_pendente']).toBe(true);
    expect(aviso).toHaveBeenCalledTimes(1);
  });

  it('sem a 051: 503 MIGRACAO_PENDENTE e nada é lido nem gravado no cliente', async () => {
    const banco = novoBanco({ customers: [cliente()] });
    banco.ausentes.add('customer_changes');
    const { res, fake, corpo } = await editar(banco, EMAIL_NOVO, TOKEN.admin);

    expect(res.statusCode).toBe(503);
    expect(corpo['code']).toBe('MIGRACAO_PENDENTE');
    expect(String(corpo['error'])).toContain('051');
    expect(fake.gravacoes).toHaveLength(0);
    expect(fake.filtrosDe('customers')).toHaveLength(0);
  });

  it('banco sem resposta sobre a 051: 503 TENTE_DE_NOVO e nada gravado', async () => {
    const banco = novoBanco({ customers: [cliente()] });
    banco.mudas.add('customer_changes');
    const { res, fake, corpo } = await editar(banco, EMAIL_NOVO, TOKEN.admin);

    expect(res.statusCode).toBe(503);
    expect(corpo['code']).toBe('TENTE_DE_NOVO');
    expect(fake.gravacoes).toHaveLength(0);
  });

  it('sem a 041: endereço é 503 MIGRACAO_PENDENTE; WhatsApp segue', async () => {
    const semEndereco = novoBanco({ customers: [cliente()] });
    semEndereco.ausentes.add('customers.cep');
    const r1 = await editar(semEndereco, { novo: { numero: '12' }, vistos: { numero: '10' } }, TOKEN.admin);
    expect(r1.res.statusCode).toBe(503);
    expect(r1.corpo['code']).toBe('MIGRACAO_PENDENTE');
    expect(String(r1.corpo['error'])).toContain('041');
    expect(r1.fake.gravacoes).toHaveLength(0);

    vi.resetModules();
    const soWhatsapp = novoBanco({ customers: [cliente()] });
    soWhatsapp.ausentes.add('customers.cep');
    const r2 = await editar(soWhatsapp, WHATSAPP_NOVO, TOKEN.admin);
    expect(r2.res.statusCode).toBe(200);
    expect(doCliente(soWhatsapp)['whatsapp']).toBe('32988880000');
  });
});

// ─── O aviso ao financeiro ───────────────────────────────────────────────────

describe('PATCH /customers/:id/cadastro — o aviso', () => {
  it('cliente no Control e canal de cadastro fora da API: avisa, sem mandar para quem editou', async () => {
    const banco = novoBanco({ customers: [cliente()] });
    const { corpo } = await editar(banco, EMAIL_NOVO, TOKEN.rep);

    expect(aviso).toHaveBeenCalledTimes(1);
    expect(aviso).toHaveBeenCalledWith(
      EMPRESA,
      { id: CLIENTE_ID, name: 'LOJA FICTICIA LTDA', erp_id: '09999' },
      ['email'],
      'rep-ficticio',
    );
    expect(corpo['control_puxa_pela_api']).toBe(false);
  });

  it('canal de cadastro na API: sem push (o Control puxa), mas a alteração fica pendente', async () => {
    const banco = novoBanco({ customers: [cliente()] });
    banco.tabelas['companies']![0]!['canal_cadastro'] = 'api';
    const { res, corpo } = await editar(banco, EMAIL_NOVO, TOKEN.rep);

    expect(res.statusCode).toBe(200);
    expect(aviso).not.toHaveBeenCalled();
    expect(corpo['avisados']).toBeNull();
    expect(corpo['control_puxa_pela_api']).toBe(true);
    expect(historico(banco)[0]!['erp_pendente']).toBe(true);
  });

  it('o push em si: financeiro e admin, menos quem editou, com a ficha e a tag do cliente', async () => {
    vi.resetModules();
    const fake = criarSupabaseFake({
      users: { data: [{ id: 'rep-ficticio' }, { id: 'fin-ficticio' }], error: null },
      push_subscriptions: { data: [{ endpoint: 'https://push/ficticio', p256dh: 'p', auth: 'a' }], error: null },
    });
    vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
    vi.doMock('../apps/api/src/config/env.js', () => ({
      env: { VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'mailto:teste@teste.local' },
    }));
    const enviados: string[] = [];
    vi.doMock('../apps/api/src/modules/push/webpush.js', () => ({
      webpush: {
        setVapidDetails: vi.fn(),
        sendNotification: vi.fn(async (_a: unknown, corpo: string) => {
          enviados.push(corpo);
        }),
      },
    }));
    const avisos = await import('../apps/api/src/modules/push/push.avisos.js');

    // O campo solto do exemplo era o WhatsApp até 22/09/2026 — hoje só do app,
    // fora da frase do push (ver o teste da edição mista, abaixo).
    const r = await avisos.avisarCadastroAlteradoNoControl(
      EMPRESA,
      { id: CLIENTE_ID, name: 'LOJA FICTICIA LTDA', erp_id: '09999' },
      ['email', 'cep', 'address'],
      'rep-ficticio',
    );

    expect(r).toEqual({ financeiro: 1, admin: 1 });
    expect(fake.filtrosDe('users', 'in').map((f) => f.args[1])).toEqual([['financeiro'], ['admin']]);
    for (const f of fake.filtrosDe('push_subscriptions', 'in')) {
      expect(f.args[1]).toEqual(['fin-ficticio']); // quem editou fica de fora
    }
    const push = JSON.parse(enviados[0]!) as Corpo;
    expect(push).toMatchObject({
      title: 'Cadastro alterado — atualize no Control',
      url: `/customers/${CLIENTE_ID}`,
      tag: `cliente-alterado-${CLIENTE_ID}`,
    });
    expect(String(push['body'])).toContain('E-mail, Endereço');
    expect(String(push['body'])).toContain('09999');
  });
});

// ─── A leitura ───────────────────────────────────────────────────────────────

function alteracao(sobrescrever: Linha): Linha {
  return {
    id: crypto.randomUUID(),
    company_id: EMPRESA,
    customer_id: CLIENTE_ID,
    alterado_por: 'rep-ficticio',
    alterado_por_nome: 'REP FICTICIO',
    alterado_em: '2026-09-10T12:00:00.000Z',
    // Era o WhatsApp até 22/09/2026 — hoje só do app, nunca pendência. A fila, a
    // ficha, a baixa e o lote são provados com um campo que vai ao Control.
    campos: { email: { antes: 'loja@exemplo.com', depois: 'novo@exemplo.com' } },
    erp_pendente: true,
    erp_atualizado_em: null,
    erp_atualizado_por: null,
    erp_atualizado_por_nome: null,
    erp_atualizado_via: null,
    ...sobrescrever,
  };
}

async function ler(banco: Banco, url: string, token: string) {
  const { app, fake } = await subirApp(banco);
  const res = await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
  await app.close();
  return { res, fake, corpo: res.json() as Corpo };
}

describe('GET /customers/:id — as alterações na ficha', () => {
  it('todas as pendentes e as 10 últimas das demais, das mais novas para as mais antigas', async () => {
    const dia = (n: number) => `2026-09-${String(n).padStart(2, '0')}T12:00:00.000Z`;
    const resolvidas = Array.from({ length: 12 }, (_, i) =>
      alteracao({
        alterado_em: dia(i + 1),
        erp_atualizado_em: dia(i + 2),
        erp_atualizado_por_nome: 'FINANCEIRO FICTICIO',
        erp_atualizado_via: 'app',
      }),
    );
    const pendentes = [alteracao({ alterado_em: dia(3) }), alteracao({ alterado_em: dia(15) })];
    const semControl = alteracao({ alterado_em: dia(14), erp_pendente: false });
    const deOutro = alteracao({ customer_id: OUTRO_CLIENTE_ID, alterado_em: dia(16) });
    const banco = novoBanco({
      customers: [cliente()],
      customer_changes: [...resolvidas, ...pendentes, semControl, deOutro],
    });

    const { res, corpo } = await ler(banco, `/customers/${CLIENTE_ID}`, TOKEN.financeiro);

    expect(res.statusCode).toBe(200);
    const lista = (corpo['data'] as { alteracoes: Array<Corpo> }).alteracoes;
    // 2 pendentes + as 10 mais novas entre as 13 demais (12 resolvidas + a sem Control).
    expect(lista).toHaveLength(12);
    expect(lista.map((a) => a['alterado_em'])).toEqual([...lista.map((a) => String(a['alterado_em']))].sort().reverse());
    expect(lista.filter((a) => a['erp_pendente'] === true && a['erp_atualizado_em'] === null)).toHaveLength(2);
    expect(lista.some((a) => a['alterado_em'] === dia(3) && a['erp_atualizado_em'] === null)).toBe(true); // pendente antiga não some
    expect(lista.some((a) => a['customer_id'] === OUTRO_CLIENTE_ID)).toBe(false);
    expect(lista[0]).toMatchObject({ alterado_em: dia(15), campos: { email: { antes: 'loja@exemplo.com', depois: 'novo@exemplo.com' } } });
  });

  it('sem a 051 a ficha abre sem o campo', async () => {
    const banco = novoBanco({ customers: [cliente()] });
    banco.ausentes.add('customer_changes');
    const { res, corpo } = await ler(banco, `/customers/${CLIENTE_ID}`, TOKEN.financeiro);
    expect(res.statusCode).toBe(200);
    expect(corpo['data']).not.toHaveProperty('alteracoes');
  });
});

describe('GET /customers/alteracoes-pendentes — a fila do Control', () => {
  it('um item por cliente com pendência, a mais antiga primeiro; só da empresa', async () => {
    const banco = novoBanco({
      customers: [
        cliente(),
        cliente({ id: OUTRO_CLIENTE_ID, name: 'OUTRA LOJA FICTICIA', erp_id: '08888', rep_erp_id: '00780' }),
      ],
      customer_changes: [
        alteracao({ alterado_em: '2026-09-12T10:00:00.000Z' }),
        alteracao({ alterado_em: '2026-09-15T10:00:00.000Z' }),
        alteracao({ alterado_em: '2026-09-01T10:00:00.000Z', erp_atualizado_em: '2026-09-02T10:00:00.000Z', erp_atualizado_via: 'app' }),
        alteracao({ customer_id: OUTRO_CLIENTE_ID, alterado_em: '2026-09-11T10:00:00.000Z' }),
        alteracao({ customer_id: OUTRO_CLIENTE_ID, alterado_em: '2026-09-05T10:00:00.000Z', erp_pendente: false }),
        alteracao({ company_id: OUTRA_EMPRESA, customer_id: OUTRO_CLIENTE_ID, alterado_em: '2026-08-01T10:00:00.000Z' }),
      ],
    });

    const { res, corpo } = await ler(banco, '/customers/alteracoes-pendentes', TOKEN.financeiro);

    expect(res.statusCode).toBe(200);
    expect(corpo['migracao_pendente']).toBe(false);
    expect(corpo['data']).toEqual([
      {
        customer_id: OUTRO_CLIENTE_ID,
        name: 'OUTRA LOJA FICTICIA',
        erp_id: '08888',
        rep_erp_id: '00780',
        pendentes: 1,
        desde: '2026-09-11T10:00:00.000Z',
        ultima_em: '2026-09-11T10:00:00.000Z',
      },
      {
        customer_id: CLIENTE_ID,
        name: 'LOJA FICTICIA LTDA',
        erp_id: '09999',
        rep_erp_id: '00779',
        pendentes: 2,
        desde: '2026-09-12T10:00:00.000Z',
        ultima_em: '2026-09-15T10:00:00.000Z',
      },
    ]);
  });

  it('gerente vê; representante e relacionamento não', async () => {
    expect((await ler(novoBanco(), '/customers/alteracoes-pendentes', TOKEN.gerente)).res.statusCode).toBe(200);
    vi.resetModules();
    expect((await ler(novoBanco(), '/customers/alteracoes-pendentes', TOKEN.rep)).res.statusCode).toBe(403);
    vi.resetModules();
    expect((await ler(novoBanco(), '/customers/alteracoes-pendentes', TOKEN.relacionamento)).res.statusCode).toBe(403);
  });

  it('sem a 051: lista vazia com migracao_pendente', async () => {
    const banco = novoBanco();
    banco.ausentes.add('customer_changes');
    const { res, corpo } = await ler(banco, '/customers/alteracoes-pendentes', TOKEN.admin);
    expect(res.statusCode).toBe(200);
    expect(corpo).toEqual({ data: [], migracao_pendente: true });
  });
});

// ─── "Já atualizei no Control" ───────────────────────────────────────────────

async function confirmar(banco: Banco, payload: unknown, token = TOKEN.financeiro, id = CLIENTE_ID) {
  const { app, fake } = await subirApp(banco);
  const res = await app.inject({
    method: 'POST',
    url: `/customers/${id}/alteracoes/confirmar`,
    headers: { authorization: `Bearer ${token}` },
    payload: payload as Corpo,
  });
  await app.close();
  return { res, fake, corpo: res.json() as Corpo };
}

describe('POST /customers/:id/alteracoes/confirmar', () => {
  const IDS = {
    pendente: '10000000-0000-4000-8000-000000000001',
    jaResolvida: '10000000-0000-4000-8000-000000000002',
    deOutroCliente: '10000000-0000-4000-8000-000000000003',
    deOutraEmpresa: '10000000-0000-4000-8000-000000000004',
    naoVista: '10000000-0000-4000-8000-000000000005',
  };

  function bancoDaConfirmacao() {
    return novoBanco({
      customers: [cliente()],
      customer_changes: [
        alteracao({ id: IDS.pendente }),
        alteracao({ id: IDS.jaResolvida, erp_atualizado_em: '2026-09-11T10:00:00.000Z', erp_atualizado_por_nome: 'ADMIN FICTICIO', erp_atualizado_via: 'app' }),
        alteracao({ id: IDS.deOutroCliente, customer_id: OUTRO_CLIENTE_ID }),
        alteracao({ id: IDS.deOutraEmpresa, company_id: OUTRA_EMPRESA }),
        alteracao({ id: IDS.naoVista, alterado_em: '2026-09-16T10:00:00.000Z' }),
      ],
    });
  }

  it('marca só os ids vistos, pendentes, deste cliente e desta empresa', async () => {
    const banco = bancoDaConfirmacao();
    const { res, corpo } = await confirmar(banco, {
      ids: [IDS.pendente, IDS.jaResolvida, IDS.deOutroCliente, IDS.deOutraEmpresa],
    });

    expect(res.statusCode).toBe(200);
    const data = corpo['data'] as { confirmadas: string[]; alteracoes: Array<Corpo> };
    expect(data.confirmadas).toEqual([IDS.pendente]);
    const porId = (id: string) => historico(banco).find((l) => l['id'] === id)!;
    expect(porId(IDS.pendente)).toMatchObject({
      erp_atualizado_por: 'fin-ficticio',
      erp_atualizado_por_nome: 'FINANCEIRO FICTICIO',
      erp_atualizado_via: 'app',
    });
    expect(typeof porId(IDS.pendente)['erp_atualizado_em']).toBe('string');
    expect(porId(IDS.jaResolvida)['erp_atualizado_por_nome']).toBe('ADMIN FICTICIO'); // não regrava
    expect(porId(IDS.deOutroCliente)['erp_atualizado_em']).toBeNull();
    expect(porId(IDS.deOutraEmpresa)['erp_atualizado_em']).toBeNull();
    // A edição que chegou depois (não vista) continua pendente — e aparece na lista devolvida.
    expect(porId(IDS.naoVista)['erp_atualizado_em']).toBeNull();
    expect(data.alteracoes.find((a) => a['id'] === IDS.naoVista)!['erp_atualizado_em']).toBeNull();
    expect(data.alteracoes.find((a) => a['id'] === IDS.pendente)!['erp_atualizado_via']).toBe('app');
  });

  for (const [papel, token] of [
    ['gerente', TOKEN.gerente],
    ['representante', TOKEN.rep],
    ['venda interna', TOKEN.vendaInterna],
  ] as const) {
    it(`${papel}: 403, nada marcado`, async () => {
      const banco = bancoDaConfirmacao();
      const { res, fake } = await confirmar(banco, { ids: [IDS.pendente] }, token);
      expect(res.statusCode).toBe(403);
      expect(fake.gravacoes).toHaveLength(0);
    });
  }

  it('admin confirma', async () => {
    const { res } = await confirmar(bancoDaConfirmacao(), { ids: [IDS.pendente] }, TOKEN.admin);
    expect(res.statusCode).toBe(200);
  });

  it('lista vazia, id que não é UUID ou mais de 50: 400', async () => {
    for (const ids of [[], ['nao-e-uuid'], Array.from({ length: 51 }, () => crypto.randomUUID())]) {
      vi.resetModules();
      const { res, fake } = await confirmar(bancoDaConfirmacao(), { ids });
      expect(res.statusCode).toBe(400);
      expect(fake.gravacoes).toHaveLength(0);
    }
  });

  it('cliente de outra empresa: 404', async () => {
    const banco = bancoDaConfirmacao();
    banco.tabelas['customers']![0]!['company_id'] = OUTRA_EMPRESA;
    const { res, fake } = await confirmar(banco, { ids: [IDS.pendente] });
    expect(res.statusCode).toBe(404);
    expect(fake.gravacoes).toHaveLength(0);
  });

  it('sem a 051: 503 MIGRACAO_PENDENTE', async () => {
    const banco = bancoDaConfirmacao();
    banco.ausentes.add('customer_changes');
    const { res, corpo } = await confirmar(banco, { ids: [IDS.pendente] });
    expect(res.statusCode).toBe(503);
    expect(corpo['code']).toBe('MIGRACAO_PENDENTE');
  });

  // ─── A resposta que se perde depois do commit (revisão de 17/09/2026) ──────
  //
  // O postgrest-js não repete PATCH: o 502/504 do gateway (ou a conexão que
  // cai) DEPOIS de o banco gravar a baixa chega ao service como erro. A API
  // respondia 500 "Nada foi marcado — tente de novo" com a baixa gravada, e o
  // cartão seguia pedindo o que já estava feito.
  const aplicarSemInterceptar = (c: ConsultaFeita, b: Banco) => responderDo({ ...b, interceptar: undefined })(c.tabela)(c);
  const GATEWAY: RespostaTabela = { data: null, error: { message: '<html>504 Gateway Time-out</html>' } };
  const ehABaixa = (c: ConsultaFeita) => c.tabela === 'customer_changes' && c.operacao === 'update';

  it('a baixa gravou e a resposta se perdeu: relê, acha a baixa DESTA confirmação — 200 com ela em confirmadas, nunca "Nada foi marcado"', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const banco = bancoDaConfirmacao();
    let perdida = false;
    banco.interceptar = (c, b) => {
      if (perdida || !ehABaixa(c)) return undefined;
      perdida = true;
      aplicarSemInterceptar(c, b); // o UPDATE commitou…
      return GATEWAY; // …e a resposta se perdeu
    };
    const { res, corpo } = await confirmar(banco, { ids: [IDS.pendente, IDS.jaResolvida] });

    expect(perdida).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(String(corpo['error'] ?? '')).not.toContain('Nada foi marcado');
    const data = corpo['data'] as { confirmadas: string[]; alteracoes: Array<Corpo> };
    // Só a que ESTA confirmação marcou: a já resolvida por outra pessoa não conta.
    expect(data.confirmadas).toEqual([IDS.pendente]);
    const porId = (id: string) => historico(banco).find((l) => l['id'] === id)!;
    expect(porId(IDS.pendente)).toMatchObject({ erp_atualizado_por: 'fin-ficticio', erp_atualizado_via: 'app' });
    expect(porId(IDS.jaResolvida)['erp_atualizado_por_nome']).toBe('ADMIN FICTICIO');
    // A lista devolvida já tira a baixa do cartão.
    expect(data.alteracoes.find((a) => a['id'] === IDS.pendente)!['erp_atualizado_via']).toBe('app');
    expect(data.alteracoes.find((a) => a['id'] === IDS.naoVista)!['erp_atualizado_em']).toBeNull();
  });

  it('a baixa respondeu erro e nem a releitura responde: 503 CONFIRMACAO_NAO_CONFIRMADA — nunca "Nada foi marcado"', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const banco = bancoDaConfirmacao();
    let gravou = false;
    banco.interceptar = (c, b) => {
      if (ehABaixa(c)) {
        gravou = true;
        aplicarSemInterceptar(c, b);
        return GATEWAY;
      }
      return gravou && c.tabela === 'customer_changes' ? GATEWAY : undefined;
    };
    const { res, corpo } = await confirmar(banco, { ids: [IDS.pendente] });

    expect(res.statusCode).toBe(503);
    expect(corpo['code']).toBe('CONFIRMACAO_NAO_CONFIRMADA');
    expect(String(corpo['error'])).not.toContain('Nada foi marcado');
    expect(String(corpo['error'])).toContain('conferir');
  });

  it('a baixa respondeu erro e NÃO gravou: 500 UPDATE_FAILED "Nada foi marcado" — aí é verdade', async () => {
    const banco = bancoDaConfirmacao();
    banco.interceptar = (c) => (ehABaixa(c) ? GATEWAY : undefined);
    const { res, corpo } = await confirmar(banco, { ids: [IDS.pendente] });

    expect(res.statusCode).toBe(500);
    expect(corpo['code']).toBe('UPDATE_FAILED');
    expect(String(corpo['error'])).toContain('Nada foi marcado');
    expect(historico(banco).find((l) => l['id'] === IDS.pendente)!['erp_atualizado_em']).toBeNull();
  });
});

// ─── As funções em lote da API de Parceiro ───────────────────────────────────

async function carregarAlteracoes(banco: Banco) {
  const fake = fakeDo(banco);
  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
  const mod = await import('../apps/api/src/modules/customers/customers.alteracoes.service.js');
  return { ...mod, fake };
}

describe('alterações em lote — para a API de Parceiro', () => {
  function bancoDoLote() {
    return novoBanco({
      customer_changes: [
        alteracao({ id: 'a2', alterado_em: '2026-09-15T10:00:00.000Z', campos: { cep: { antes: null, depois: '36000000' }, address: { antes: 'x', depois: 'y' } } }),
        alteracao({ id: 'a1', alterado_em: '2026-09-12T10:00:00.000Z', campos: { name: { antes: 'A', depois: 'B' } } }),
        alteracao({ id: 'resolvida', erp_atualizado_em: '2026-09-13T10:00:00.000Z', erp_atualizado_via: 'app' }),
        alteracao({ id: 'sem-control', erp_pendente: false }),
        alteracao({ id: 'b1', customer_id: OUTRO_CLIENTE_ID }),
        alteracao({ id: 'outra-empresa', company_id: OUTRA_EMPRESA }),
      ],
    });
  }

  it('lê as pendentes da empresa agrupadas por cliente, da mais antiga para a mais nova', async () => {
    const { lerAlteracoesPendentesEmLote } = await carregarAlteracoes(bancoDoLote());
    const mapa = await lerAlteracoesPendentesEmLote(EMPRESA);
    expect([...mapa!.keys()].sort()).toEqual([CLIENTE_ID, OUTRO_CLIENTE_ID].sort());
    expect(mapa!.get(CLIENTE_ID)!.map((a) => a.id)).toEqual(['a1', 'a2']);
  });

  it('com a lista de clientes, filtra por ela (in) — uma consulta por lote, nunca por cliente', async () => {
    const { lerAlteracoesPendentesEmLote, fake } = await carregarAlteracoes(bancoDoLote());
    const mapa = await lerAlteracoesPendentesEmLote(EMPRESA, [OUTRO_CLIENTE_ID, OUTRO_CLIENTE_ID]);
    expect([...mapa!.keys()]).toEqual([OUTRO_CLIENTE_ID]);
    const ins = fake.filtrosDe('customer_changes', 'in');
    expect(ins).toHaveLength(1);
    expect(ins[0]!.args).toEqual(['customer_id', [OUTRO_CLIENTE_ID]]);
  });

  it('sem a 051: null (quem chama segue como antes); banco mudo: lança', async () => {
    const semTabela = bancoDoLote();
    semTabela.ausentes.add('customer_changes');
    expect(await (await carregarAlteracoes(semTabela)).lerAlteracoesPendentesEmLote(EMPRESA)).toBeNull();

    vi.resetModules();
    const mudo = bancoDoLote();
    mudo.mudas.add('customer_changes');
    await expect((await carregarAlteracoes(mudo)).lerAlteracoesPendentesEmLote(EMPRESA)).rejects.toThrow();
  });

  it('alterado_no_app: a mais recente pendente e os nomes do contrato', async () => {
    const { lerAlteracoesPendentesEmLote, alteradoNoApp } = await carregarAlteracoes(bancoDoLote());
    const mapa = await lerAlteracoesPendentesEmLote(EMPRESA);
    expect(alteradoNoApp(mapa!.get(CLIENTE_ID))).toEqual({
      em: '2026-09-15T10:00:00.000Z',
      campos: ['razao_social', 'endereco'],
    });
    expect(alteradoNoApp(undefined)).toBeNull();
    expect(alteradoNoApp([])).toBeNull();
  });

  it('o eco igual resolve com via api — só o que alcançou, só pendente, só da empresa', async () => {
    const banco = bancoDoLote();
    const { lerAlteracoesPendentesEmLote, alteracoesQueAlcancaram, colunasPendentes, resolverAlteracoesPelaApi } =
      await carregarAlteracoes(banco);
    const doCliente = (await lerAlteracoesPendentesEmLote(EMPRESA))!.get(CLIENTE_ID)!;
    expect([...colunasPendentes(doCliente)].sort()).toEqual(['address', 'cep', 'name']);

    // O Control devolveu a razão social igual; o endereço ainda não.
    const ids = alteracoesQueAlcancaram(doCliente, new Set(['name']));
    expect(ids).toEqual(['a1']);

    const marcadas = await resolverAlteracoesPelaApi(EMPRESA, [...ids, 'resolvida', 'outra-empresa']);
    expect(marcadas).toEqual(['a1']);
    const porId = (id: string) => historico(banco).find((l) => l['id'] === id)!;
    expect(porId('a1')).toMatchObject({ erp_atualizado_via: 'api', erp_atualizado_por: null });
    expect(typeof porId('a1')['erp_atualizado_em']).toBe('string');
    expect(porId('a2')['erp_atualizado_em']).toBeNull();
    expect(porId('outra-empresa')['erp_atualizado_em']).toBeNull();
    expect(porId('resolvida')['erp_atualizado_via']).toBe('app');
    expect(await resolverAlteracoesPelaApi(EMPRESA, [])).toEqual([]);
  });
});

// ─── O WhatsApp é só do app (22/09/2026) ─────────────────────────────────────
//
// Pedido do Yan: "que eu possa alterar o wtss do cliente sem ter que subir pro
// control, numero uma coisa numero de wtss outro". A edição só de WhatsApp grava
// o histórico mas não fica pendente — nem push, nem fila, nem alterado_no_app.
// Na mista, a linha fica pendente pelo outro campo, com o WhatsApp dentro dela.

describe('PATCH /customers/:id/cadastro — o WhatsApp é só do app (22/09/2026)', () => {
  it('só o WhatsApp, num cliente com código: grava o histórico, erp_pendente = false, sem push ao financeiro', async () => {
    const banco = novoBanco({ customers: [cliente()] });
    const { res, corpo } = await editar(banco, WHATSAPP_NOVO, TOKEN.rep);

    expect(res.statusCode).toBe(200);
    expect(doCliente(banco)['whatsapp']).toBe('32988880000');
    expect(historico(banco)).toHaveLength(1);
    expect(historico(banco)[0]).toMatchObject({
      campos: { whatsapp: { antes: '32999990000', depois: '32988880000' } },
      erp_pendente: false,
    });
    expect(corpo['erp_pendente']).toBe(false);
    expect((corpo['alteracao'] as Corpo)['erp_pendente']).toBe(false);
    expect(corpo['avisados']).toBeNull();
    expect(aviso).not.toHaveBeenCalled();
  });

  it('só o WhatsApp não entra na fila da Minha área nem no alterado_no_app', async () => {
    const banco = novoBanco({ customers: [cliente()] });
    await editar(banco, WHATSAPP_NOVO, TOKEN.rep);
    expect(historico(banco)).toHaveLength(1);

    vi.resetModules();
    const { res, corpo } = await ler(banco, '/customers/alteracoes-pendentes', TOKEN.financeiro);
    expect(res.statusCode).toBe(200);
    expect(corpo['data']).toEqual([]);

    vi.resetModules();
    const { lerAlteracoesPendentesEmLote, alteradoNoApp } = await carregarAlteracoes(banco);
    const mapa = await lerAlteracoesPendentesEmLote(EMPRESA);
    expect(mapa!.get(CLIENTE_ID)).toBeUndefined();
    expect(alteradoNoApp(mapa!.get(CLIENTE_ID))).toBeNull();
  });

  it('mista (WhatsApp e e-mail): pendente pelo e-mail, o WhatsApp na mesma linha do histórico, e o financeiro avisado', async () => {
    const banco = novoBanco({ customers: [cliente()] });
    const { res, corpo } = await editar(
      banco,
      {
        novo: { whatsapp: '32988880000', email: 'novo@exemplo.com' },
        vistos: { whatsapp: '32999990000', email: 'loja@exemplo.com' },
      },
      TOKEN.rep,
    );

    expect(res.statusCode).toBe(200);
    expect(historico(banco)).toHaveLength(1);
    expect(historico(banco)[0]).toMatchObject({
      campos: {
        whatsapp: { antes: '32999990000', depois: '32988880000' },
        email: { antes: 'loja@exemplo.com', depois: 'novo@exemplo.com' },
      },
      erp_pendente: true,
    });
    expect(corpo['erp_pendente']).toBe(true);
    expect(aviso).toHaveBeenCalledTimes(1);

    // Para o Control, só o e-mail: as colunas pendentes e o alterado_no_app.
    vi.resetModules();
    const { lerAlteracoesPendentesEmLote, alteradoNoApp, colunasPendentes, alteracoesQueAlcancaram } =
      await carregarAlteracoes(banco);
    const doCliente = (await lerAlteracoesPendentesEmLote(EMPRESA))!.get(CLIENTE_ID)!;
    expect(doCliente).toHaveLength(1);
    expect([...colunasPendentes(doCliente)]).toEqual(['email']);
    expect(alteradoNoApp(doCliente)).toMatchObject({ campos: ['email'] });
    // O e-mail chegou ao Control: a linha está alcançada — o WhatsApp nunca vai chegar lá.
    expect(alteracoesQueAlcancaram(doCliente, new Set(['email']))).toEqual([historico(banco)[0]!['id']]);
  });

  it('a fila da Minha área não lista a linha só de WhatsApp gravada pendente antes da regra; a mista, sim', async () => {
    const banco = novoBanco({
      customers: [
        cliente(),
        cliente({ id: OUTRO_CLIENTE_ID, name: 'OUTRA LOJA FICTICIA', erp_id: '08888', rep_erp_id: '00780' }),
      ],
      customer_changes: [
        // 21/09/2026: a edição só de WhatsApp ainda nascia pendente.
        alteracao({ campos: { whatsapp: { antes: '32999990000', depois: '32988880000' } }, alterado_em: '2026-09-21T10:00:00.000Z' }),
        alteracao({
          customer_id: OUTRO_CLIENTE_ID,
          campos: {
            whatsapp: { antes: '32999990000', depois: '32988880000' },
            email: { antes: 'loja@exemplo.com', depois: 'novo@exemplo.com' },
          },
          alterado_em: '2026-09-21T11:00:00.000Z',
        }),
      ],
    });

    const { res, corpo } = await ler(banco, '/customers/alteracoes-pendentes', TOKEN.financeiro);

    expect(res.statusCode).toBe(200);
    expect((corpo['data'] as Corpo[]).map((c) => c['customer_id'])).toEqual([OUTRO_CLIENTE_ID]);
  });

  it('o push da edição mista não fala do WhatsApp — só do que atualizar no Control', async () => {
    vi.resetModules();
    const fake = criarSupabaseFake({
      users: { data: [{ id: 'fin-ficticio' }], error: null },
      push_subscriptions: { data: [{ endpoint: 'https://push/ficticio', p256dh: 'p', auth: 'a' }], error: null },
    });
    vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
    vi.doMock('../apps/api/src/config/env.js', () => ({
      env: { VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'mailto:teste@teste.local' },
    }));
    const enviados: string[] = [];
    vi.doMock('../apps/api/src/modules/push/webpush.js', () => ({
      webpush: {
        setVapidDetails: vi.fn(),
        sendNotification: vi.fn(async (_a: unknown, corpo: string) => {
          enviados.push(corpo);
        }),
      },
    }));
    const avisos = await import('../apps/api/src/modules/push/push.avisos.js');

    await avisos.avisarCadastroAlteradoNoControl(
      EMPRESA,
      { id: CLIENTE_ID, name: 'LOJA FICTICIA LTDA', erp_id: '09999' },
      ['whatsapp', 'email'],
      'rep-ficticio',
    );

    const push = JSON.parse(enviados[0]!) as Corpo;
    expect(String(push['body'])).toContain('mudou no app: E-mail. Atualize no Control.');
    expect(String(push['body'])).not.toContain('WhatsApp');
  });
});
