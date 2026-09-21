import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { linhaDeEndereco } from '@csb/shared';
import { criarSupabaseFake, type ConsultaFeita, type RespostaTabela } from './supabaseFake.js';

/**
 * A edição do cadastro feita no app diante da API de Parceiro (migração 051,
 * 17/09/2026 — "quando mudar lá tem que mudar no ERP do Fábio também").
 *
 * O que estes testes trancam:
 *  • POST /clientes: coluna com edição do app PENDENTE que o Control manda com
 *    outro valor não é sobrescrita e volta em `avisos`; o mesmo valor resolve a
 *    edição com via 'api' (sem pessoa); o endereço confere como grupo; o valor
 *    do app é o da edição pendente (não a leitura do começo do lote); coluna
 *    não pendente segue a regra de sempre; não carimba enquanto sobra edição;
 *  • as pendências são lidas em LOTE (uma consulta por lote de clientes
 *    casados), e falhar ao lê-las lança antes de gravar;
 *  • (revisão de 17/09/2026) o UPDATE do lote leva o valor lido na condição: a
 *    edição do app que cai entre a leitura das pendências e a gravação não é
 *    apagada; o CPF/CNPJ corrigido no app casa pelo código; a peça do endereço
 *    não editada no app também tira o grupo;
 *  • GET /clientes: `alterado_no_app` com os nomes do contrato; o cliente com
 *    edição pendente não some pelo anti-eco e sai em TODA puxada até o Control
 *    ter a edição; a lista é paginada pela chave, não pela posição;
 *  • `servidor_hora` dos GET de clientes e representantes é a hora de ANTES da
 *    consulta, menos a folga;
 *  • os docs dizem o que o código faz;
 *  • sem a 051, nada muda.
 *
 * Dados fictícios de propósito — nada de cliente real aqui.
 */

const EMPRESA = 'empresa-1';
const SUPABASE = '../apps/api/src/config/supabase.js';
const DETECTAR = '../apps/api/src/lib/detectarColuna.js';
const SERVICO = '../apps/api/src/modules/partner/partner.sync.service.js';

type Linha = Record<string, unknown>;

// ─── Um banco de teste que aplica os filtros de verdade ──────────────────────

const argsDe = (c: ConsultaFeita, metodo: string) =>
  c.filtros.filter((f) => f.metodo === metodo).map((f) => f.args);

/** `updated_at` compara como instante (formatos diferentes do mesmo momento); o resto, como texto. */
function comparar(coluna: string, a: unknown, b: unknown): number {
  if (coluna === 'updated_at') return Date.parse(String(a)) - Date.parse(String(b));
  const x = String(a);
  const y = String(b);
  return x === y ? 0 : x < y ? -1 : 1;
}

/** Separa os termos de um `or` do PostgREST no nível de fora (vírgula fora de parênteses e aspas). */
function termosDoOr(expressao: string): string[] {
  const termos: string[] = [];
  let nivel = 0;
  let aspas = false;
  let atual = '';
  for (const ch of expressao) {
    if (ch === '"') aspas = !aspas;
    if (!aspas && ch === '(') nivel++;
    if (!aspas && ch === ')') nivel--;
    if (!aspas && nivel === 0 && ch === ',') {
      termos.push(atual);
      atual = '';
    } else atual += ch;
  }
  termos.push(atual);
  return termos;
}

function casaTermo(linha: Linha, termo: string): boolean {
  if (termo.startsWith('and(') && termo.endsWith(')')) {
    return termosDoOr(termo.slice(4, -1)).every((t) => casaTermo(linha, t));
  }
  const [coluna, op, ...resto] = termo.split('.');
  const valor = resto.join('.').replace(/^"(.*)"$/, '$1');
  const v = linha[coluna!];
  if (op === 'is' && valor === 'null') return v == null;
  if (op === 'not' && valor === 'is.null') return v != null;
  if (v == null) return false;
  if (op === 'eq') return comparar(coluna!, v, valor) === 0;
  if (op === 'gt') return comparar(coluna!, v, valor) > 0;
  throw new Error(`termo de or não suportado no banco de teste: ${termo}`);
}

/**
 * O valor de uma coluna do filtro, resolvendo o caminho de jsonb do PostgREST
 * (`campos->cnpj->>antes`) — é assim que o lote procura o documento ANTIGO de
 * um cliente sem código (051).
 */
function valorDaColuna(linha: Linha, coluna: string): unknown {
  if (typeof coluna !== 'string' || !coluna.includes('->')) return linha[coluna];
  const [raiz, ...caminho] = coluna.split(/->>|->/);
  let v: unknown = linha[raiz!];
  for (const parte of caminho) {
    if (typeof v !== 'object' || v === null) return undefined;
    v = (v as Record<string, unknown>)[parte];
  }
  return v;
}

function casa(linha: Linha, c: ConsultaFeita): boolean {
  for (const { metodo, args } of c.filtros) {
    const [coluna, valor] = args as [string, unknown];
    const atual = valorDaColuna(linha, coluna);
    if (metodo === 'eq' && atual !== valor) return false;
    if (metodo === 'is' && valor === null && atual != null) return false;
    if (metodo === 'in' && !(valor as unknown[]).includes(atual)) return false;
    if (metodo === 'gte' && !(atual != null && comparar(coluna, atual, valor) >= 0)) return false;
    if (metodo === 'gt' && !(atual != null && comparar(coluna, atual, valor) > 0)) return false;
    if (metodo === 'or' && !termosDoOr(coluna).some((t) => casaTermo(linha, t))) return false;
  }
  return true;
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
  const range = argsDe(c, 'range')[0] as [number, number] | undefined;
  const limite = argsDe(c, 'limit')[0]?.[0];
  const fatia = range ? copia.slice(range[0], range[1] + 1) : copia;
  return typeof limite === 'number' ? fatia.slice(0, limite) : fatia;
}

interface Banco {
  clientes: Linha[];
  alteracoes: Linha[];
  /** Faz a leitura (select) ou a marcação (update) de customer_changes falhar. */
  falhar?: { leitura?: boolean; marcacao?: boolean };
  /** Chamado logo antes de um UPDATE em customers ser aplicado — a edição que cai no meio. */
  antesDoUpdateDeCliente?: (c: ConsultaFeita) => void;
  /** Chamado depois de uma página de customers ser lida — a gravação no meio da leitura. */
  depoisDeLerClientes?: (c: ConsultaFeita) => void;
}

const ERRO: RespostaTabela = { data: null, error: { message: 'tempo esgotado' } };

function fakeDo(banco: Banco) {
  return criarSupabaseFake({
    price_tables: { data: [], error: null },
    users: { data: [], error: null },
    customers: (c) => {
      if (c.operacao === 'select') {
        const data = ordenarEFatiar(
          banco.clientes.filter((l) => casa(l, c)),
          c,
        );
        banco.depoisDeLerClientes?.(c);
        return { data, error: null };
      }
      if (c.operacao === 'update') {
        banco.antesDoUpdateDeCliente?.(c);
        // O UPDATE vale só nas linhas que ainda casam com a condição (compare-and-set).
        const alvo = banco.clientes.filter((l) => casa(l, c));
        for (const l of alvo) Object.assign(l, c.valores as Linha);
        return {
          data: argsDe(c, 'select').length > 0 ? alvo.map((l) => ({ id: l['id'] })) : null,
          error: null,
        };
      }
      return { data: null, error: null };
    },
    customer_changes: (c) => {
      if (c.operacao === 'select') {
        if (banco.falhar?.leitura) return ERRO;
        return {
          data: ordenarEFatiar(
            banco.alteracoes.filter((l) => casa(l, c)),
            c,
          ),
          error: null,
        };
      }
      if (c.operacao === 'update') {
        if (banco.falhar?.marcacao) return ERRO;
        const alvo = banco.alteracoes.filter((l) => casa(l, c));
        for (const l of alvo) Object.assign(l, c.valores as Linha);
        return { data: alvo.map((l) => ({ id: l['id'] })), error: null };
      }
      return { data: null, error: null };
    },
  });
}

interface Opcoes {
  /** customer_changes existe. Padrão: sim. */
  com051?: boolean;
  /** As colunas da 049 em customers existem. Padrão: não. */
  com049?: boolean;
}

async function carregar(banco: Banco, opcoes: Opcoes = {}) {
  const fake = fakeDo(banco);
  vi.doMock(SUPABASE, () => ({ supabase: fake.cliente }));
  const existe: Record<string, boolean> = {
    'customers.cep': true,
    'customers.pendencia_financeira': opcoes.com049 ?? false,
    'customer_changes.id': opcoes.com051 ?? true,
  };
  const sondas: string[] = [];
  const responder = async (tabela: string, coluna?: string) => {
    const chave = `${tabela}.${coluna ?? ''}`;
    sondas.push(chave);
    return existe[chave] ?? true;
  };
  vi.doMock(DETECTAR, () => ({
    detectar: responder,
    detectarOuFalhar: responder,
    detectarComCerteza: async (t: string, c?: string) =>
      (await responder(t, c)) ? 'existe' : 'nao_existe',
    esquecerDeteccoes: () => undefined,
  }));
  const service = await import(SERVICO);
  return { service, fake, sondas };
}

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.doUnmock(SUPABASE);
  vi.doUnmock(DETECTAR);
  vi.useRealTimers();
});

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ENDERECO_NOVO = {
  cep: '00000001',
  logradouro: 'Rua Nova',
  numero: '20',
  complemento: null,
  bairro: 'Centro',
  cidade: 'Cidade Teste',
  uf: 'XX',
};
const ENDERECO_VELHO = { ...ENDERECO_NOVO, logradouro: 'Rua Velha', numero: '1' };

/** O cliente como o app o tem DEPOIS da edição: já no Control, endereço completo. */
function cliente(sobrescrever: Linha = {}): Linha {
  const linha: Linha = {
    id: 'cli-1',
    company_id: EMPRESA,
    erp_id: '00123',
    name: 'LOJA TESTE LTDA',
    trade_name: 'LOJA TESTE',
    cnpj: '00000000000191',
    rep_erp_id: '00779',
    price_table_id: null,
    blocked: false,
    block_reason: null,
    credit_limit: null,
    whatsapp: '00900000002',
    email: 'loja@teste.invalid',
    ...ENDERECO_NOVO,
    inscricao_estadual: null,
    observacoes: null,
    updated_at: '2026-09-17T10:00:00.000Z',
    ...sobrescrever,
  };
  if (!('address' in sobrescrever))
    linha['address'] = linhaDeEndereco(linha as Parameters<typeof linhaDeEndereco>[0]);
  return linha;
}

let sequencia = 0;
/** Uma edição do app, pendente por padrão. */
function alteracao(
  customer_id: string,
  campos: Record<string, { antes: string | null; depois: string | null }>,
  extra: Linha = {},
): Linha {
  sequencia += 1;
  return {
    id: `alt-${String(sequencia).padStart(3, '0')}`,
    company_id: EMPRESA,
    customer_id,
    alterado_por: 'u-rep',
    alterado_por_nome: 'REP TESTE',
    alterado_em: '2026-09-17T10:00:00.000Z',
    campos,
    erp_pendente: true,
    erp_atualizado_em: null,
    erp_atualizado_por: null,
    erp_atualizado_por_nome: null,
    erp_atualizado_via: null,
    ...extra,
  };
}

const valoresDe = (g: { valores: unknown } | undefined) => g?.valores as Record<string, unknown>;
const updatesDe = (fake: ReturnType<typeof fakeDo>, tabela: string) =>
  fake.gravacoes.filter((g) => g.tabela === tabela && g.operacao === 'update').map(valoresDe);

/** O mesmo registro que o Control tem com o valor ANTIGO do WhatsApp. */
const REGISTRO = { codigo: '123', razao_social: 'LOJA TESTE LTDA' };

// ─── POST /clientes ──────────────────────────────────────────────────────────

describe('POST /clientes — a edição do app não é apagada pelo Control (051)', () => {
  it('coluna pendente com outro valor no Control fica com o valor do app e volta em avisos; a não pendente grava como sempre', async () => {
    const banco: Banco = {
      clientes: [cliente()],
      alteracoes: [
        alteracao('cli-1', { whatsapp: { antes: '00900000001', depois: '00900000002' } }),
      ],
    };
    const { service, fake } = await carregar(banco);

    const r = await service.receberClientes(EMPRESA, [
      { ...REGISTRO, whatsapp: '00900000001', email: 'novo@teste.invalid' },
    ]);

    expect(r).toMatchObject({ atualizados: 1, sem_mudanca: 0, ignorados: [] });
    const [patch] = updatesDe(fake, 'customers');
    expect(patch).toMatchObject({ email: 'novo@teste.invalid' });
    expect('whatsapp' in patch!).toBe(false);
    expect(r.avisos).toContain(
      'Cliente 123: whatsapp alterados no app ainda não aplicados no Control — mantido o valor do app.',
    );
    // A edição continua na fila do financeiro.
    expect(updatesDe(fake, 'customer_changes')).toEqual([]);
    expect(banco.alteracoes[0]).toMatchObject({
      erp_atualizado_em: null,
      erp_atualizado_via: null,
    });
  });

  it('o Control devolve o mesmo valor: a edição é resolvida pela API (via api, sem pessoa) e nada é gravado no cliente', async () => {
    const outraEmpresa = alteracao(
      'cli-1',
      { whatsapp: { antes: '1', depois: '00900000002' } },
      { company_id: 'empresa-2' },
    );
    const deOutroCliente = alteracao('cli-9', { whatsapp: { antes: '1', depois: '00900000002' } });
    const banco: Banco = {
      clientes: [cliente()],
      alteracoes: [
        alteracao('cli-1', { whatsapp: { antes: '00900000001', depois: '00900000002' } }),
        alteracao(
          'cli-1',
          { cnpj: { antes: '00000000000272', depois: '00000000000191' } },
          { alterado_em: '2026-09-17T11:00:00.000Z' },
        ),
        deOutroCliente,
        outraEmpresa,
      ],
    };
    const { service, fake } = await carregar(banco);

    const r = await service.receberClientes(EMPRESA, [
      // WhatsApp com espaços em volta: é o mesmo valor.
      { ...REGISTRO, whatsapp: ' 00900000002 ', cnpj_cpf: '00000000000191' },
    ]);

    expect(r).toMatchObject({ atualizados: 0, sem_mudanca: 1, ignorados: [], avisos: [] });
    expect(updatesDe(fake, 'customers')).toEqual([]);
    const [marcacao] = updatesDe(fake, 'customer_changes');
    expect(marcacao).toMatchObject({
      erp_atualizado_via: 'api',
      erp_atualizado_por: null,
      erp_atualizado_por_nome: null,
    });
    expect(typeof marcacao!['erp_atualizado_em']).toBe('string');
    expect(banco.alteracoes.slice(0, 2).map((a) => a['erp_atualizado_via'])).toEqual([
      'api',
      'api',
    ]);
    // Só as deste cliente, desta empresa.
    expect(deOutroCliente['erp_atualizado_em']).toBeNull();
    expect(outraEmpresa['erp_atualizado_em']).toBeNull();
    const filtros = fake.filtrosDe('customer_changes').map((f) => [f.metodo, ...f.args]);
    expect(filtros).toContainEqual(['eq', 'company_id', EMPRESA]);
    expect(filtros).toContainEqual(['is', 'erp_atualizado_em', null]);
  });

  it('CNPJ trocado no app: o Control com o documento antigo casa pelo código e não devolve o documento velho', async () => {
    const banco: Banco = {
      clientes: [cliente({ cnpj: '00000000000272' })],
      alteracoes: [
        alteracao('cli-1', { cnpj: { antes: '00000000000191', depois: '00000000000272' } }),
      ],
    };
    const { service, fake } = await carregar(banco);

    const r = await service.receberClientes(EMPRESA, [
      { ...REGISTRO, cnpj_cpf: '00.000.000/0001-91', nome_fantasia: 'LOJA RENOMEADA' },
    ]);

    expect(r).toMatchObject({ atualizados: 1, ignorados: [] });
    const [patch] = updatesDe(fake, 'customers');
    expect(patch).toMatchObject({ trade_name: 'LOJA RENOMEADA' });
    expect('cnpj' in patch!).toBe(false);
    expect(r.avisos.some((a) => a.startsWith('Cliente 123: cnpj_cpf alterados no app'))).toBe(true);
  });

  it('o endereço é um grupo: peça diferente tira o endereço inteiro; todas as peças editadas iguais resolvem', async () => {
    const edicao = () =>
      alteracao('cli-1', {
        logradouro: { antes: 'Rua Velha', depois: 'Rua Nova' },
        numero: { antes: '1', depois: '20' },
        address: { antes: linhaDeEndereco(ENDERECO_VELHO), depois: linhaDeEndereco(ENDERECO_NOVO) },
      });

    // O Control ainda com a rua velha — e com um bairro novo dele.
    const velho: Banco = { clientes: [cliente()], alteracoes: [edicao()] };
    const a = await carregar(velho);
    const r1 = await a.service.receberClientes(EMPRESA, [
      {
        ...REGISTRO,
        email: 'novo@teste.invalid',
        endereco: { ...ENDERECO_VELHO, bairro: 'Bairro do Control', cep: '00000-001' },
      },
    ]);
    const [patch] = updatesDe(a.fake, 'customers');
    expect(Object.keys(patch!).sort()).toEqual(['email', 'updated_at']);
    expect(r1.avisos).toContain(
      'Cliente 123: endereco alterados no app ainda não aplicados no Control — mantido o valor do app.',
    );
    expect(velho.alteracoes[0]!['erp_atualizado_em']).toBeNull();

    // O Control já com o endereço do app (complemento "" = vazio lá; UF minúscula).
    vi.resetModules();
    const novo: Banco = { clientes: [cliente()], alteracoes: [edicao()] };
    const b = await carregar(novo);
    const r2 = await b.service.receberClientes(EMPRESA, [
      { ...REGISTRO, endereco: { ...ENDERECO_NOVO, complemento: '', uf: 'xx', cep: '00000-001' } },
    ]);
    expect(r2).toMatchObject({ sem_mudanca: 1, avisos: [] });
    expect(updatesDe(b.fake, 'customers')).toEqual([]);
    expect(novo.alteracoes[0]).toMatchObject({ erp_atualizado_via: 'api' });

    // A linha pronta igual à do app também alcança.
    vi.resetModules();
    const linha: Banco = { clientes: [cliente()], alteracoes: [edicao()] };
    const c = await carregar(linha);
    await c.service.receberClientes(EMPRESA, [
      { ...REGISTRO, endereco: linhaDeEndereco(ENDERECO_NOVO) },
    ]);
    expect(linha.alteracoes[0]).toMatchObject({ erp_atualizado_via: 'api' });
  });

  it('só as peças EDITADAS no app diferentes (o resto do endereço igual): o endereço não é gravado, avisa e a edição continua pendente', async () => {
    // O caso do dia a dia — o Control ainda com a rua e o número antigos e o
    // resto igual — e o único que exercita a conferência da peça EDITADA: nos
    // outros casos do grupo vem junto uma peça NÃO editada diferente, que já
    // reprova sozinha. Sem essa conferência, o lote gravaria o endereço velho
    // do Control por cima do do app (o compare-and-set passa: a condição é o
    // valor lido do app) e ainda fecharia a pendência com via 'api'.
    const banco: Banco = {
      clientes: [cliente()],
      alteracoes: [
        alteracao('cli-1', {
          logradouro: { antes: 'Rua Velha', depois: 'Rua Nova' },
          numero: { antes: '1', depois: '20' },
          address: { antes: linhaDeEndereco(ENDERECO_VELHO), depois: linhaDeEndereco(ENDERECO_NOVO) },
        }),
      ],
    };
    const { service, fake } = await carregar(banco);

    const r = await service.receberClientes(EMPRESA, [{ ...REGISTRO, endereco: { ...ENDERECO_VELHO } }]);

    expect(r).toMatchObject({ atualizados: 0, sem_mudanca: 1, ignorados: [] });
    expect(updatesDe(fake, 'customers')).toEqual([]);
    expect(updatesDe(fake, 'customer_changes')).toEqual([]);
    expect(r.avisos).toContain(
      'Cliente 123: endereco alterados no app ainda não aplicados no Control — mantido o valor do app.',
    );
    expect(banco.clientes[0]).toMatchObject({ logradouro: 'Rua Nova', numero: '20' });
    expect(banco.alteracoes[0]).toMatchObject({ erp_atualizado_em: null, erp_atualizado_via: null });
  });

  it('peça NÃO editada no app diferente, com as editadas iguais: o endereço inteiro fica de fora, avisa e a edição continua pendente', async () => {
    // O app editou rua e número; o Control já tem os dois iguais, mas um bairro dele.
    const banco: Banco = {
      clientes: [cliente()],
      alteracoes: [
        alteracao('cli-1', {
          logradouro: { antes: 'Rua Velha', depois: 'Rua Nova' },
          numero: { antes: '1', depois: '20' },
          address: { antes: linhaDeEndereco(ENDERECO_VELHO), depois: linhaDeEndereco(ENDERECO_NOVO) },
        }),
      ],
    };
    const { service, fake } = await carregar(banco);

    const r = await service.receberClientes(EMPRESA, [
      { ...REGISTRO, endereco: { ...ENDERECO_NOVO, bairro: 'Bairro do Control' } },
    ]);

    // Dar a edição por alcançada gravaria a rua do app com o bairro do Control:
    // um endereço que não existe em nenhum dos dois lados.
    expect(r).toMatchObject({ atualizados: 0, sem_mudanca: 1 });
    expect(updatesDe(fake, 'customers')).toEqual([]);
    expect(r.avisos).toContain(
      'Cliente 123: endereco alterados no app ainda não aplicados no Control — mantido o valor do app.',
    );
    expect(banco.alteracoes[0]!['erp_atualizado_em']).toBeNull();
    expect(banco.clientes[0]!['bairro']).toBe('Centro');
  });

  it('peça NÃO editada no app que chega "" (vazia no Control) conta como diferente: avisa e a edição continua pendente — igual ao null', async () => {
    // Revisão de 17/09/2026: o "" do Firebird não grava, e a peça não editada
    // era conferida pelo que o registro pede para gravar — o bairro vazio lá
    // contava como igual ao "Centro" do app e a edição saía da fila sem aviso.
    for (const bairroNoControl of ['', null]) {
      vi.resetModules();
      const banco: Banco = {
        clientes: [cliente()],
        alteracoes: [
          alteracao('cli-1', {
            logradouro: { antes: 'Rua Velha', depois: 'Rua Nova' },
            numero: { antes: '1', depois: '20' },
            address: { antes: linhaDeEndereco(ENDERECO_VELHO), depois: linhaDeEndereco(ENDERECO_NOVO) },
          }),
        ],
      };
      const { service, fake } = await carregar(banco);

      const r = await service.receberClientes(EMPRESA, [
        { ...REGISTRO, endereco: { ...ENDERECO_NOVO, bairro: bairroNoControl } },
      ]);

      expect(r.avisos).toContain(
        'Cliente 123: endereco alterados no app ainda não aplicados no Control — mantido o valor do app.',
      );
      expect(banco.alteracoes[0]).toMatchObject({ erp_atualizado_em: null, erp_atualizado_via: null });
      expect(updatesDe(fake, 'customer_changes')).toEqual([]);
      expect(updatesDe(fake, 'customers')).toEqual([]);
      expect(banco.clientes[0]!['bairro']).toBe('Centro');
    }
  });

  it('a edição do app que cai entre a leitura das pendências e o UPDATE do lote não é apagada: o registro volta em ignorados', async () => {
    // O banco com o WhatsApp A; o Control manda D. A leitura das pendências
    // não acha nada — e, enquanto o lote grava, o rep salva C na ficha.
    const A = '00900000002';
    const C = '00900000003';
    const D = '00900000009';
    let editou = false;
    const banco: Banco = { clientes: [cliente({ whatsapp: A })], alteracoes: [] };
    banco.antesDoUpdateDeCliente = () => {
      if (editou) return;
      editou = true;
      banco.clientes[0]!['whatsapp'] = C;
      banco.alteracoes.push(alteracao('cli-1', { whatsapp: { antes: A, depois: C } }));
    };
    const { service, fake } = await carregar(banco);

    const r = await service.receberClientes(EMPRESA, [{ ...REGISTRO, whatsapp: D }]);

    // Sem a condição, o UPDATE gravava D por cima de C, sem aviso, e a pendência
    // A→C apontava para um valor que não estava em lugar nenhum.
    expect(banco.clientes[0]!['whatsapp']).toBe(C);
    expect(r).toMatchObject({ atualizados: 0 });
    expect(r.ignorados).toEqual([{ codigo: '123', motivo: 'cadastro alterado no app durante o envio — reenvie' }]);
    expect(fake.filtrosDe('customers', 'eq').map((f) => f.args)).toContainEqual(['whatsapp', A]);
    expect(banco.alteracoes[0]!['erp_atualizado_em']).toBeNull();

    // No reenvio, a conferência já vê a edição: mantém C e avisa.
    const r2 = await service.receberClientes(EMPRESA, [{ ...REGISTRO, whatsapp: D }]);
    expect(banco.clientes[0]!['whatsapp']).toBe(C);
    expect(r2.avisos).toContain(
      'Cliente 123: whatsapp alterados no app ainda não aplicados no Control — mantido o valor do app.',
    );
  });

  it('a edição do app que cai entre as DUAS gravações dela (cliente já gravado, histórico ainda não) não é apagada: volta ao valor do app e avisa', async () => {
    // Revisão de 17/09/2026. A tela grava o WhatsApp Y no cliente e só depois a
    // linha do histórico. O lote leu Y sem pendência nenhuma, e o compare-and-set
    // passava (a condição era o próprio Y): o Control gravava o X antigo por
    // cima, calado, e os envios seguintes avisavam "mantido o valor do app" com
    // o app no X.
    const X = '00900000001';
    const Y = '00900000002';
    let historicoGravado = false;
    const banco: Banco = { clientes: [cliente({ whatsapp: Y })], alteracoes: [] };
    banco.antesDoUpdateDeCliente = () => {
      if (historicoGravado) return;
      historicoGravado = true; // o insert do histórico da tela chega depois da leitura das pendências
      banco.alteracoes.push(alteracao('cli-1', { whatsapp: { antes: X, depois: Y } }));
    };
    const { service, fake } = await carregar(banco);

    const r = await service.receberClientes(EMPRESA, [{ ...REGISTRO, whatsapp: X, email: 'novo@teste.invalid' }]);

    expect(banco.clientes[0]!['whatsapp']).toBe(Y);
    expect(banco.clientes[0]!['email']).toBe('novo@teste.invalid'); // a coluna sem edição do app fica como o Control mandou
    expect(r.avisos).toContain(
      'Cliente 123: whatsapp alterados no app ainda não aplicados no Control — mantido o valor do app.',
    );
    expect(banco.alteracoes[0]).toMatchObject({ erp_atualizado_em: null, erp_atualizado_via: null });
    // A volta só vale onde ainda está o que o lote gravou.
    const [, devolvido] = updatesDe(fake, 'customers');
    expect(devolvido).toMatchObject({ whatsapp: Y });
    expect('email' in devolvido!).toBe(false);
    expect(fake.filtrosDe('customers', 'eq').map((f) => f.args)).toContainEqual(['whatsapp', X]);

    // No reenvio, o aviso é verdade: o app está com Y.
    const r2 = await service.receberClientes(EMPRESA, [{ ...REGISTRO, whatsapp: X, email: 'novo@teste.invalid' }]);
    expect(banco.clientes[0]!['whatsapp']).toBe(Y);
    expect(r2.avisos).toContain(
      'Cliente 123: whatsapp alterados no app ainda não aplicados no Control — mantido o valor do app.',
    );
  });

  it('a volta só vale onde ainda está o que o lote gravou: quem gravou por cima depois do lote fica', async () => {
    const X = '00900000001';
    const Y = '00900000002';
    const Z = '00900000003';
    const erro = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let passo = 0;
    const porCima: Banco = { clientes: [cliente({ whatsapp: Y })], alteracoes: [] };
    porCima.antesDoUpdateDeCliente = () => {
      passo++;
      if (passo === 1) porCima.alteracoes.push(alteracao('cli-1', { whatsapp: { antes: X, depois: Y } }));
      if (passo === 2) porCima.clientes[0]!['whatsapp'] = Z;
    };
    const b = await carregar(porCima);
    await b.service.receberClientes(EMPRESA, [{ ...REGISTRO, whatsapp: X }]);
    expect(updatesDe(b.fake, 'customers')).toHaveLength(2); // o lote e a tentativa de volta
    expect(porCima.clientes[0]!['whatsapp']).toBe(Z);
    erro.mockRestore();
  });

  it('colunasQueOLoteApagou: o endereço volta como grupo; coluna que o lote não trocou, ou edição com outro `depois`, não', async () => {
    await carregar({ clientes: [], alteracoes: [] }); // o módulo de regras lê o banco de teste, nunca o real
    const { colunasQueOLoteApagou } = await import('../apps/api/src/modules/partner/partner.edicaoNoApp.js');
    const edicao = (campos: Record<string, { antes: string | null; depois: string | null }>) =>
      ({ ...alteracao('cli-1', campos), campos }) as unknown as Parameters<typeof colunasQueOLoteApagou>[0][number];

    const lidas = { numero: '20', bairro: 'Centro', address: 'Rua Nova, 20 - Centro', email: 'a@teste.invalid' };
    const gravadas = { numero: '1', bairro: 'Bairro do Control', address: 'Rua Nova, 1 - Bairro do Control', email: 'b@teste.invalid' };
    const numero = edicao({ numero: { antes: '1', depois: '20' }, address: { antes: 'x', depois: 'Rua Nova, 20 - Centro' } });
    expect(colunasQueOLoteApagou([numero], lidas, gravadas).sort()).toEqual(['address', 'bairro', 'numero']);

    // `depois` diferente do que o lote leu: não foi esta edição que ele apagou.
    const outra = edicao({ email: { antes: 'a@teste.invalid', depois: 'c@teste.invalid' } });
    expect(colunasQueOLoteApagou([outra], lidas, gravadas)).toEqual([]);
    // Coluna que o lote não gravou (ou gravou igual, só com outra grafia).
    const whatsapp = edicao({ whatsapp: { antes: '1', depois: '2' } });
    expect(colunasQueOLoteApagou([whatsapp], { whatsapp: '2' }, { whatsapp: ' 2 ' })).toEqual([]);
    // Já resolvida não conta.
    const resolvida = { ...edicao({ email: { antes: 'b@teste.invalid', depois: 'a@teste.invalid' } }), erp_atualizado_em: '2026-09-17T11:00:00Z' };
    expect(colunasQueOLoteApagou([resolvida], lidas, gravadas)).toEqual([]);
  });

  it('CPF/CNPJ corrigido no app para tirar o de OUTRA loja: o registro com o documento antigo casa pelo código (com ou sem código na outra loja)', async () => {
    const ANTIGO = '00000000000191';
    const NOVO = '00000000000272';
    for (const outraLojaTemCodigo of [true, false]) {
      vi.resetModules();
      const banco: Banco = {
        clientes: [
          cliente({ id: 'cli-1', erp_id: '00123', cnpj: NOVO }),
          cliente({ id: 'cli-2', erp_id: outraLojaTemCodigo ? '05555' : null, cnpj: ANTIGO, name: 'OUTRA LOJA' }),
        ],
        alteracoes: [alteracao('cli-1', { cnpj: { antes: ANTIGO, depois: NOVO } })],
      };
      const { service, fake } = await carregar(banco);

      const r = await service.receberClientes(EMPRESA, [
        { ...REGISTRO, cnpj_cpf: '00.000.000/0001-91', bloqueado: 'S' },
      ]);

      // Antes: com código na outra loja, "CNPJ já é do cliente de código 05555";
      // sem código, a outra loja era adotada com o código 00123.
      expect(r.ignorados).toEqual([]);
      expect(r.atualizados).toBe(1);
      expect(fake.filtrosDe('customers', 'eq').map((f) => f.args)).toContainEqual(['id', 'cli-1']);
      expect(fake.filtrosDe('customers', 'eq').map((f) => f.args)).not.toContainEqual(['id', 'cli-2']);
      const [patch] = updatesDe(fake, 'customers');
      expect(patch).toMatchObject({ blocked: true });
      expect('cnpj' in patch!).toBe(false);
      expect('erp_id' in patch!).toBe(false);
      expect(banco.clientes[1]).toMatchObject({ blocked: false, erp_id: outraLojaTemCodigo ? '05555' : null });
      expect(r.avisos.some((a: string) => a.startsWith('Cliente 123: cnpj_cpf alterados no app'))).toBe(true);
    }
  });

  it('peça editada no app que não veio no objeto: sem aviso, sem gravar, e a edição continua pendente', async () => {
    const banco: Banco = {
      clientes: [cliente()],
      alteracoes: [
        alteracao('cli-1', {
          logradouro: { antes: 'Rua Velha', depois: 'Rua Nova' },
          numero: { antes: '1', depois: '20' },
          address: {
            antes: linhaDeEndereco(ENDERECO_VELHO),
            depois: linhaDeEndereco(ENDERECO_NOVO),
          },
        }),
      ],
    };
    const { service, fake } = await carregar(banco);

    const r = await service.receberClientes(EMPRESA, [
      { ...REGISTRO, endereco: { logradouro: 'Rua Nova', cidade: 'Cidade Teste' } },
    ]);

    expect(r).toMatchObject({ sem_mudanca: 1, avisos: [] });
    expect(fake.gravacoes).toEqual([]);
    expect(banco.alteracoes[0]!['erp_atualizado_em']).toBeNull();
  });

  it('e-mail limpo no app: o "" do Firebird é o Control dizendo que está vazio lá — resolve sem gravar', async () => {
    const banco: Banco = {
      clientes: [cliente({ email: null })],
      alteracoes: [alteracao('cli-1', { email: { antes: 'loja@teste.invalid', depois: null } })],
    };
    const { service, fake } = await carregar(banco);

    const r = await service.receberClientes(EMPRESA, [{ ...REGISTRO, email: '' }]);

    expect(r).toMatchObject({ sem_mudanca: 1, avisos: [] });
    expect(updatesDe(fake, 'customers')).toEqual([]);
    expect(banco.alteracoes[0]).toMatchObject({ erp_atualizado_via: 'api' });
  });

  it('o valor do app é o da edição pendente mais recente — a edição que cai no meio do lote não é dada por alcançada com o valor antigo', async () => {
    // A leitura dos clientes ainda viu o WhatsApp antigo; a edição (gravada
    // logo depois) já está na leitura das pendências.
    const velho = '00900000001';
    const antes: Banco = {
      clientes: [cliente({ whatsapp: velho })],
      alteracoes: [alteracao('cli-1', { whatsapp: { antes: velho, depois: '00900000002' } })],
    };
    const a = await carregar(antes);
    const r = await a.service.receberClientes(EMPRESA, [{ ...REGISTRO, whatsapp: velho }]);
    expect(antes.alteracoes[0]!['erp_atualizado_em']).toBeNull();
    expect(r.avisos.some((t) => t.startsWith('Cliente 123: whatsapp'))).toBe(true);
    expect(updatesDe(a.fake, 'customers')).toEqual([]);

    // Duas edições pendentes da mesma coluna: vale a última, e as duas resolvem.
    vi.resetModules();
    const duas: Banco = {
      clientes: [cliente({ whatsapp: '00900000003' })],
      alteracoes: [
        alteracao(
          'cli-1',
          { whatsapp: { antes: velho, depois: '00900000002' } },
          { alterado_em: '2026-09-17T10:00:00.000Z' },
        ),
        alteracao(
          'cli-1',
          { whatsapp: { antes: '00900000002', depois: '00900000003' } },
          { alterado_em: '2026-09-17T10:05:00.000Z' },
        ),
      ],
    };
    const b = await carregar(duas);
    const r2 = await b.service.receberClientes(EMPRESA, [{ ...REGISTRO, whatsapp: '00900000003' }]);
    expect(r2.avisos).toEqual([]);
    expect(duas.alteracoes.map((x) => x['erp_atualizado_via'])).toEqual(['api', 'api']);
  });

  it('edição com duas colunas só resolve quando as duas alcançam', async () => {
    const banco: Banco = {
      clientes: [cliente()],
      alteracoes: [
        alteracao('cli-1', {
          whatsapp: { antes: '00900000001', depois: '00900000002' },
          email: { antes: 'velho@teste.invalid', depois: 'loja@teste.invalid' },
        }),
      ],
    };
    const { service } = await carregar(banco);

    const r = await service.receberClientes(EMPRESA, [{ ...REGISTRO, whatsapp: '00900000002' }]);

    expect(r.avisos).toEqual([]);
    expect(banco.alteracoes[0]!['erp_atualizado_em']).toBeNull();
  });

  // ─── O Control resolve edição por edição (revisão de 17/09/2026) ───────────
  //
  // E1 (10:00) mexe no WhatsApp A→B e no e-mail X→Y; E2 (10:05), no WhatsApp
  // B→C. O app está com C e Y. O Control aplica primeiro só o WhatsApp: E2 sai
  // da fila e E1 fica. Contando só as pendentes, o "valor do app" do WhatsApp
  // voltava a ser o B vencido de E1.
  const A = '00900000001';
  const B = '00900000002';
  const C = '00900000003';
  const X = 'velho@teste.invalid';
  const Y = 'loja@teste.invalid';
  const duasEdicoes = (): Banco => ({
    clientes: [cliente({ whatsapp: C, email: Y })],
    alteracoes: [
      alteracao('cli-1', { whatsapp: { antes: A, depois: B }, email: { antes: X, depois: Y } }, { id: 'e1', alterado_em: '2026-09-17T10:00:00.000Z' }),
      alteracao('cli-1', { whatsapp: { antes: B, depois: C } }, { id: 'e2', alterado_em: '2026-09-17T10:05:00.000Z' }),
    ],
  });
  const aviso = (campos: string) => `Cliente 123: ${campos} alterados no app ainda não aplicados no Control — mantido o valor do app.`;

  it('o Control aplicou só a edição mais nova e depois manda TUDO igual ao app: a mais velha fecha, sem aviso falso', async () => {
    const banco = duasEdicoes();
    const { service, fake } = await carregar(banco);

    // Envio 1: o WhatsApp novo já está lá; o e-mail, ainda não.
    const r1 = await service.receberClientes(EMPRESA, [{ ...REGISTRO, whatsapp: C, email: X }]);
    expect(r1.avisos).toEqual([aviso('email')]);
    expect(banco.alteracoes.map((a) => a['erp_atualizado_via'])).toEqual([null, 'api']);

    // Envio 2: igual ao app em tudo. Antes: "whatsapp alterados no app ainda
    // não aplicados" em todo envio, e E1 nunca fechava.
    const r2 = await service.receberClientes(EMPRESA, [{ ...REGISTRO, whatsapp: C, email: Y }]);
    expect(r2).toMatchObject({ atualizados: 0, sem_mudanca: 1, ignorados: [], avisos: [] });
    expect(banco.alteracoes.map((a) => a['erp_atualizado_via'])).toEqual(['api', 'api']);
    expect(updatesDe(fake, 'customers')).toEqual([]);
    expect(banco.clientes[0]).toMatchObject({ whatsapp: C, email: Y });

    // E o GET já não diz que há edição do app esperando o Control.
    const { registros } = await service.listarClientesAlterados(EMPRESA);
    expect(registros[0]).toMatchObject({ alterado_no_app: null });
  });

  it('o Control manda o `depois` vencido da edição mais velha (o B que o cartão ainda mostra): NÃO grava por cima do C do app, avisa e ela segue pendente', async () => {
    const banco = duasEdicoes();
    const { service, fake } = await carregar(banco);
    await service.receberClientes(EMPRESA, [{ ...REGISTRO, whatsapp: C, email: X }]);

    // Antes: {atualizados: 1, avisos: []}, E1 fechada e o WhatsApp do app virava B.
    const r = await service.receberClientes(EMPRESA, [{ ...REGISTRO, whatsapp: B, email: Y }]);

    expect(banco.clientes[0]!['whatsapp']).toBe(C);
    expect(r.avisos).toEqual([aviso('whatsapp')]);
    expect(updatesDe(fake, 'customers').every((p) => !('whatsapp' in p))).toBe(true);
    expect(banco.alteracoes[0]).toMatchObject({ erp_atualizado_em: null, erp_atualizado_via: null });
    // A leitura das já resolvidas é uma consulta só, dos clientes com pendência, paginada.
    const foraDaFila = fake.filtrosDe('customer_changes', 'or').map((f) => f.args[0]);
    expect(foraDaFila).toEqual(['erp_pendente.eq.false,erp_atualizado_em.not.is.null', 'erp_pendente.eq.false,erp_atualizado_em.not.is.null']);
  });

  it('coluna cuja ÚNICA edição já foi resolvida continua livre: o Control muda o telefone lá e o novo valor grava, sem aviso', async () => {
    // As já resolvidas entram na conferência só para dar o valor atual do app
    // (ver acima); quem protege a coluna é a edição PENDENTE. Sem essa
    // separação, a coluna de uma edição já fechada voltava a ser "protegida":
    // o valor novo do Control era descartado em silêncio, com aviso falso, e a
    // pendente do outro campo travava o carimbo em todo lote.
    const banco: Banco = {
      clientes: [cliente({ whatsapp: C, email: Y })],
      alteracoes: [
        alteracao(
          'cli-1',
          { whatsapp: { antes: B, depois: C } },
          { id: 'resolvida', erp_atualizado_em: '2026-09-17T10:30:00.000Z', erp_atualizado_via: 'api' },
        ),
        alteracao('cli-1', { email: { antes: X, depois: Y } }, { id: 'pendente', alterado_em: '2026-09-17T10:05:00.000Z' }),
      ],
    };
    const { service, fake } = await carregar(banco);

    // O telefone mudou no Control depois de a edição do app ter chegado lá.
    const r = await service.receberClientes(EMPRESA, [{ ...REGISTRO, whatsapp: '00900000009', email: Y }]);

    expect(r).toMatchObject({ atualizados: 1, ignorados: [] });
    expect(r.avisos.filter((a) => a.startsWith('Cliente '))).toEqual([]);
    expect(updatesDe(fake, 'customers')[0]).toMatchObject({ whatsapp: '00900000009' });
    expect(banco.clientes[0]!['whatsapp']).toBe('00900000009');
    // A pendente do e-mail, essa sim, fecha pelo eco do Control.
    expect(banco.alteracoes[1]).toMatchObject({ erp_atualizado_via: 'api' });
  });

  it('observação com quebra de linha do Windows (\\r\\n) no Control e \\n na edição do app (o textarea): é o mesmo texto — a edição fecha, sem aviso', async () => {
    const DO_APP = 'Entregar após 14h\nFalar com Ana';
    const banco: Banco = {
      clientes: [cliente({ observacoes: DO_APP })],
      alteracoes: [alteracao('cli-1', { observacoes: { antes: null, depois: DO_APP } })],
    };
    const { service } = await carregar(banco);

    const r = await service.receberClientes(EMPRESA, [{ ...REGISTRO, observacoes: 'Entregar após 14h\r\nFalar com Ana' }]);

    // Antes: "observacoes alterados no app ainda não aplicados" em todo envio.
    expect(r.avisos).toEqual([]);
    expect(banco.alteracoes[0]).toMatchObject({ erp_atualizado_via: 'api' });
  });

  // ─── O cliente sem código adotado pelo CNPJ (revisão de 17/09/2026) ────────
  //
  // O rep cadastra a loja no app; o Control a puxa no GET (WhatsApp B) e a
  // cria lá; o rep corrige o WhatsApp para C na ficha — sem código, a edição
  // nasce fora da fila; o POST do ciclo seguinte devolve o código com o B.
  const SEM_CODIGO = {
    erp_id: null,
    whatsapp: C,
    updated_at: '2026-09-17T10:02:00.000Z',
    erp_updated_at: null,
  };
  const correcaoSemCodigo = () =>
    alteracao('cli-1', { whatsapp: { antes: B, depois: C } }, { id: 'sem-codigo', erp_pendente: false, alterado_em: '2026-09-17T10:02:00.000Z' });
  const ADOCAO = { codigo: '999', razao_social: 'LOJA TESTE LTDA', cnpj_cpf: '00000000000191' };

  it('adotado pelo CNPJ com o valor antigo no Control: fica o valor do app, avisa, não carimba e a edição entra na fila do Control', async () => {
    const banco: Banco = { clientes: [cliente(SEM_CODIGO)], alteracoes: [correcaoSemCodigo()] };
    const { service, fake } = await carregar(banco, { com049: true });

    const r = await service.receberClientes(EMPRESA, [{ ...ADOCAO, whatsapp: B }]);

    // Antes: {atualizados: 1} só com o aviso da adoção, WhatsApp B, carimbo — e o
    // GET seguinte sem o cliente: a correção sumia nos dois lados.
    expect(r).toMatchObject({ atualizados: 1, ignorados: [] });
    expect(r.avisos).toContain('Cliente 999: whatsapp alterados no app ainda não aplicados no Control — mantido o valor do app.');
    expect(r.avisos.some((a) => a.includes('casados pelo CNPJ'))).toBe(true);
    const [patch] = updatesDe(fake, 'customers');
    expect(patch).toMatchObject({ erp_id: '00999' });
    expect('whatsapp' in patch!).toBe(false);
    expect('erp_updated_at' in patch!).toBe(false);
    expect(banco.clientes[0]).toMatchObject({ erp_id: '00999', whatsapp: C });
    expect(banco.alteracoes[0]).toMatchObject({ erp_pendente: true, erp_atualizado_em: null });

    // O GET leva a correção ao Control, marcada como edição do app.
    const { registros } = await service.listarClientesAlterados(EMPRESA, '2026-09-17T10:00:00.000Z');
    expect(registros).toHaveLength(1);
    expect(registros[0]).toMatchObject({ codigo: '00999', whatsapp: C, alterado_no_app: { campos: ['whatsapp'] } });

    // Daqui em diante é uma pendência como as outras: o B não grava; o C resolve.
    const r2 = await service.receberClientes(EMPRESA, [{ ...ADOCAO, whatsapp: B }]);
    expect(banco.clientes[0]!['whatsapp']).toBe(C);
    expect(r2.avisos).toContain('Cliente 999: whatsapp alterados no app ainda não aplicados no Control — mantido o valor do app.');
    await service.receberClientes(EMPRESA, [{ ...ADOCAO, whatsapp: C }]);
    expect(banco.alteracoes[0]).toMatchObject({ erp_pendente: true, erp_atualizado_via: 'api' });
  });

  it('adotado pelo CNPJ com o Control já igual à edição feita sem código: nada a avisar, a edição continua fora da fila e o carimbo sai', async () => {
    const banco: Banco = { clientes: [cliente(SEM_CODIGO)], alteracoes: [correcaoSemCodigo()] };
    const { service, fake } = await carregar(banco, { com049: true });

    const r = await service.receberClientes(EMPRESA, [{ ...ADOCAO, whatsapp: C }]);

    expect(r).toMatchObject({ atualizados: 1, ignorados: [] });
    expect(r.avisos.filter((a) => a.startsWith('Cliente '))).toEqual([]);
    const [patch] = updatesDe(fake, 'customers');
    expect(patch).toMatchObject({ erp_id: '00999' });
    expect(patch!['erp_updated_at']).toBe(patch!['updated_at']);
    expect(updatesDe(fake, 'customer_changes')).toEqual([]);
    expect(banco.alteracoes[0]).toMatchObject({ erp_pendente: false, erp_atualizado_em: null });
  });

  it('adotado pelo CNPJ e a fila do Control não responde: o lote não cai, o valor do app fica neste envio e o aviso diz o que fazer', async () => {
    const banco: Banco = { clientes: [cliente(SEM_CODIGO)], alteracoes: [correcaoSemCodigo()], falhar: { marcacao: true } };
    const { service } = await carregar(banco, { com049: true });
    const erro = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const r = await service.receberClientes(EMPRESA, [{ ...ADOCAO, whatsapp: B }]);

    expect(r).toMatchObject({ atualizados: 1, ignorados: [] });
    expect(banco.clientes[0]).toMatchObject({ erp_id: '00999', whatsapp: C });
    expect(r.avisos.some((a) => a.startsWith('Não deu para registrar no app que o Control ainda não tem'))).toBe(true);
    expect(banco.alteracoes[0]).toMatchObject({ erp_pendente: false });
    erro.mockRestore();
  });

  const avisoDo999 = 'Cliente 999: whatsapp alterados no app ainda não aplicados no Control — mantido o valor do app.';

  it('adotado pelo CNPJ com um registro que NÃO traz o campo corrigido: a correção entra na fila, e o envio seguinte com o valor antigo não grava por cima (revisão de 17/09/2026)', async () => {
    // O contrato deixa mandar só parte do registro ("campo que não veio não
    // mexe"), e o exemplo de adoção traz só código, razão social e CNPJ. Antes:
    // a correção ficava FORA da fila (só entrava a de coluna trazida diferente);
    // o cliente ganhava o código, o 2c nunca mais a olhava, e o envio completo
    // seguinte gravava o WhatsApp antigo por cima — {atualizados: 1, avisos: []}.
    const banco: Banco = { clientes: [cliente(SEM_CODIGO)], alteracoes: [correcaoSemCodigo()] };
    const { service, fake } = await carregar(banco, { com049: true });

    const r = await service.receberClientes(EMPRESA, [{ ...ADOCAO, email: 'x@teste.invalid' }]);

    expect(r).toMatchObject({ atualizados: 1, ignorados: [] });
    expect(banco.clientes[0]).toMatchObject({ erp_id: '00999', whatsapp: C, email: 'x@teste.invalid' });
    expect(banco.alteracoes[0]).toMatchObject({ erp_pendente: true, erp_atualizado_em: null });
    expect('erp_updated_at' in updatesDe(fake, 'customers')[0]!).toBe(false);
    // O GET leva a correção ao Control, marcada como edição do app.
    const { registros } = await service.listarClientesAlterados(EMPRESA, '2026-09-17T10:00:00.000Z');
    expect(registros[0]).toMatchObject({ codigo: '00999', whatsapp: C, alterado_no_app: { campos: ['whatsapp'] } });

    // O envio completo seguinte, com o valor antigo do Control: fica o do app, com aviso.
    const r2 = await service.receberClientes(EMPRESA, [{ ...ADOCAO, whatsapp: B }]);
    expect(banco.clientes[0]!['whatsapp']).toBe(C);
    expect(r2.avisos).toContain(avisoDo999);
    // E fecha sozinha no primeiro envio com o mesmo valor.
    await service.receberClientes(EMPRESA, [{ ...ADOCAO, whatsapp: C }]);
    expect(banco.alteracoes[0]).toMatchObject({ erp_pendente: true, erp_atualizado_via: 'api' });
  });

  it('adoção com a correção salva INTEIRA durante o lote (depois das leituras, antes do UPDATE): o registro volta para reenviar, e o reenvio mantém a correção (revisão de 17/09/2026)', async () => {
    // O Control manda o mesmo B que o lote leu: a coluna não entra no patch nem
    // na condição. Antes: o UPDATE gravava o código e o carimbo (049) por cima do
    // `updated_at` da edição, o GET ?desde= deixava de trazer o cliente e o envio
    // seguinte — cliente já com código, fora do 2c — gravava B por cima do C.
    let editou = false;
    const banco: Banco = {
      clientes: [cliente({ ...SEM_CODIGO, whatsapp: B, updated_at: '2026-09-17T10:00:00.000Z' })],
      alteracoes: [],
    };
    banco.antesDoUpdateDeCliente = () => {
      if (editou) return;
      editou = true;
      banco.clientes[0]!['whatsapp'] = C;
      banco.clientes[0]!['updated_at'] = '2026-09-17T10:07:00.000Z';
      banco.alteracoes.push(
        alteracao('cli-1', { whatsapp: { antes: B, depois: C } }, { id: 'no-meio', erp_pendente: false, alterado_em: '2026-09-17T10:07:00.000Z' }),
      );
    };
    const { service, fake } = await carregar(banco, { com049: true });

    const r = await service.receberClientes(EMPRESA, [{ ...ADOCAO, whatsapp: B }]);

    expect(r).toMatchObject({ atualizados: 0 });
    expect(r.ignorados).toEqual([{ codigo: '999', motivo: 'cadastro alterado no app durante o envio — reenvie' }]);
    expect(banco.clientes[0]).toMatchObject({ erp_id: null, whatsapp: C, erp_updated_at: null });
    expect(fake.filtrosDe('customers', 'eq').map((f) => f.args)).toContainEqual(['updated_at', '2026-09-17T10:00:00.000Z']);
    // O cliente continua saindo no GET — a última mão foi do app.
    const { registros } = await service.listarClientesAlterados(EMPRESA, '2026-09-17T10:05:00.000Z');
    expect(registros).toHaveLength(1);

    // O reenvio já vê a correção: adota, fica o C, avisa e ela entra na fila.
    const r2 = await service.receberClientes(EMPRESA, [{ ...ADOCAO, whatsapp: B }]);
    expect(r2).toMatchObject({ atualizados: 1, ignorados: [] });
    expect(banco.clientes[0]).toMatchObject({ erp_id: '00999', whatsapp: C });
    expect(r2.avisos).toContain(avisoDo999);
    expect(banco.alteracoes[0]).toMatchObject({ erp_pendente: true, erp_atualizado_em: null });
    const r3 = await service.receberClientes(EMPRESA, [{ ...ADOCAO, whatsapp: B }]);
    expect(banco.clientes[0]!['whatsapp']).toBe(C);
    expect(r3.avisos).toContain(avisoDo999);
  });

  it('adoção com a correção gravada no cliente ANTES da leitura e o histórico só DEPOIS do 2c: volta ao valor do app, avisa e entra na fila (revisão de 17/09/2026)', async () => {
    // A tela grava o cliente e só depois o histórico. O lote leu o C sem
    // histórico, o compare-and-set passou (a condição era o próprio C) e o B do
    // Control ficava. O 3b só relia edições PENDENTES — e a de cliente sem
    // código nasce fora da fila: a correção sumia dos dois lados, sem aviso.
    let historicoGravado = false;
    const banco: Banco = { clientes: [cliente({ ...SEM_CODIGO, whatsapp: C })], alteracoes: [] };
    banco.antesDoUpdateDeCliente = () => {
      if (historicoGravado) return;
      historicoGravado = true;
      banco.alteracoes.push(
        alteracao('cli-1', { whatsapp: { antes: B, depois: C } }, { id: 'no-meio', erp_pendente: false, alterado_em: '2026-09-17T10:02:00.000Z' }),
      );
    };
    const { service, fake } = await carregar(banco);

    const r = await service.receberClientes(EMPRESA, [{ ...ADOCAO, whatsapp: B, email: 'novo@teste.invalid' }]);

    expect(r).toMatchObject({ atualizados: 1, ignorados: [] });
    expect(banco.clientes[0]).toMatchObject({ erp_id: '00999', whatsapp: C, email: 'novo@teste.invalid' });
    expect(r.avisos).toContain(avisoDo999);
    expect(banco.alteracoes[0]).toMatchObject({ erp_pendente: true, erp_atualizado_em: null });
    // A volta só vale onde ainda está o que o lote gravou, e só na coluna da edição.
    const [, devolvido] = updatesDe(fake, 'customers');
    expect(devolvido).toMatchObject({ whatsapp: C });
    expect('email' in devolvido!).toBe(false);
    expect(fake.filtrosDe('customers', 'eq').map((f) => f.args)).toContainEqual(['whatsapp', B]);

    // O envio seguinte com o B: fica o C, com o aviso.
    const r2 = await service.receberClientes(EMPRESA, [{ ...ADOCAO, whatsapp: B }]);
    expect(banco.clientes[0]!['whatsapp']).toBe(C);
    expect(r2.avisos).toContain(avisoDo999);
  });

  it('a correção que chega depois do 2c e que o Control JÁ tem continua fora da fila; a de campo que o registro não traz entra', async () => {
    const tardia = (campos: Record<string, { antes: string | null; depois: string | null }>, id: string) =>
      alteracao('cli-1', campos, { id, erp_pendente: false, alterado_em: '2026-09-17T10:02:00.000Z' });
    // O Control já tem o C: nada a fazer.
    const igual: Banco = { clientes: [cliente({ ...SEM_CODIGO, whatsapp: C })], alteracoes: [] };
    igual.antesDoUpdateDeCliente = () => {
      if (igual.alteracoes.length === 0) igual.alteracoes.push(tardia({ whatsapp: { antes: B, depois: C } }, 'ja-tem'));
    };
    const a = await carregar(igual);
    const r = await a.service.receberClientes(EMPRESA, [{ ...ADOCAO, whatsapp: C, email: 'novo@teste.invalid' }]);
    expect(r).toMatchObject({ atualizados: 1, ignorados: [] });
    expect(r.avisos.filter((x: string) => x.startsWith('Cliente '))).toEqual([]);
    expect(igual.alteracoes[0]).toMatchObject({ erp_pendente: false, erp_atualizado_em: null });

    // O registro não traz o campo: entra na fila (a adoção é a única janela).
    vi.resetModules();
    const ausente: Banco = { clientes: [cliente({ ...SEM_CODIGO, whatsapp: C })], alteracoes: [] };
    ausente.antesDoUpdateDeCliente = () => {
      if (ausente.alteracoes.length === 0) ausente.alteracoes.push(tardia({ whatsapp: { antes: B, depois: C } }, 'sem-campo'));
    };
    const b = await carregar(ausente);
    const r2 = await b.service.receberClientes(EMPRESA, [{ ...ADOCAO, email: 'novo@teste.invalid' }]);
    expect(r2).toMatchObject({ atualizados: 1, ignorados: [] });
    expect(ausente.clientes[0]).toMatchObject({ erp_id: '00999', whatsapp: C });
    expect(ausente.alteracoes[0]).toMatchObject({ erp_pendente: true, erp_atualizado_em: null });
  });

  it('CPF/CNPJ corrigido no app ANTES de o código voltar: o registro com o documento antigo adota o cliente, não cria um segundo cadastro', async () => {
    // Revisão de 17/09/2026. O rep cadastra a loja no app (documento A), o
    // Control a puxa no GET e leva horas para devolver o código; nesse meio o
    // financeiro corrige o documento para B — a tela convida a isso, porque diz
    // "ainda sem código no Control". Sem código, a edição nasce FORA da fila.
    // Antes: o POST com o código e o documento A não achava cadastro nenhum
    // (por documento o app tem B; por código o cliente não tem código) e virava
    // INSERT calado — duas lojas no app, a nova com o código, a carteira, o
    // bloqueio e o limite, e a original saindo de novo no GET como nova.
    const A = '00000000000191';
    const DOCUMENTO_NOVO = '00000000000272';
    const banco: Banco = {
      clientes: [cliente({ ...SEM_CODIGO, whatsapp: B, cnpj: DOCUMENTO_NOVO })],
      alteracoes: [
        alteracao('cli-1', { cnpj: { antes: A, depois: DOCUMENTO_NOVO } }, { id: 'sem-codigo', erp_pendente: false }),
      ],
    };
    const { service, fake } = await carregar(banco);

    const r = await service.receberClientes(EMPRESA, [{ ...ADOCAO, cnpj_cpf: '00.000.000/0001-91', bloqueado: 'S' }]);

    expect(r).toMatchObject({ recebidos: 1, criados: 0, atualizados: 1, ignorados: [] });
    expect(banco.clientes).toHaveLength(1);
    expect(fake.gravacoes.filter((g) => g.tabela === 'customers' && g.operacao === 'insert')).toEqual([]);
    // O cliente aprende o código e o bloqueio do Control, e fica com o documento do app.
    const [patch] = updatesDe(fake, 'customers');
    expect(patch).toMatchObject({ erp_id: '00999', blocked: true });
    expect('cnpj' in patch!).toBe(false);
    expect(banco.clientes[0]).toMatchObject({ id: 'cli-1', erp_id: '00999', cnpj: DOCUMENTO_NOVO });
    expect(r.avisos).toContain(
      'Cliente 999: cnpj_cpf alterados no app ainda não aplicados no Control — mantido o valor do app.',
    );
    // A correção entra na fila do Control e sai no GET como edição do app.
    expect(banco.alteracoes[0]).toMatchObject({ erp_pendente: true, erp_atualizado_em: null });
    const { registros } = await service.listarClientesAlterados(EMPRESA, null);
    expect(registros).toHaveLength(1);
    expect(registros[0]).toMatchObject({
      codigo: '00999',
      chave: DOCUMENTO_NOVO,
      novo_no_control: false,
      alterado_no_app: { campos: ['cnpj_cpf'] },
    });
  });

  it('documento antigo de cliente sem código só é procurado quando o CÓDIGO do registro não está no app, e o mesmo antigo em duas lojas não escolhe nenhuma', async () => {
    const A = '00000000000191';
    const DOCUMENTO_NOVO = '00000000000272';
    const OUTRO = '00000000000353';
    // 1) O código do registro já é de um cadastro do app: nem consulta o histórico por ele.
    // (Revisão de 17/09/2026: antes o corte era "o documento acha cadastro" —
    // e era justamente esse o caso em que o registro caía na loja errada; ver
    // o teste do documento antigo que hoje é de outra loja.)
    const casa: Banco = {
      clientes: [cliente({ ...SEM_CODIGO, cnpj: DOCUMENTO_NOVO }), cliente({ id: 'cli-2', erp_id: '00888', cnpj: OUTRO, name: 'OUTRA LOJA' })],
      alteracoes: [alteracao('cli-1', { cnpj: { antes: A, depois: DOCUMENTO_NOVO } }, { erp_pendente: false })],
    };
    const a = await carregar(casa);
    const ra = await a.service.receberClientes(EMPRESA, [{ ...ADOCAO, codigo: '888', razao_social: 'OUTRA LOJA', cnpj_cpf: OUTRO, bloqueado: 'S' }]);
    expect(ra).toMatchObject({ atualizados: 1, ignorados: [] });
    expect(casa.clientes[1]).toMatchObject({ id: 'cli-2', blocked: true });
    expect(a.fake.filtrosDe('customer_changes', 'in').map((f) => f.args[0])).not.toContain('campos->cnpj->>antes');

    // 1b) O documento do registro é o de HOJE do próprio cliente corrigido: é ele, adotado — sem segundo cadastro.
    vi.resetModules();
    const proprio: Banco = {
      clientes: [cliente({ ...SEM_CODIGO, cnpj: A })],
      alteracoes: [alteracao('cli-1', { cnpj: { antes: A, depois: DOCUMENTO_NOVO } }, { erp_pendente: false })],
    };
    const p = await carregar(proprio);
    const rp = await p.service.receberClientes(EMPRESA, [{ ...ADOCAO, cnpj_cpf: A }]);
    expect(rp).toMatchObject({ criados: 0, atualizados: 1, ignorados: [] });
    expect(proprio.clientes).toHaveLength(1);
    expect(proprio.clientes[0]).toMatchObject({ id: 'cli-1', erp_id: '00999' });

    // 2) Duas lojas sem código com o MESMO documento antigo: escolher fundiria
    // as duas, então o registro segue o caminho de sempre (vira cadastro novo).
    vi.resetModules();
    const duas: Banco = {
      clientes: [
        cliente({ ...SEM_CODIGO, id: 'cli-1', cnpj: DOCUMENTO_NOVO }),
        cliente({ ...SEM_CODIGO, id: 'cli-2', cnpj: OUTRO, name: 'OUTRA LOJA' }),
      ],
      alteracoes: [
        alteracao('cli-1', { cnpj: { antes: A, depois: DOCUMENTO_NOVO } }, { erp_pendente: false }),
        alteracao('cli-2', { cnpj: { antes: A, depois: OUTRO } }, { erp_pendente: false }),
      ],
    };
    const b = await carregar(duas);
    const r = await b.service.receberClientes(EMPRESA, [{ ...ADOCAO, cnpj_cpf: A }]);
    expect(r).toMatchObject({ criados: 1, atualizados: 0 });
    expect(updatesDe(b.fake, 'customers')).toEqual([]);
    expect(duas.clientes.map((c) => c['erp_id'])).toEqual([null, null]);
  });

  // ─── O documento antigo que HOJE é de outra loja (revisão de 17/09/2026) ───
  //
  // O rep cadastra a loja X com o CNPJ A por engano; o Control a puxa e cria o
  // 500; o financeiro corrige X para B; a loja Y, dona de A, se cadastra com
  // ele. O Control manda o 500 com A. O corte "só documento sem dono" mandava o
  // registro para Y: ela ganhava o código, a razão social, a carteira, o
  // bloqueio e o limite de X — e X seguia sem código.
  const DOC_A = '00000000000191';
  const DOC_B = '00000000000272';
  const docsDasLojas = (codigoDeY: string | null): Banco => ({
    clientes: [
      cliente({ ...SEM_CODIGO, id: 'cli-x', cnpj: DOC_B, name: 'LOJA X LTDA', rep_erp_id: null }),
      cliente({ ...SEM_CODIGO, id: 'cli-y', erp_id: codigoDeY, cnpj: DOC_A, name: 'LOJA Y LTDA', rep_erp_id: '00111' }),
    ],
    alteracoes: [alteracao('cli-x', { cnpj: { antes: DOC_A, depois: DOC_B } }, { id: 'troca-x', erp_pendente: false })],
  });
  const REGISTRO_DE_X = { codigo: '500', razao_social: 'LOJA X LTDA', cnpj_cpf: DOC_A, representante: '00779', bloqueado: 'S', limite_credito: 1234 };

  it('documento antigo de um cliente sem código que hoje é de OUTRA loja sem código: a razão social do registro desempata — adota X, e Y fica como estava', async () => {
    const banco = docsDasLojas(null);
    const { service } = await carregar(banco);

    const r = await service.receberClientes(EMPRESA, [REGISTRO_DE_X]);

    expect(r).toMatchObject({ criados: 0, atualizados: 1, ignorados: [] });
    const [x, y] = banco.clientes;
    expect(x).toMatchObject({ id: 'cli-x', erp_id: '00500', cnpj: DOC_B, rep_erp_id: '00779', blocked: true, credit_limit: 1234 });
    expect(y).toMatchObject({ id: 'cli-y', erp_id: null, name: 'LOJA Y LTDA', rep_erp_id: '00111', blocked: false, credit_limit: null });
    // O documento do app fica, com o aviso de sempre, e a troca entra na fila do Control.
    expect(r.avisos).toContain('Cliente 500: cnpj_cpf alterados no app ainda não aplicados no Control — mantido o valor do app.');
    expect(banco.alteracoes[0]).toMatchObject({ erp_pendente: true, erp_atualizado_em: null });
  });

  it('a outra loja TEM código: o registro (com código que o app não tem) não é dela — adota X em vez de recusar', async () => {
    const banco = docsDasLojas('00700');
    const { service } = await carregar(banco);

    // Antes: ignorados "CNPJ já é do cliente de código 00700 no app", e X nunca aprendia o código.
    const r = await service.receberClientes(EMPRESA, [{ ...REGISTRO_DE_X, razao_social: 'OUTRO NOME QUALQUER' }]);

    expect(r).toMatchObject({ atualizados: 1, ignorados: [] });
    expect(banco.clientes[0]).toMatchObject({ id: 'cli-x', erp_id: '00500', blocked: true });
    expect(banco.clientes[1]).toMatchObject({ id: 'cli-y', erp_id: '00700', blocked: false });
  });

  it('a razão social é a da loja que tem o documento hoje: é ela (o caso de sempre); nenhuma das duas: não adivinha — ignorados, nada gravado', async () => {
    // O Control criou o cadastro com a razão social de Y: o registro é de Y.
    const deY = docsDasLojas(null);
    const a = await carregar(deY);
    const r = await a.service.receberClientes(EMPRESA, [{ ...REGISTRO_DE_X, razao_social: 'Loja Y Ltda.' }]);
    expect(r).toMatchObject({ atualizados: 1, ignorados: [] });
    expect(deY.clientes[1]).toMatchObject({ id: 'cli-y', erp_id: '00500' });
    expect(deY.clientes[0]).toMatchObject({ id: 'cli-x', erp_id: null });

    // Sem como decidir: nenhuma das duas recebe o código (nem o bloqueio, nem a carteira).
    vi.resetModules();
    const nenhuma = docsDasLojas(null);
    const b = await carregar(nenhuma);
    const r2 = await b.service.receberClientes(EMPRESA, [{ ...REGISTRO_DE_X, razao_social: 'OUTRO NOME QUALQUER' }]);
    expect(r2).toMatchObject({ criados: 0, atualizados: 0 });
    expect(r2.ignorados).toEqual([
      {
        codigo: '500',
        motivo: 'CNPJ corrigido no app num cliente sem código e hoje de outro cadastro sem código — confira qual dos dois é este cliente',
      },
    ]);
    expect(updatesDe(b.fake, 'customers')).toEqual([]);
    expect(nenhuma.clientes.map((c) => c['erp_id'])).toEqual([null, null]);
  });

  it('cliente que JÁ tinha código não confere as edições de quando não tinha: o valor do Control grava como sempre', async () => {
    // A edição antiga, feita antes de o cliente ganhar código, já foi para o
    // Control "pela fila de incluir" — só a adoção a confere.
    const banco: Banco = {
      clientes: [cliente({ whatsapp: C })],
      alteracoes: [correcaoSemCodigo()],
    };
    const { service, fake } = await carregar(banco);

    const r = await service.receberClientes(EMPRESA, [{ ...REGISTRO, whatsapp: B }]);

    expect(r).toMatchObject({ atualizados: 1, avisos: [] });
    expect(updatesDe(fake, 'customers')[0]).toMatchObject({ whatsapp: B });
    expect(fake.filtrosDe('customer_changes', 'or')).toEqual([]);
  });

  it('cliente que JÁ tinha código, COM pendência de outro campo: a edição de quando não tinha código segue sem proteger a coluna', async () => {
    // Aqui as edições fora da fila SÃO lidas (o cliente tem pendência), e é o
    // `adotado` que decide: só na adoção pelo CNPJ elas valem como pendentes.
    // Sem essa fronteira, o Control nunca mais conseguiria mudar o telefone
    // deste cliente — a edição velha, resolvida "pela fila de incluir",
    // protegeria a coluna para sempre e voltaria para a fila do financeiro.
    const D = '00900000004';
    const banco: Banco = {
      clientes: [cliente({ whatsapp: C, email: Y })],
      alteracoes: [
        correcaoSemCodigo(),
        alteracao('cli-1', { email: { antes: X, depois: Y } }, { id: 'pendente', alterado_em: '2026-09-17T10:05:00.000Z' }),
      ],
    };
    const { service, fake } = await carregar(banco);

    // O Control manda o telefone dele (D) e não manda o e-mail.
    const r = await service.receberClientes(EMPRESA, [{ ...REGISTRO, whatsapp: D }]);

    expect(r).toMatchObject({ atualizados: 1, ignorados: [] });
    expect(r.avisos.filter((a) => a.startsWith('Cliente '))).toEqual([]);
    expect(updatesDe(fake, 'customers')[0]).toMatchObject({ whatsapp: D });
    expect(banco.clientes[0]!['whatsapp']).toBe(D);
    // A edição de quando não tinha código NÃO volta para a fila do financeiro…
    expect(updatesDe(fake, 'customer_changes')).toEqual([]);
    expect(banco.alteracoes[0]).toMatchObject({ erp_pendente: false, erp_atualizado_em: null });
    // …e a pendente do e-mail continua esperando (o Control não mandou o campo).
    expect(banco.alteracoes[1]).toMatchObject({ erp_pendente: true, erp_atualizado_em: null });
    // As já resolvidas foram lidas: é o `adotado` que decide, não a leitura.
    expect(fake.filtrosDe('customer_changes', 'or').map((f) => f.args[0])).toEqual([
      'erp_pendente.eq.false,erp_atualizado_em.not.is.null',
    ]);
  });

  it('COM a 049: não carimba enquanto sobra edição do app; o cliente em dia carimba como sempre; resolvida no mesmo envio, carimba', async () => {
    const banco: Banco = {
      clientes: [
        cliente({ id: 'pendente', erp_id: '00001', cnpj: null, erp_updated_at: null }),
        cliente({ id: 'em-dia', erp_id: '00002', cnpj: null, erp_updated_at: null }),
        cliente({ id: 'resolve', erp_id: '00003', cnpj: null, erp_updated_at: null }),
      ],
      alteracoes: [
        alteracao('pendente', { whatsapp: { antes: '00900000001', depois: '00900000002' } }),
        alteracao('resolve', { whatsapp: { antes: '00900000001', depois: '00900000002' } }),
      ],
    };
    const { service, fake } = await carregar(banco, { com049: true });

    const r = await service.receberClientes(EMPRESA, [
      {
        codigo: '1',
        razao_social: 'LOJA TESTE LTDA',
        whatsapp: '00900000001',
        email: 'a@teste.invalid',
      },
      { codigo: '2', razao_social: 'LOJA TESTE LTDA', email: 'b@teste.invalid' },
      {
        codigo: '3',
        razao_social: 'LOJA TESTE LTDA',
        whatsapp: '00900000002',
        email: 'c@teste.invalid',
      },
    ]);

    expect(r.atualizados).toBe(3);
    const [pendente, emDia, resolve] = updatesDe(fake, 'customers');
    expect('erp_updated_at' in pendente!).toBe(false);
    expect(emDia!['erp_updated_at']).toBe(emDia!['updated_at']);
    expect(resolve!['erp_updated_at']).toBe(resolve!['updated_at']);
    expect(banco.alteracoes.map((a) => a['erp_atualizado_via'])).toEqual([null, 'api']);
  });

  it('lê as pendências em lote: uma consulta por lote de clientes casados (301 → 2 por leitura), nunca uma por cliente', async () => {
    const clientes = Array.from({ length: 301 }, (_, i) =>
      cliente({ id: `c-${i}`, erp_id: String(i + 1).padStart(5, '0'), cnpj: null, name: 'ANTIGO' }),
    );
    const banco: Banco = { clientes, alteracoes: [] };
    const { service, fake } = await carregar(banco);

    const r = await service.receberClientes(
      EMPRESA,
      clientes.map((c) => ({ codigo: c['erp_id'], razao_social: 'NOVO' })),
    );

    expect(r.atualizados).toBe(301);
    // Duas leituras em lote: as pendências antes de gravar (2b) e a reconferência
    // depois de gravar (3b, revisão de 17/09/2026) — cada uma, um lote de ids por
    // consulta.
    const selects = fake.filtrosDe('customer_changes', 'in');
    expect(selects).toHaveLength(4);
    for (const leitura of [0, 2]) {
      expect((selects[leitura]!.args[1] as string[]).length).toBe(300);
      expect(selects[leitura + 1]!.args[1]).toEqual(['c-300']);
    }
    // Paginado e ordenado (o PostgREST corta em 1.000 em silêncio).
    expect(fake.filtrosDe('customer_changes', 'range')).toHaveLength(4);
  });

  it('lote só com clientes novos não consulta nem sonda a 051', async () => {
    const { service, fake, sondas } = await carregar({ clientes: [], alteracoes: [] });

    const r = await service.receberClientes(EMPRESA, [{ codigo: '1', razao_social: 'LOJA NOVA' }]);

    expect(r.criados).toBe(1);
    expect(fake.filtrosDe('customer_changes')).toEqual([]);
    expect(sondas).not.toContain('customer_changes.id');
  });

  it('falha ao ler as pendências LANÇA antes de gravar qualquer coisa', async () => {
    const banco: Banco = {
      clientes: [cliente()],
      alteracoes: [
        alteracao('cli-1', { whatsapp: { antes: '00900000001', depois: '00900000002' } }),
      ],
      falhar: { leitura: true },
    };
    const { service, fake } = await carregar(banco);

    await expect(
      service.receberClientes(EMPRESA, [
        { ...REGISTRO, whatsapp: '00900000001' },
        { codigo: '9', razao_social: 'NOVA' },
      ]),
    ).rejects.toThrow(/tempo esgotado/);
    expect(fake.gravacoes).toEqual([]);
  });

  it('falha ao marcar as alcançadas não derruba o lote: os clientes gravam, aviso, e as edições seguem pendentes', async () => {
    const banco: Banco = {
      clientes: [cliente()],
      alteracoes: [
        alteracao('cli-1', { whatsapp: { antes: '00900000001', depois: '00900000002' } }),
      ],
      falhar: { marcacao: true },
    };
    const { service, fake } = await carregar(banco);
    const erro = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const r = await service.receberClientes(EMPRESA, [
      { ...REGISTRO, whatsapp: '00900000002', email: 'novo@teste.invalid' },
    ]);

    expect(r.atualizados).toBe(1);
    expect(updatesDe(fake, 'customers')[0]).toMatchObject({ email: 'novo@teste.invalid' });
    expect(r.avisos.some((a) => a.includes('continuam pendentes'))).toBe(true);
    expect(banco.alteracoes[0]!['erp_atualizado_em']).toBeNull();
    erro.mockRestore();
  });

  it('mais de 20 clientes com campo mantido: 20 avisos e um "e mais"', async () => {
    const clientes = Array.from({ length: 22 }, (_, i) =>
      cliente({ id: `c-${i}`, erp_id: String(i + 1).padStart(5, '0'), cnpj: null }),
    );
    const banco: Banco = {
      clientes,
      alteracoes: clientes.map((c) =>
        alteracao(String(c['id']), { whatsapp: { antes: '00900000001', depois: '00900000002' } }),
      ),
    };
    const { service } = await carregar(banco);

    const r = await service.receberClientes(
      EMPRESA,
      clientes.map((c) => ({
        codigo: c['erp_id'],
        razao_social: 'LOJA TESTE LTDA',
        whatsapp: '00900000001',
      })),
    );

    expect(r.avisos.filter((a) => a.startsWith('Cliente '))).toHaveLength(20);
    expect(r.avisos).toContain(
      'E mais 2 cliente(s) com campos alterados no app ainda não aplicados no Control — mantido o valor do app (veja alterado_no_app no GET /clientes).',
    );
  });

  it('SEM a 051: nada muda — o valor do Control grava, sem aviso, sem consultar customer_changes', async () => {
    const banco: Banco = {
      clientes: [cliente()],
      alteracoes: [
        alteracao('cli-1', { whatsapp: { antes: '00900000001', depois: '00900000002' } }),
      ],
    };
    const { service, fake } = await carregar(banco, { com051: false });

    const r = await service.receberClientes(EMPRESA, [{ ...REGISTRO, whatsapp: '00900000001' }]);

    expect(r).toMatchObject({ atualizados: 1, avisos: [] });
    expect(updatesDe(fake, 'customers')[0]).toMatchObject({ whatsapp: '00900000001' });
    expect(fake.filtrosDe('customer_changes')).toEqual([]);
  });
});

// ─── GET /clientes?desde= ────────────────────────────────────────────────────

describe('GET /clientes — alterado_no_app (051)', () => {
  it('traz a edição pendente mais recente e os campos com os nomes do contrato; sem pendência, null', async () => {
    const banco: Banco = {
      clientes: [
        cliente({ id: 'c-1' }),
        cliente({ id: 'c-2', erp_id: '00124', cnpj: '00000000000272' }),
      ],
      alteracoes: [
        alteracao(
          'c-1',
          { whatsapp: { antes: '1', depois: '00900000002' } },
          { alterado_em: '2026-09-17T10:00:00.000Z' },
        ),
        alteracao(
          'c-1',
          {
            cep: { antes: '00000002', depois: '00000001' },
            address: { antes: 'x', depois: 'y' },
            name: { antes: 'A', depois: 'LOJA TESTE LTDA' },
          },
          { alterado_em: '2026-09-17T11:30:00.000Z' },
        ),
        // Já resolvida e a que nunca precisou ir ao Control: não contam.
        alteracao(
          'c-2',
          { email: { antes: 'a', depois: 'b' } },
          { erp_atualizado_em: '2026-09-17T12:00:00.000Z', erp_atualizado_via: 'app' },
        ),
        alteracao('c-2', { trade_name: { antes: 'a', depois: 'b' } }, { erp_pendente: false }),
      ],
    };
    const { service, fake } = await carregar(banco);

    const { registros } = await service.listarClientesAlterados(EMPRESA, '2026-09-17T00:00:00Z');

    expect(registros.map((r: { alterado_no_app: unknown }) => r.alterado_no_app)).toEqual([
      { em: '2026-09-17T11:30:00.000Z', campos: ['razao_social', 'whatsapp', 'endereco'] },
      null,
    ]);
    // Uma leitura só, da empresa inteira, paginada — não uma por cliente.
    expect(fake.filtrosDe('customer_changes', 'range')).toHaveLength(1);
    expect(fake.filtrosDe('customer_changes', 'in')).toEqual([]);
    expect(fake.filtrosDe('customer_changes', 'eq').map((f) => f.args)).toEqual([
      ['company_id', EMPRESA],
      ['erp_pendente', true],
    ]);
  });

  it('COM a 049: o cliente com edição do app pendente não some pelo anti-eco (edição nos segundos de folga)', async () => {
    const banco: Banco = {
      clientes: [
        // O Control gravou às 12:00; o app editou 2 s depois — dentro da folga.
        cliente({
          id: 'editado',
          erp_id: '00001',
          erp_updated_at: '2026-09-17T12:00:00.000Z',
          updated_at: '2026-09-17T12:00:02.000Z',
        }),
        cliente({
          id: 'eco',
          erp_id: '00002',
          erp_updated_at: '2026-09-17T12:00:00.000Z',
          updated_at: '2026-09-17T12:00:00.300Z',
        }),
      ],
      alteracoes: [alteracao('editado', { whatsapp: { antes: '1', depois: '00900000002' } })],
    };
    const { service } = await carregar(banco, { com049: true });

    const { registros } = await service.listarClientesAlterados(EMPRESA, '2026-09-17T00:00:00Z');

    expect(registros.map((r: { codigo: string }) => r.codigo)).toEqual(['00001']);
    expect(registros[0]).toMatchObject({ alterado_no_app: { campos: ['whatsapp'] } });
  });

  it('SEM a 051: alterado_no_app sai null e customer_changes não é lida', async () => {
    const { service, fake } = await carregar(
      {
        clientes: [cliente()],
        alteracoes: [alteracao('cli-1', { whatsapp: { antes: '1', depois: '2' } })],
      },
      { com051: false },
    );

    const { registros } = await service.listarClientesAlterados(EMPRESA);

    expect(registros[0]).toMatchObject({ alterado_no_app: null });
    expect(fake.filtrosDe('customer_changes')).toEqual([]);
  });

  it('o cliente com edição pendente sai em TODA puxada até o Control ter a edição — mesmo com o desde depois do updated_at', async () => {
    // 10:00: o rep trocou o WhatsApp de c-1 (pendente). A puxada das 10:01 já o
    // trouxe; o Control não aplicou e reenviou o valor antigo, que o POST não
    // grava — então o updated_at não anda. A puxada seguinte usa desde=10:01.
    const banco: Banco = {
      clientes: [
        cliente({ id: 'c-1', updated_at: '2026-09-17T10:00:00.000Z' }),
        cliente({ id: 'c-2', erp_id: '00124', cnpj: '00000000000272', updated_at: '2026-09-17T09:00:00.000Z' }),
      ],
      alteracoes: [
        alteracao('c-1', { whatsapp: { antes: '00900000001', depois: '00900000002' } }),
        // A resolvida não traz o cliente de volta.
        alteracao(
          'c-2',
          { email: { antes: 'a@teste.invalid', depois: 'loja@teste.invalid' } },
          { erp_atualizado_em: '2026-09-17T09:30:00.000Z', erp_atualizado_via: 'app' },
        ),
      ],
    };
    const { service } = await carregar(banco);

    const { registros } = await service.listarClientesAlterados(EMPRESA, '2026-09-17T10:01:00.000Z');

    expect(registros.map((r: { codigo: string }) => r.codigo)).toEqual(['00123']);
    expect(registros[0]).toMatchObject({
      whatsapp: '00900000002',
      alterado_no_app: { campos: ['whatsapp'] },
    });
  });

  it('paginado pela chave: o cliente gravado de novo entre uma página e outra não empurra outro para fora da puxada', async () => {
    const hora = (s: number) => new Date(Date.UTC(2026, 8, 17, 10, 0, s)).toISOString();
    const clientes = Array.from({ length: 1001 }, (_, i) =>
      cliente({
        id: `c-${String(i).padStart(4, '0')}`,
        erp_id: String(i + 1).padStart(5, '0'),
        cnpj: null,
        updated_at: hora(i),
      }),
    );
    let paginas = 0;
    const banco: Banco = {
      clientes,
      alteracoes: [],
      // Lida a primeira página, alguém grava de novo o primeiro cliente dela.
      depoisDeLerClientes: () => {
        paginas += 1;
        if (paginas === 1) clientes[0]!['updated_at'] = hora(5000);
      },
    };
    const { service } = await carregar(banco);

    const { registros } = await service.listarClientesAlterados(EMPRESA);

    const codigos = registros.map((r: { codigo: string }) => r.codigo);
    // O da fronteira (o 1.001º, código 01001) caía na página já lida pela posição.
    expect(codigos).toContain('01001');
    expect(codigos.filter((c: string) => c === '00001')).toHaveLength(1);
    expect(new Set(codigos).size).toBe(1001);
  });

  it('erro ao ler as pendências LANÇA (500) — o Control tenta de novo', async () => {
    const { service } = await carregar({
      clientes: [cliente()],
      alteracoes: [],
      falhar: { leitura: true },
    });

    await expect(service.listarClientesAlterados(EMPRESA)).rejects.toThrow(/tempo esgotado/);
  });
});

// ─── servidor_hora: a hora de ANTES da consulta ──────────────────────────────

describe('GET /clientes e /representantes — servidor_hora', () => {
  const AUTH = '../apps/api/src/modules/partner/partner.auth.js';
  const EXCLUSAO = '../apps/api/src/modules/orders/exclusaoPeloControl.service.js';
  const CONTROLLER = '../apps/api/src/modules/partner/partner.cadastros.controller.js';

  afterEach(() => {
    vi.doUnmock(AUTH);
    vi.doUnmock(EXCLUSAO);
    vi.doUnmock(SERVICO);
  });

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

  const requisicao = (query: Record<string, string>) =>
    ({
      body: undefined,
      params: {},
      query,
      headers: { 'x-api-key': 'chave' },
    }) as unknown as FastifyRequest<{
      Querystring: { desde?: string };
    }> & { partnerLog?: { detalhe?: Record<string, unknown> | null } | null };

  it('é tomada antes da consulta: a mudança gravada enquanto a lista era lida sai na próxima puxada', async () => {
    const fake = criarSupabaseFake({
      companies: {
        data: {
          canal_pedido_erp: 'manual',
          canal_faturamento: 'manual',
          canal_cadastro: 'api',
          canal_retrato: 'carga',
          canal_catalogo: 'carga',
        },
        error: null,
      },
    });
    vi.doMock(SUPABASE, () => ({ supabase: fake.cliente }));
    vi.doMock(AUTH, () => ({
      requirePartner: () =>
        Promise.resolve({ name: 'control-teste', key: 'chave', company_id: EMPRESA }),
    }));
    vi.doMock(EXCLUSAO, () => ({ excluirPedidoPeloControl: vi.fn() }));

    const ANTES = new Date('2026-09-17T15:00:00.000Z');
    const DURANTE = new Date('2026-09-17T15:00:04.000Z');
    const cliente = {
      codigo: '00123',
      alterado_no_app: { em: '2026-09-17T14:59:00.000Z', campos: ['whatsapp'] },
    };
    const listarClientesAlterados = vi.fn(async () => {
      // A consulta demora: o relógio anda enquanto ela roda.
      vi.setSystemTime(DURANTE);
      return { registros: [cliente, { codigo: '00124', alterado_no_app: null }], avisos: [] };
    });
    const listarRepresentantesAlterados = vi.fn(async () => {
      vi.setSystemTime(DURANTE);
      return { registros: [], avisos: [] };
    });
    vi.doMock(SERVICO, () => ({ listarClientesAlterados, listarRepresentantesAlterados }));
    const controller = await import(CONTROLLER);
    vi.useFakeTimers({ toFake: ['Date'] });

    // Antes da consulta — e recuada pela folga (revisão de 17/09/2026).
    const esperada = new Date(ANTES.getTime() - controller.FOLGA_DO_SERVIDOR_HORA_MS).toISOString();
    vi.setSystemTime(ANTES);
    const c = replyFalso();
    const reqC = requisicao({ desde: '2026-09-17T14:55:00Z' });
    await controller.partnerClientesAlteradosHandler(reqC, c.reply);
    expect(c.enviado.status).toBe(200);
    expect(c.enviado.corpo).toMatchObject({ total: 2, servidor_hora: esperada });
    // O registro da chamada conta os clientes com edição do app pendente.
    expect(reqC.partnerLog).toMatchObject({ detalhe: { clientes: 2, alterados_no_app: 1 } });

    vi.setSystemTime(ANTES);
    const r = replyFalso();
    await controller.partnerRepresentantesAlteradosHandler(requisicao({}), r.reply);
    expect(r.enviado.corpo).toMatchObject({ total: 0, servidor_hora: esperada });
  });

  it('a edição carimbada ANTES da puxada e confirmada pelo banco DEPOIS da leitura sai na puxada seguinte (a folga)', async () => {
    const fake = criarSupabaseFake({
      companies: {
        data: {
          canal_pedido_erp: 'manual',
          canal_faturamento: 'manual',
          canal_cadastro: 'api',
          canal_retrato: 'carga',
          canal_catalogo: 'carga',
        },
        error: null,
      },
    });
    vi.doMock(SUPABASE, () => ({ supabase: fake.cliente }));
    vi.doMock(AUTH, () => ({
      requirePartner: () =>
        Promise.resolve({ name: 'control-teste', key: 'chave', company_id: EMPRESA }),
    }));
    vi.doMock(EXCLUSAO, () => ({ excluirPedidoPeloControl: vi.fn() }));

    // O PATCH do cadastro carimbou `updated_at` com a hora da API e só então
    // mandou o UPDATE; ele esperou uma trava e confirmou um segundo depois de a
    // puxada ter lido a lista — que, portanto, não o trouxe.
    const PUXADA = new Date('2026-09-17T15:00:00.000Z');
    const carimboDaEdicao = '2026-09-17T14:59:59.000Z';
    const confirmadas: Array<{ updated_at: string }> = [];
    const listarClientesAlterados = vi.fn(async (_empresa: string, desde?: string | null) => ({
      registros: confirmadas.filter((l) => !desde || Date.parse(l.updated_at) >= Date.parse(desde)),
      avisos: [],
    }));
    vi.doMock(SERVICO, () => ({ listarClientesAlterados, listarRepresentantesAlterados: vi.fn() }));
    const controller = await import(CONTROLLER);
    vi.useFakeTimers({ toFake: ['Date'] });

    vi.setSystemTime(PUXADA);
    const primeira = replyFalso();
    await controller.partnerClientesAlteradosHandler(requisicao({ desde: '2026-09-17T14:55:00Z' }), primeira.reply);
    expect(primeira.enviado.corpo).toMatchObject({ total: 0 });

    confirmadas.push({ updated_at: carimboDaEdicao }); // o banco confirma agora
    const { servidor_hora } = primeira.enviado.corpo as { servidor_hora: string };
    vi.setSystemTime(new Date('2026-09-17T15:05:00.000Z'));
    const segunda = replyFalso();
    await controller.partnerClientesAlteradosHandler(requisicao({ desde: servidor_hora }), segunda.reply);

    // Com a hora seca de antes da consulta (15:00:00), o desde da segunda
    // puxada passava do carimbo (14:59:59) e a edição não saía nunca.
    expect(segunda.enviado.corpo).toMatchObject({ total: 1 });
  });
});

// ─── O contrato publicado (docs/API-PARCEIRO.md e api-parceiro.html) ─────────

describe('o contrato publicado diz o que o código faz (revisão de 17/09/2026)', () => {
  const ler = (arquivo: string) => readFileSync(path.resolve(__dirname, '..', arquivo), 'utf8');
  const DOCS = ['docs/API-PARCEIRO.md', 'apps/web/public/api-parceiro.html'];
  /** A linha da tabela "Quem é dono" que começa com o dado. */
  const linhaDoDono = (texto: string, dado: string) =>
    texto.split(/\r?\n/).find((l) => l.includes(`${dado} (razão social, nome fantasia`)) ?? '';

  it('"Quem é dono": o cadastro do cliente NÃO é "quem editou por último" — a edição pendente do app prevalece', () => {
    // Uma troca feita depois no ERP não vence a edição do app pendente: o POST
    // /clientes tira o campo (partner.edicaoNoApp.ts). Ler só a coluna "Dono"
    // levava o integrador a esperar o contrário.
    for (const doc of DOCS) {
      const linha = linhaDoDono(ler(doc), 'Cadastro do cliente');
      expect(linha, doc).not.toBe('');
      expect(linha, doc).not.toMatch(/quem editou por último/);
      expect(linha, doc).toMatch(/edição do app pendente prevalece até o ERP devolver o mesmo valor/);
    }
  });

  it('servidor_hora não promete "nunca nenhuma" sem a folga; o motivo novo de ignorados e o casamento pelo código estão escritos', () => {
    for (const doc of DOCS) {
      const texto = ler(doc).replace(/\s+/g, ' ');
      expect(texto, doc).not.toMatch(/no máximo duas vezes — nunca nenhuma/);
      expect(texto, doc).toMatch(/menos 2 minutos de folga/);
      expect(texto, doc).toContain('cadastro alterado no app durante o envio — reenvie');
      expect(texto, doc).toMatch(/case pelo <?\/?(code>)?`?codigo/);
    }
  });

  it('a adoção pelo documento antigo que não dá para decidir e o campo ausente na adoção estão escritos (revisão de 17/09/2026)', async () => {
    const { service } = await carregar({ clientes: [], alteracoes: [] });
    for (const doc of [...DOCS, 'docs/BRIEF-ERP-FABIO.md']) {
      const texto = ler(doc).replace(/\s+/g, ' ');
      // O texto exato do motivo, o mesmo do código.
      expect(texto, doc).toContain(service.MOTIVO_DOCUMENTO_ANTIGO_AMBIGUO);
    }
    for (const doc of DOCS) {
      const texto = ler(doc).replace(/\s+/g, ' ');
      expect(texto, doc).toMatch(/Campo (\*\*|<b>)ausente(\*\*|<\/b>) do registro da adoção também/);
      expect(texto, doc).toMatch(/a (`razao_social`|<code>razao_social<\/code>) do registro decide/);
    }
  });
});
