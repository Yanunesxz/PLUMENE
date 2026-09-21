import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { criarSupabaseFake, type RespostaTabela } from './supabaseFake.js';

/**
 * A API que o ERP do parceiro alimenta com clientes e representantes.
 *
 * O que estes testes trancam:
 *  • upsert por CÓDIGO do ERP, casado pelo miolo: quem já existe é atualizado,
 *    quem não existe é criado — sem duplicar, nem dentro do mesmo lote;
 *  • campo AUSENTE não mexe e `null` explícito limpa (antes, um envio só com
 *    código e razão social apagava tabela, WhatsApp e endereço e desbloqueava);
 *  • nada é gravado quando nada mudou (`sem_mudanca`);
 *  • erro de LEITURA lança antes de gravar; erro de GRAVAÇÃO de um registro vira
 *    ignorado e o lote segue;
 *  • as colunas da 041 só são lidas e gravadas onde a migração rodou;
 *  • representante é só ATUALIZADO (nome, razão social, ativo); nunca nasce
 *    login por POST, o e-mail do Control não troca o login, e `users.updated_at`
 *    só é gravado com a coluna existindo (048);
 *  • (16/09/2026) o CNPJ é a chave: o casamento é primeiro pelo documento e
 *    depois pelo código; quem nasceu no app recebe o código que vier; o código
 *    de quem já tem nunca é reescrito; pendência financeira, títulos vencidos,
 *    motivo do bloqueio e data_update ficam guardados (049, com detectar); o
 *    e-mail do Control vai para users.erp_email (049), nunca para o login;
 *  • (16/09/2026) a outra mão: `listarClientesAlterados` e
 *    `listarRepresentantesAlterados` devolvem o que mudou no app desde `desde`,
 *    no MESMO formato que o POST aceita, com a chave (CNPJ) e `novo_no_control`.
 *
 * Dados fictícios de propósito — nada de cliente real aqui.
 */

const EMPRESA = 'empresa-1';

/** O dublê adianta uma resposta a cada consulta: esta ocupa o espaço entre duas. */
const ENCHIMENTO: RespostaTabela = { data: null, error: null };
const OK: RespostaTabela = { data: null, error: null };

/**
 * Respostas em sequência para a mesma tabela, com o enchimento entre elas —
 * cada `from()` aguardado consome duas posições da fila (a última fica grudada).
 */
function emSequencia(...respostas: RespostaTabela[]): RespostaTabela[] {
  return respostas.flatMap((r, i) => (i === respostas.length - 1 ? [r] : [r, ENCHIMENTO]));
}

interface Opcoes {
  /** A migração 041 rodou (customers.cep existe). Padrão: sim, como nos dois bancos. */
  cadastroReal?: boolean;
  /** users.updated_at existe (migração 048). Padrão: não. */
  usersUpdatedAt?: boolean;
  /** users.erp_email existe (migração 049). Padrão: não. */
  usersErpEmail?: boolean;
  /** As colunas da 049 em customers existem (pendencia_financeira etc.). Padrão: não. */
  com049?: boolean;
  /**
   * A 051 rodou (customer_changes existe). Padrão: sim, e sem nenhuma edição do
   * app pendente — o dublê não tem linha nessa tabela. Tudo aqui tem de sair
   * igual a antes da 051; as edições pendentes são testadas em
   * parceiro-edicao-no-app.test.ts.
   */
  com051?: boolean;
  /** Usa o detectarColuna de verdade, sondando pelo dublê. */
  sondaReal?: boolean;
}

async function carregar(respostas: Record<string, RespostaTabela | RespostaTabela[]>, opcoes: Opcoes = {}) {
  const fake = criarSupabaseFake(respostas);
  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
  const sondas: string[] = [];
  if (!opcoes.sondaReal) {
    const existe: Record<string, boolean> = {
      'customers.cep': opcoes.cadastroReal ?? true,
      'customers.pendencia_financeira': opcoes.com049 ?? false,
      'users.updated_at': opcoes.usersUpdatedAt ?? false,
      'users.erp_email': opcoes.usersErpEmail ?? false,
      'customer_changes.id': opcoes.com051 ?? true,
    };
    const responder = async (tabela: string, coluna?: string) => {
      const chave = `${tabela}.${coluna ?? ''}`;
      sondas.push(chave);
      return existe[chave] ?? true;
    };
    vi.doMock('../apps/api/src/lib/detectarColuna.js', () => ({
      detectar: responder,
      detectarOuFalhar: responder,
      detectarComCerteza: async (t: string, c?: string) => ((await responder(t, c)) ? 'existe' : 'nao_existe'),
      esquecerDeteccoes: () => undefined,
    }));
  }
  const service = await import('../apps/api/src/modules/partner/partner.sync.service.js');
  return { service, fake, sondas };
}

const valoresDe = (g: { valores: unknown } | undefined) => g?.valores as Record<string, unknown>;

// ─── Guarda de esquema: as colunas que EXISTEM, lidas das migrações ─────────

const PASTA_MIGRACOES = path.resolve(__dirname, '../apps/api/src/config/migrations');

/**
 * Colunas graváveis de uma tabela depois das migrações até `ate` (inclusive):
 * CREATE TABLE da 001 + ADD COLUMN − DROP COLUMN, sem as colunas geradas.
 * É o que teria pego o `users.updated_at` que derrubava a rota inteira.
 */
function colunasDasMigracoes(tabela: string, ate: number): Set<string> {
  const colunas = new Set<string>();
  const geradas = new Set<string>();
  const arquivos = readdirSync(PASTA_MIGRACOES)
    .filter((f) => /^\d{3}_.*\.sql$/.test(f) && Number(f.slice(0, 3)) <= ate)
    .sort();
  for (const arquivo of arquivos) {
    const sql = readFileSync(path.join(PASTA_MIGRACOES, arquivo), 'utf8').replace(/--.*$/gm, '');
    const criacao = new RegExp(`CREATE TABLE IF NOT EXISTS ${tabela}\\s*\\(([\\s\\S]*?)\\r?\\n\\);`, 'i').exec(sql);
    if (criacao?.[1]) {
      for (const linha of criacao[1].split(/\r?\n/)) {
        const m = /^\s*([a-z_][a-z0-9_]*)\s+[A-Z]/.exec(linha);
        if (m?.[1] && !/^(unique|primary|constraint|check|foreign)$/i.test(m[1])) colunas.add(m[1]);
      }
    }
    for (const alteracao of sql.matchAll(new RegExp(`ALTER TABLE\\s+${tabela}\\b([\\s\\S]*?);`, 'gi'))) {
      const corpo = alteracao[1] ?? '';
      for (const m of corpo.matchAll(/ADD COLUMN\s+(?:IF NOT EXISTS\s+)?([a-z_][a-z0-9_]*)/gi)) colunas.add(m[1]!.toLowerCase());
      for (const m of corpo.matchAll(/DROP COLUMN\s+(?:IF EXISTS\s+)?([a-z_][a-z0-9_]*)/gi)) colunas.delete(m[1]!.toLowerCase());
      for (const m of corpo.matchAll(/([a-z_][a-z0-9_]*)\s+\w+\s+GENERATED ALWAYS/gi)) geradas.add(m[1]!.toLowerCase());
    }
  }
  for (const g of geradas) colunas.delete(g);
  return colunas;
}

function esperarSoColunasReais(valores: Record<string, unknown>, tabela: string, ate: number) {
  const reais = colunasDasMigracoes(tabela, ate);
  const fora = Object.keys(valores).filter((k) => !reais.has(k));
  expect(fora, `colunas que ${tabela} não tem até a migração ${ate}`).toEqual([]);
}

describe('guarda de esquema (leitura das migrações)', () => {
  it('users não tem updated_at antes da 048, e customers só tem cep depois da 041', () => {
    const users47 = colunasDasMigracoes('users', 47);
    expect(users47.has('legal_name')).toBe(true);
    expect(users47.has('erp_rep_id')).toBe(true);
    expect(users47.has('active')).toBe(true);
    expect(users47.has('updated_at')).toBe(false);
    expect(users47.has('commission_rate')).toBe(false); // a 024 apagou
    expect(colunasDasMigracoes('users', 48).has('updated_at')).toBe(true);

    expect(colunasDasMigracoes('customers', 40).has('cep')).toBe(false);
    const customers47 = colunasDasMigracoes('customers', 47);
    expect(customers47.has('cep')).toBe(true);
    expect(customers47.has('address')).toBe(true);
    expect(customers47.has('cnpj_digits')).toBe(false); // gerada: não se grava
  });
});

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.doUnmock('../apps/api/src/config/supabase.js');
  vi.doUnmock('../apps/api/src/lib/detectarColuna.js');
});

// ─── Clientes ────────────────────────────────────────────────────────────────

/** Um cliente existente com tudo preenchido (fictício). */
const CLIENTE_CHEIO = {
  id: 'cli-1',
  erp_id: '02225',
  name: 'CLIENTE TESTE',
  trade_name: 'FANTASIA TESTE',
  cnpj: '00.000.000/0001-00',
  rep_erp_id: '00001',
  price_table_id: 't-16',
  blocked: true,
  credit_limit: 100,
  whatsapp: '00900000000',
  email: 'cliente@teste.invalid',
  address: 'Rua Teste, 1 - Bairro Teste - Cidade Teste/XX - CEP 00000-001',
  cep: '00000001',
  logradouro: 'Rua Teste',
  numero: '1',
  complemento: null,
  bairro: 'Bairro Teste',
  cidade: 'Cidade Teste',
  uf: 'XX',
  inscricao_estadual: 'ISENTO',
  observacoes: 'observação teste',
};

describe('clientes', () => {
  it('cria o novo, atualiza o que já existe e ignora o sem código', async () => {
    const { service, fake } = await carregar({
      price_tables: { data: [{ id: 't-uuid', erp_code: '01' }], error: null },
      customers: [
        { data: [{ id: 'existe-1', erp_id: 'C0002' }], error: null }, // select dos existentes
        { data: null, error: null }, // insert
        { data: null, error: null }, // update
      ],
    });

    const r = await service.receberClientes(EMPRESA, [
      { codigo: 'C0001', razao_social: 'LOJA NOVA', tabela_preco: '01', representante: 'R01' },
      { codigo: 'C0002', razao_social: 'LOJA ANTIGA' },
      { razao_social: 'SEM CODIGO' },
    ]);

    expect(r.recebidos).toBe(3);
    expect(r.criados).toBe(1);
    expect(r.atualizados).toBe(1);
    expect(r.sem_mudanca).toBe(0);
    expect(r.ignorados).toEqual([{ codigo: null, motivo: 'sem código do ERP' }]);

    const insert = fake.gravacoes.find((g) => g.tabela === 'customers' && g.operacao === 'insert');
    const linha = (insert!.valores as Record<string, unknown>[])[0]!;
    expect(linha['erp_id']).toBe('C0001');
    expect(linha['name']).toBe('LOJA NOVA');
    expect(linha['rep_erp_id']).toBe('R01');
    expect(linha['price_table_id']).toBe('t-uuid'); // resolveu a tabela pelo código
    expect(typeof linha['updated_at']).toBe('string');

    const update = fake.gravacoes.find((g) => g.tabela === 'customers' && g.operacao === 'update');
    expect(valoresDe(update)['name']).toBe('LOJA ANTIGA');
    // O id vai no filtro `.eq('id', ...)`, não no corpo do update.
    const filtroPorId = fake.filtrosDe('customers', 'eq').find((f) => f.args[0] === 'id');
    expect(filtroPorId?.args[1]).toBe('existe-1');
  });

  it('enxerga o cliente que esta DEPOIS da linha 1.000 — senao a carga o duplicaria', async () => {
    // O PostgREST corta em 1.000 linhas sem avisar, e a CS tem mais de 2.600
    // clientes. Aqui a primeira pagina vem cheia (1.000) e o alvo esta na segunda.
    const primeiraPagina = Array.from({ length: 1000 }, (_, i) => ({
      id: `c-${i}`,
      erp_id: `X${i}`,
      cnpj: null,
    }));
    const { service, fake } = await carregar({
      price_tables: { data: [{ id: 't-uuid', erp_code: '01' }], error: null },
      customers: [
        { data: primeiraPagina, error: null },
        // O dublê adianta a próxima resposta a cada consulta; esta linha é o
        // espaço dessa antecipação, para a 2ª página cair na 2ª ida ao banco.
        { data: [], error: null },
        { data: [{ id: 'la-no-fim', erp_id: 'C9999', cnpj: null }], error: null },
        { data: null, error: null },
      ],
    });

    const r = await service.receberClientes(EMPRESA, [
      { codigo: 'C9999', razao_social: 'LOJA DA PAGINA 2' },
    ]);

    expect(r.criados).toBe(0);
    expect(r.atualizados).toBe(1);
    const filtroPorId = fake.filtrosDe('customers', 'eq').find((f) => f.args[0] === 'id');
    expect(filtroPorId?.args[1]).toBe('la-no-fim');
    // Paginação estável: sem ordem, o `.range()` pode repetir ou pular linha.
    expect(fake.filtrosDe('customers', 'order').map((f) => f.args[0])).toContain('id');
  });

  it('ADOTA pelo CNPJ o cliente que existia sem código — a mesma loja não vira duas', async () => {
    // O cliente veio da carga de carteira (relatório Curva ABC, sem código do
    // Control). Quando o ERP manda o mesmo CNPJ COM código, tem de atualizar
    // aquele cadastro e gravar o código — não criar um segundo.
    const { service, fake } = await carregar({
      price_tables: { data: [], error: null },
      customers: [
        {
          data: [{ id: 'sem-codigo-1', erp_id: null, name: 'CLIENTE TESTE', cnpj: '00.000.000/0001-00' }],
          error: null,
        },
        { data: null, error: null }, // update
      ],
    });

    const r = await service.receberClientes(EMPRESA, [
      { codigo: '900', razao_social: 'CLIENTE TESTE', cnpj_cpf: '00000000000100' },
    ]);

    expect(r.criados).toBe(0);
    expect(r.atualizados).toBe(1);
    expect(r.avisos.some((a) => a.includes('casados pelo CNPJ'))).toBe(true);

    const update = fake.gravacoes.find((g) => g.tabela === 'customers' && g.operacao === 'update');
    // O cadastro adotado APRENDE o código, na grafia única — daqui em diante
    // casa pelo caminho normal.
    expect(valoresDe(update)['erp_id']).toBe('00900');
    // Documento com máscara diferente grava como veio (aparado).
    expect(valoresDe(update)['cnpj']).toBe('00000000000100');
    const filtroPorId = fake.filtrosDe('customers', 'eq').find((f) => f.args[0] === 'id');
    expect(filtroPorId?.args[1]).toBe('sem-codigo-1');
  });

  it('casa o código pelo miolo — "#2225", "2225" e "02225" são o mesmo cliente', async () => {
    const { service } = await carregar({
      price_tables: { data: [], error: null },
      customers: [
        { data: [{ id: 'existe-2', erp_id: '#2225', cnpj: null }], error: null },
        { data: null, error: null },
      ],
    });

    const r = await service.receberClientes(EMPRESA, [
      { codigo: '02225', razao_social: 'MESMA LOJA' },
    ]);

    expect(r.criados).toBe(0);
    expect(r.atualizados).toBe(1);
  });

  it('o erp_id de quem já tem código nunca é reescrito — só casa', async () => {
    const { service, fake } = await carregar({
      price_tables: { data: [], error: null },
      customers: [
        { data: [{ id: 'existe-3', erp_id: '02225', name: 'NOME ANTIGO', cnpj: null }], error: null },
        OK,
      ],
    });

    await service.receberClientes(EMPRESA, [{ codigo: '#2225', razao_social: 'NOME NOVO' }]);

    const patch = valoresDe(fake.ultimaGravacao('customers', 'update'));
    expect(patch['name']).toBe('NOME NOVO');
    expect('erp_id' in patch).toBe(false);
  });

  it('campo AUSENTE não apaga: só código e razão social mexem só no nome', async () => {
    const { service, fake } = await carregar({
      price_tables: { data: [{ id: 't-16', erp_code: '00016' }], error: null },
      customers: [{ data: [CLIENTE_CHEIO], error: null }, OK],
    });

    const r = await service.receberClientes(EMPRESA, [{ codigo: '2225', razao_social: 'CLIENTE TESTE RENOMEADO' }]);

    expect(r.atualizados).toBe(1);
    const patch = valoresDe(fake.ultimaGravacao('customers', 'update'));
    expect(Object.keys(patch).sort()).toEqual(['name', 'updated_at']);
    // Em especial: não desbloqueia, não tira a tabela, não apaga contato nem endereço.
    for (const coluna of ['trade_name', 'cnpj', 'rep_erp_id', 'price_table_id', 'whatsapp', 'email', 'address', 'blocked', 'credit_limit', 'cep']) {
      expect(coluna in patch, coluna).toBe(false);
    }
  });

  it('texto vazio ("") conta como ausente — o CHAR nulo do Firebird não apaga nada', async () => {
    const { service, fake } = await carregar({
      price_tables: { data: [{ id: 't-16', erp_code: '00016' }], error: null },
      customers: [{ data: [CLIENTE_CHEIO], error: null }, OK],
    });

    const r = await service.receberClientes(EMPRESA, [
      { codigo: '02225', razao_social: 'CLIENTE TESTE', whatsapp: '', email: '  ', tabela_preco: '', bloqueado: '', representante: '' },
    ]);

    expect(r.sem_mudanca).toBe(1);
    expect(fake.ultimaGravacao('customers', 'update')).toBeUndefined();
  });

  it('null explícito LIMPA: WhatsApp, tabela, endereço inteiro e bloqueio', async () => {
    const { service, fake } = await carregar({
      price_tables: { data: [{ id: 't-16', erp_code: '00016' }], error: null },
      customers: [{ data: [CLIENTE_CHEIO], error: null }, OK],
    });

    await service.receberClientes(EMPRESA, [
      {
        codigo: '02225',
        razao_social: 'CLIENTE TESTE',
        whatsapp: null,
        tabela_preco: null,
        endereco: null,
        bloqueado: null,
        limite_credito: null,
        representante: null,
      },
    ]);

    const patch = valoresDe(fake.ultimaGravacao('customers', 'update'));
    expect(patch).toMatchObject({
      whatsapp: null,
      price_table_id: null,
      address: null,
      cep: null,
      logradouro: null,
      numero: null,
      bairro: null,
      cidade: null,
      uf: null,
      blocked: false, // coluna NOT NULL: limpar é voltar ao padrão
      credit_limit: null,
      rep_erp_id: null,
    });
    // O que já era nulo não entra no patch à toa.
    expect('complemento' in patch).toBe(false);
    // Nem o que não veio.
    expect('trade_name' in patch).toBe(false);
    expect('email' in patch).toBe(false);
  });

  it('bloqueado ausente não desbloqueia; "N" desbloqueia', async () => {
    const { service, fake } = await carregar({
      price_tables: { data: [], error: null },
      customers: emSequencia(
        {
          data: [
            { id: 'b-1', erp_id: '00001', name: 'A', cnpj: null, blocked: true },
            { id: 'b-2', erp_id: '00002', name: 'B', cnpj: null, blocked: true },
          ],
          error: null,
        },
        OK,
      ),
    });

    const r = await service.receberClientes(EMPRESA, [
      { codigo: '1', razao_social: 'A' },
      { codigo: '2', razao_social: 'B', bloqueado: 'N' },
    ]);

    expect(r.sem_mudanca).toBe(1);
    expect(r.atualizados).toBe(1);
    const updates = fake.gravacoes.filter((g) => g.tabela === 'customers' && g.operacao === 'update');
    expect(updates).toHaveLength(1);
    expect(valoresDe(updates[0])['blocked']).toBe(false);
  });

  it('reenvio com os mesmos valores não grava nada e conta em sem_mudanca', async () => {
    const { service, fake } = await carregar({
      price_tables: { data: [{ id: 't-16', erp_code: '00016' }], error: null },
      // O banco devolve numeric como texto em alguns caminhos: "100.00" = 100.
      customers: [{ data: [{ ...CLIENTE_CHEIO, credit_limit: '100.00' }], error: null }, OK],
    });

    const r = await service.receberClientes(EMPRESA, [
      {
        codigo: '#02225',
        razao_social: 'CLIENTE TESTE',
        nome_fantasia: 'FANTASIA TESTE',
        cnpj_cpf: '00.000.000/0001-00',
        representante: '1',
        tabela_preco: '16',
        bloqueado: 'S',
        limite_credito: 100,
        whatsapp: '00900000000',
        email: 'cliente@teste.invalid',
        endereco: { cep: '00000-001', logradouro: 'Rua Teste', numero: '1', bairro: 'Bairro Teste', cidade: 'Cidade Teste', uf: 'xx' },
        inscricao_estadual: 'ISENTO',
        observacoes: 'observação teste',
      },
    ]);

    expect(r).toMatchObject({ recebidos: 1, criados: 0, atualizados: 0, sem_mudanca: 1, ignorados: [] });
    expect(fake.gravacoes).toHaveLength(0);
  });

  it('código repetido no lote: vale o primeiro, o segundo vira ignorado', async () => {
    const { service, fake } = await carregar({
      price_tables: { data: [], error: null },
      customers: [{ data: [], error: null }, OK],
    });

    const r = await service.receberClientes(EMPRESA, [
      { codigo: '#2225', razao_social: 'PRIMEIRO' },
      { codigo: '2225', razao_social: 'SEGUNDO' },
    ]);

    expect(r.criados).toBe(1);
    expect(r.ignorados).toEqual([{ codigo: '2225', motivo: 'código repetido no lote' }]);
    const inserts = fake.gravacoes.filter((g) => g.tabela === 'customers' && g.operacao === 'insert');
    expect(inserts).toHaveLength(1);
    const linhas = inserts[0]!.valores as Record<string, unknown>[];
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ erp_id: '02225', name: 'PRIMEIRO' });
  });

  it('erro ao ler price_tables LANÇA antes de gravar qualquer coisa', async () => {
    const { service, fake } = await carregar({
      price_tables: { data: null, error: { message: 'timeout' } },
      customers: [{ data: [], error: null }, OK],
    });

    await expect(
      service.receberClientes(EMPRESA, [{ codigo: '1', razao_social: 'CLIENTE TESTE' }]),
    ).rejects.toThrow(/tabelas de preço/);
    expect(fake.gravacoes).toHaveLength(0);
  });

  it('erro na 2ª página de customers LANÇA — tratar como base vazia duplicaria todo mundo', async () => {
    const primeiraPagina = Array.from({ length: 1000 }, (_, i) => ({ id: `c-${i}`, erp_id: `X${i}`, cnpj: null }));
    const { service, fake } = await carregar({
      price_tables: { data: [], error: null },
      customers: emSequencia(
        { data: primeiraPagina, error: null },
        { data: null, error: { message: 'soluço da rede' } },
      ),
    });

    await expect(
      service.receberClientes(EMPRESA, [{ codigo: 'X5', razao_social: 'CLIENTE TESTE' }, { codigo: 'NOVO', razao_social: 'OUTRO' }]),
    ).rejects.toThrow();
    expect(fake.gravacoes).toHaveLength(0);
  });

  it('falha ao gravar UM cliente vira ignorado e os outros seguem (sem 500)', async () => {
    const existentes = [1, 2, 3].map((n) => ({ id: `u-${n}`, erp_id: `0000${n}`, name: 'ANTIGO', cnpj: null }));
    const { service, fake } = await carregar({
      price_tables: { data: [], error: null },
      customers: emSequencia(
        { data: existentes, error: null },
        OK,
        { data: null, error: { message: 'violates check constraint' } },
        OK,
      ),
    });

    const r = await service.receberClientes(EMPRESA, [
      { codigo: '1', razao_social: 'NOVO 1' },
      { codigo: '2', razao_social: 'NOVO 2' },
      { codigo: '3', razao_social: 'NOVO 3' },
    ]);

    expect(r.atualizados).toBe(2);
    expect(r.ignorados).toEqual([{ codigo: '2', motivo: 'falha ao gravar: violates check constraint' }]);
    expect(fake.gravacoes.filter((g) => g.operacao === 'update')).toHaveLength(3);
  });

  it('insert em lote que falha é repetido um a um e só o ruim fica de fora', async () => {
    const { service, fake } = await carregar({
      price_tables: { data: [], error: null },
      customers: emSequencia(
        { data: [], error: null }, // existentes
        { data: null, error: { message: 'duplicate key' } }, // lote
        OK, // 1
        { data: null, error: { message: 'duplicate key' } }, // 2
        OK, // 3
      ),
    });

    const r = await service.receberClientes(EMPRESA, [
      { codigo: '1', razao_social: 'A' },
      { codigo: '2', razao_social: 'B' },
      { codigo: '3', razao_social: 'C' },
    ]);

    expect(r.criados).toBe(2);
    expect(r.ignorados).toEqual([{ codigo: '2', motivo: 'falha ao gravar: duplicate key' }]);
    expect(fake.gravacoes.filter((g) => g.operacao === 'insert')).toHaveLength(4);
  });

  it('o update filtra por company_id, além do id', async () => {
    const { service, fake } = await carregar({
      price_tables: { data: [], error: null },
      customers: [{ data: [{ id: 'cli-9', erp_id: '00009', name: 'ANTIGO', cnpj: null }], error: null }, OK],
    });

    await service.receberClientes(EMPRESA, [{ codigo: '9', razao_social: 'NOVO' }]);

    const filtros = fake.filtrosDe('customers', 'eq').map((f) => f.args);
    // Um no select dos existentes e um no update.
    expect(filtros.filter((a) => a[0] === 'company_id' && a[1] === EMPRESA)).toHaveLength(2);
    expect(filtros).toContainEqual(['id', 'cli-9']);
  });

  it('registro que não é objeto vai para ignorados e o resto grava', async () => {
    const { service } = await carregar({
      price_tables: { data: [], error: null },
      customers: [{ data: [], error: null }, OK],
    });

    const r = await service.receberClientes(EMPRESA, [null, 'lixo', { codigo: '1', razao_social: 'CLIENTE TESTE' }]);

    expect(r.recebidos).toBe(3);
    expect(r.criados).toBe(1);
    expect(r.ignorados).toEqual([
      { codigo: null, motivo: 'registro inválido' },
      { codigo: null, motivo: 'registro inválido' },
    ]);
  });

  it('tabela_preco casa pelo miolo ("16" = "00016"); desconhecida não mexe e avisa', async () => {
    const { service, fake } = await carregar({
      price_tables: { data: [{ id: 't-16', erp_code: '00016' }], error: null },
      customers: emSequencia(
        {
          data: [
            { id: 'a', erp_id: '00001', name: 'A', cnpj: null, price_table_id: null },
            { id: 'b', erp_id: '00002', name: 'B', cnpj: null, price_table_id: 't-antiga' },
          ],
          error: null,
        },
        OK,
      ),
    });

    const r = await service.receberClientes(EMPRESA, [
      { codigo: '1', razao_social: 'A', tabela_preco: '16' },
      { codigo: '2', razao_social: 'B', tabela_preco: '99' },
    ]);

    const updates = fake.gravacoes.filter((g) => g.tabela === 'customers' && g.operacao === 'update');
    expect(updates).toHaveLength(1);
    expect(valoresDe(updates[0])['price_table_id']).toBe('t-16');
    expect(r.sem_mudanca).toBe(1); // o "B" continua com a tabela que tinha
    expect(r.avisos.some((a) => a.includes('99') && a.includes('não foi mexida'))).toBe(true);
  });

  it('avisa quando a tabela de preço do cliente não existe aqui', async () => {
    const { service } = await carregar({
      price_tables: { data: [{ id: 't1', erp_code: '01' }], error: null },
      customers: [{ data: [], error: null }, { data: null, error: null }],
    });

    const r = await service.receberClientes(EMPRESA, [
      { codigo: 'C1', razao_social: 'LOJA', tabela_preco: '99' },
    ]);

    expect(r.avisos.some((a) => a.includes('99'))).toBe(true);
  });

  it('representante grava na grafia única e avisa quando o login tem outra', async () => {
    const { service, fake } = await carregar({
      price_tables: { data: [], error: null },
      customers: [{ data: [], error: null }, OK],
      users: { data: [{ erp_rep_id: '779' }], error: null },
    });

    const r = await service.receberClientes(EMPRESA, [
      { codigo: '1', razao_social: 'A', representante: '#00779' },
      { codigo: '2', razao_social: 'B', representante: '123' },
    ]);

    const linhas = fake.ultimaGravacao('customers', 'insert')!.valores as Record<string, unknown>[];
    expect(linhas.map((l) => l['rep_erp_id'])).toEqual(['00779', '00123']);
    expect(r.avisos.some((a) => a.includes('grafia diferente') && a.includes('00779'))).toBe(true);
    expect(r.avisos.some((a) => a.includes('sem login') && a.includes('00123'))).toBe(true);
    // O filtro dos logins é da empresa e do papel rep.
    expect(fake.filtrosDe('users', 'eq').map((f) => f.args)).toEqual([
      ['company_id', EMPRESA],
      ['role', 'rep'],
    ]);
  });

  it('limite_credito aceita texto numérico; negativo não mexe e avisa', async () => {
    const { service, fake } = await carregar({
      price_tables: { data: [], error: null },
      customers: [{ data: [], error: null }, OK],
    });

    const r = await service.receberClientes(EMPRESA, [
      { codigo: '1', razao_social: 'A', limite_credito: '1.500,50' },
      { codigo: '2', razao_social: 'B', limite_credito: -10 },
    ]);

    const linhas = fake.ultimaGravacao('customers', 'insert')!.valores as Record<string, unknown>[];
    expect(linhas.map((l) => l['credit_limit'])).toEqual([1500.5, null]);
    expect(r.avisos.some((a) => a.includes('limite_credito') && a.includes('2'))).toBe(true);
  });

  it('monta o endereço em pedaços numa linha só', async () => {
    const { service, fake } = await carregar({
      price_tables: { data: [], error: null },
      customers: [
        { data: [], error: null },
        { data: null, error: null },
      ],
    });

    await service.receberClientes(EMPRESA, [
      {
        codigo: 'C1',
        razao_social: 'LOJA',
        endereco: {
          logradouro: 'Rua Teste',
          numero: '123',
          complemento: 'Sala 2',
          bairro: 'Bairro Teste',
          cidade: 'Cidade Teste',
          uf: 'XX',
          cep: '00000-001',
        },
      },
    ]);

    const insert = fake.gravacoes.find((g) => g.operacao === 'insert');
    const linha = (insert!.valores as Record<string, unknown>[])[0]!;
    expect(linha['address']).toBe('Rua Teste, 123 Sala 2 - Bairro Teste - Cidade Teste/XX - CEP 00000-001');
  });

  it('COM a 041: grava os pedaços, IE e observações, e remonta a linha com o que já estava', async () => {
    const { service, fake, sondas } = await carregar(
      {
        price_tables: { data: [], error: null },
        customers: [{ data: [CLIENTE_CHEIO], error: null }, OK],
      },
      { cadastroReal: true },
    );

    await service.receberClientes(EMPRESA, [
      {
        codigo: '2225',
        razao_social: 'CLIENTE TESTE',
        // Só a rua e o CEP mudaram; bairro, cidade e UF continuam os guardados.
        endereco: { logradouro: 'Avenida Teste', numero: '2', cep: '00000-002' },
        inscricao_estadual: '000.000.000.000',
        observacoes: null,
      },
    ]);

    expect(sondas).toContain('customers.cep');
    const select = fake.filtrosDe('customers', 'select')[0]!.args[0] as string;
    expect(select).toContain('inscricao_estadual');

    const patch = valoresDe(fake.ultimaGravacao('customers', 'update'));
    expect(patch).toMatchObject({
      logradouro: 'Avenida Teste',
      numero: '2',
      cep: '00000002', // só dígitos, como o cadastro do app
      address: 'Avenida Teste, 2 - Bairro Teste - Cidade Teste/XX - CEP 00000-002',
      inscricao_estadual: '000.000.000.000',
      observacoes: null,
    });
    expect('bairro' in patch).toBe(false);
    esperarSoColunasReais(patch, 'customers', 47);
  });

  it('SEM a 041: não lê nem grava as colunas novas — só a linha do endereço, com aviso', async () => {
    const { service, fake } = await carregar(
      {
        price_tables: { data: [], error: null },
        customers: [{ data: [{ id: 'x', erp_id: '00001', name: 'A', cnpj: null, address: null }], error: null }, OK],
      },
      { cadastroReal: false },
    );

    const r = await service.receberClientes(EMPRESA, [
      {
        codigo: '1',
        razao_social: 'A',
        endereco: { logradouro: 'Rua Teste', numero: '1', cidade: 'Cidade Teste', uf: 'XX' },
        inscricao_estadual: 'ISENTO',
        observacoes: 'observação teste',
      },
    ]);

    const select = fake.filtrosDe('customers', 'select')[0]!.args[0] as string;
    expect(select).not.toContain('cep');
    const patch = valoresDe(fake.ultimaGravacao('customers', 'update'));
    expect(patch['address']).toBe('Rua Teste, 1 - Cidade Teste/XX');
    esperarSoColunasReais(patch, 'customers', 40);
    expect(r.avisos.some((a) => a.includes('migração 041'))).toBe(true);
  });

  it('SEM a 041: o insert de cliente novo também só leva colunas que existem', async () => {
    const { service, fake } = await carregar(
      {
        price_tables: { data: [], error: null },
        customers: [{ data: [], error: null }, OK],
      },
      { cadastroReal: false },
    );

    await service.receberClientes(EMPRESA, [
      { codigo: '1', razao_social: 'A', endereco: { cep: '00000-001' }, inscricao_estadual: 'ISENTO' },
    ]);

    const linha = (fake.ultimaGravacao('customers', 'insert')!.valores as Record<string, unknown>[])[0]!;
    esperarSoColunasReais(linha, 'customers', 40);
  });

  it('COM a 041: o insert de cliente novo leva as mesmas chaves em todas as linhas', async () => {
    const { service, fake } = await carregar({
      price_tables: { data: [], error: null },
      customers: [{ data: [], error: null }, OK],
    });

    await service.receberClientes(EMPRESA, [
      { codigo: '1', razao_social: 'A', endereco: { cep: '00000-001' } },
      { codigo: '2', razao_social: 'B', whatsapp: '00900000000' },
    ]);

    const linhas = fake.ultimaGravacao('customers', 'insert')!.valores as Record<string, unknown>[];
    expect(Object.keys(linhas[0]!).sort()).toEqual(Object.keys(linhas[1]!).sort());
    expect(linhas[1]!['blocked']).toBe(false); // nunca NULL numa coluna NOT NULL
    esperarSoColunasReais(linhas[0]!, 'customers', 47);
  });

  it('bloqueado aceita "S", true e 1', async () => {
    const { service, fake } = await carregar({
      price_tables: { data: [], error: null },
      customers: [{ data: [], error: null }, { data: null, error: null }],
    });

    await service.receberClientes(EMPRESA, [
      { codigo: 'A', razao_social: 'A', bloqueado: 'S' },
      { codigo: 'B', razao_social: 'B', bloqueado: true },
      { codigo: 'C', razao_social: 'C', bloqueado: 'N' },
      { codigo: 'D', razao_social: 'D', bloqueado: '1' },
    ]);

    const insert = fake.gravacoes.find((g) => g.operacao === 'insert');
    const linhas = insert!.valores as Record<string, unknown>[];
    expect(linhas.map((l) => l['blocked'])).toEqual([true, true, false, true]);
  });
});

// ─── O CNPJ é a chave (decisão de 16/09/2026) ────────────────────────────────

describe('clientes — o CNPJ é a chave entre os sistemas', () => {
  it('casa PRIMEIRO pelo CNPJ: o mesmo código no cadastro achado pelo CNPJ é atualizado, mesmo com outro código no app para outro CNPJ', async () => {
    const { service, fake } = await carregar({
      price_tables: { data: [], error: null },
      customers: [
        {
          data: [
            { id: 'pelo-cnpj', erp_id: '00111', name: 'ANTIGO', cnpj: '00.000.000/0001-00' },
            { id: 'outro', erp_id: '00222', name: 'OUTRA LOJA', cnpj: '00.000.000/0002-00' },
          ],
          error: null,
        },
        OK,
      ],
    });

    const r = await service.receberClientes(EMPRESA, [
      { codigo: '#111', razao_social: 'LOJA RENOMEADA', cnpj_cpf: '00000000000100' },
    ]);

    expect(r).toMatchObject({ criados: 0, atualizados: 1, ignorados: [] });
    expect(fake.filtrosDe('customers', 'eq').find((f) => f.args[0] === 'id')?.args[1]).toBe('pelo-cnpj');
    const patch = valoresDe(fake.ultimaGravacao('customers', 'update'));
    expect(patch['name']).toBe('LOJA RENOMEADA');
    expect('erp_id' in patch).toBe(false);
  });

  it('CNPJ que já é de um cliente com OUTRO código: nada é gravado — nem nome, nem carteira, nem tabela', async () => {
    // Dois códigos do mesmo CNPJ no Control (cadastro duplicado lá): aplicar o
    // registro trocaria o representante e a tabela do cliente do app a cada
    // lote, conforme o registro que chegasse.
    const { service, fake } = await carregar({
      price_tables: { data: [{ id: 't-9', erp_code: '00009' }], error: null },
      customers: [
        {
          data: [
            { id: 'da-carteira', erp_id: '00111', name: 'LOJA A', cnpj: '00.000.000/0001-00', rep_erp_id: '00779', price_table_id: 't-1' },
          ],
          error: null,
        },
        OK,
      ],
    });

    const r = await service.receberClientes(EMPRESA, [
      { codigo: '222', razao_social: 'LOJA A FILIAL', cnpj_cpf: '00000000000100', representante: '00888', tabela_preco: '9' },
    ]);

    expect(r).toMatchObject({ criados: 0, atualizados: 0, sem_mudanca: 0 });
    expect(r.ignorados).toEqual([{ codigo: '222', motivo: 'CNPJ já é do cliente de código 00111 no app' }]);
    expect(fake.gravacoes).toEqual([]);
  });

  it('cliente que NASCEU no app (sem código) recebe o código que vier, casado pelo CNPJ', async () => {
    const { service, fake } = await carregar({
      price_tables: { data: [], error: null },
      customers: [
        { data: [{ id: 'nascido-no-app', erp_id: null, name: 'LOJA NOVA', cnpj: '00000000000191' }], error: null },
        OK,
      ],
    });

    const r = await service.receberClientes(EMPRESA, [
      { codigo: '#3001', razao_social: 'LOJA NOVA', cnpj_cpf: '00.000.000/0001-91' },
    ]);

    expect(r).toMatchObject({ criados: 0, atualizados: 1, sem_mudanca: 0 });
    const patch = valoresDe(fake.ultimaGravacao('customers', 'update'));
    expect(patch['erp_id']).toBe('03001');
    // O documento continua o mesmo cadastro: nada foi criado.
    expect(fake.gravacoes.some((g) => g.operacao === 'insert')).toBe(false);
    expect(r.avisos.some((a) => a.includes('casados pelo CNPJ'))).toBe(true);
  });

  it('sem CNPJ no registro, casa pelo código como sempre', async () => {
    const { service, fake } = await carregar({
      price_tables: { data: [], error: null },
      customers: [{ data: [{ id: 'c-1', erp_id: '00001', name: 'A', cnpj: '00000000000191' }], error: null }, OK],
    });

    const r = await service.receberClientes(EMPRESA, [{ codigo: '1', razao_social: 'A NOVO' }]);

    expect(r.atualizados).toBe(1);
    expect(fake.filtrosDe('customers', 'eq').find((f) => f.args[0] === 'id')?.args[1]).toBe('c-1');
  });

  it('CNPJ com dois cadastros: fica com o que tem este código; sem nenhum com código, o registro é recusado', async () => {
    const { service, fake } = await carregar({
      price_tables: { data: [], error: null },
      customers: emSequencia(
        {
          data: [
            { id: 'dup-a', erp_id: '00001', name: 'A', cnpj: '00000000000191' },
            { id: 'dup-b', erp_id: '00002', name: 'B', cnpj: '00000000000191' },
          ],
          error: null,
        },
        OK,
      ),
    });

    const r = await service.receberClientes(EMPRESA, [
      { codigo: '2', razao_social: 'B NOVO', cnpj_cpf: '00000000000191' },
      { codigo: '3', razao_social: 'C', cnpj_cpf: '00.000.000/0001-91' },
    ]);

    // O segundo registro tem o mesmo CNPJ no lote: recusado antes de olhar o banco.
    expect(r.ignorados).toEqual([{ codigo: '3', motivo: 'CNPJ repetido no lote' }]);
    expect(r.atualizados).toBe(1);
    expect(fake.filtrosDe('customers', 'eq').find((f) => f.args[0] === 'id')?.args[1]).toBe('dup-b');
    expect(r.avisos.some((a) => a.includes('CNPJ com mais de um cadastro'))).toBe(true);

    vi.resetModules();
    const outro = await carregar({
      price_tables: { data: [], error: null },
      customers: {
        data: [
          { id: 'dup-a', erp_id: '00001', name: 'A', cnpj: '00000000000191' },
          { id: 'dup-b', erp_id: '00002', name: 'B', cnpj: '00000000000191' },
        ],
        error: null,
      },
    });
    const r2 = await outro.service.receberClientes(EMPRESA, [
      { codigo: '9', razao_social: 'NOVO', cnpj_cpf: '00000000000191' },
    ]);
    expect(r2.ignorados).toEqual([{ codigo: '9', motivo: 'CNPJ com mais de um cadastro no app' }]);
    expect(outro.fake.gravacoes).toEqual([]);
  });

  it('dois registros do lote para o mesmo cadastro (um pelo CNPJ com outro código, outro pelo código): só o do código grava', async () => {
    const { service, fake } = await carregar({
      price_tables: { data: [], error: null },
      customers: [{ data: [{ id: 'c-1', erp_id: '00001', name: 'A', cnpj: '00000000000191' }], error: null }, OK],
    });

    const r = await service.receberClientes(EMPRESA, [
      { codigo: '500', razao_social: 'PELO CNPJ', cnpj_cpf: '00000000000191' },
      { codigo: '1', razao_social: 'PELO CODIGO' },
    ]);

    expect(r.ignorados).toEqual([{ codigo: '500', motivo: 'CNPJ já é do cliente de código 00001 no app' }]);
    const updates = fake.gravacoes.filter((g) => g.operacao === 'update');
    expect(updates).toHaveLength(1);
    expect(valoresDe(updates[0])['name']).toBe('PELO CODIGO');
  });

  it('motivo_bloqueio vai para block_reason (001); ausente não mexe, null limpa', async () => {
    const { service, fake } = await carregar({
      price_tables: { data: [], error: null },
      customers: emSequencia(
        {
          data: [
            { id: 'a', erp_id: '00001', name: 'A', cnpj: null, block_reason: null },
            { id: 'b', erp_id: '00002', name: 'B', cnpj: null, block_reason: 'motivo antigo' },
            { id: 'c', erp_id: '00003', name: 'C', cnpj: null, block_reason: 'motivo guardado' },
          ],
          error: null,
        },
        OK,
      ),
    });

    await service.receberClientes(EMPRESA, [
      { codigo: '1', razao_social: 'A', bloqueado: 'S', motivo_bloqueio: 'títulos vencidos' },
      { codigo: '2', razao_social: 'B', motivo_bloqueio: null },
      { codigo: '3', razao_social: 'C NOVO' },
    ]);

    const updates = fake.gravacoes.filter((g) => g.operacao === 'update').map(valoresDe);
    expect(updates[0]).toMatchObject({ blocked: true, block_reason: 'títulos vencidos' });
    expect(updates[1]).toMatchObject({ block_reason: null });
    expect('block_reason' in updates[2]!).toBe(false);
    // A leitura compara block_reason: sem ele no select, todo envio regravaria.
    expect(fake.filtrosDe('customers', 'select')[0]!.args[0]).toContain('block_reason');
  });

  it('COM a 049: pendência financeira (com o momento) e títulos vencidos no cadastro; o carimbo do Control é o momento da gravação, nunca o data_update', async () => {
    const { service, fake } = await carregar(
      {
        price_tables: { data: [], error: null },
        customers: emSequencia(
          {
            data: [
              { id: 'a', erp_id: '00001', name: 'A', cnpj: null, pendencia_financeira: null, titulos_vencidos: 0 },
              { id: 'b', erp_id: '00002', name: 'B', cnpj: null, pendencia_financeira: '150.00', titulos_vencidos: 2 },
            ],
            error: null,
          },
          OK,
        ),
      },
      { com049: true },
    );

    const r = await service.receberClientes(EMPRESA, [
      { codigo: '1', razao_social: 'A', pendencia_financeira: '1.234,56', titulos_vencidos: '3', data_update: '2026-09-16T10:00:00-03:00' },
      { codigo: '2', razao_social: 'B', pendencia_financeira: 150, titulos_vencidos: 2 },
      { codigo: '3', razao_social: 'NOVO', pendencia_financeira: 10 },
    ]);

    expect(r).toMatchObject({ criados: 1, atualizados: 1, sem_mudanca: 1, ignorados: [] });
    expect(fake.filtrosDe('customers', 'select')[0]!.args[0]).toContain('pendencia_financeira');

    const patch = valoresDe(fake.ultimaGravacao('customers', 'update'));
    expect(patch).toMatchObject({ pendencia_financeira: 1234.56, titulos_vencidos: 3 });
    // O DATA_UPDATE do Control é passado: gravado como carimbo, o cliente
    // voltaria no GET ?desde= logo depois (a trigger põe updated_at = agora).
    expect(patch['erp_updated_at']).not.toBe('2026-09-16T10:00:00-03:00');
    expect(patch['erp_updated_at']).toBe(patch['updated_at']);
    expect(typeof patch['pendencia_financeira_em']).toBe('string');
    esperarSoColunasReais(patch, 'customers', 49);

    const linha = (fake.ultimaGravacao('customers', 'insert')!.valores as Record<string, unknown>[])[0]!;
    expect(linha['pendencia_financeira']).toBe(10);
    expect(typeof linha['pendencia_financeira_em']).toBe('string');
    expect(linha['titulos_vencidos']).toBeNull();
    // Sem data_update, o carimbo do Control é o momento do envio.
    expect(linha['erp_updated_at']).toBe(linha['updated_at']);
    esperarSoColunasReais(linha, 'customers', 49);
  });

  it('COM a 049: um update qualquer carimba erp_updated_at; reenvio igual (mesmo instante em outro fuso) é sem_mudanca', async () => {
    const { service, fake } = await carregar(
      {
        price_tables: { data: [], error: null },
        customers: emSequencia(
          {
            data: [
              { id: 'a', erp_id: '00001', name: 'ANTIGO', cnpj: null, erp_updated_at: '2026-09-16T13:00:00+00:00' },
              { id: 'b', erp_id: '00002', name: 'B', cnpj: null, erp_updated_at: '2026-09-16T13:00:00+00:00' },
            ],
            error: null,
          },
          OK,
        ),
      },
      { com049: true },
    );

    const r = await service.receberClientes(EMPRESA, [
      { codigo: '1', razao_social: 'NOVO NOME' },
      { codigo: '2', razao_social: 'B', data_update: '2026-09-16T10:00:00-03:00' },
    ]);

    expect(r).toMatchObject({ atualizados: 1, sem_mudanca: 1 });
    const patch = valoresDe(fake.ultimaGravacao('customers', 'update'));
    expect(patch['erp_updated_at']).toBe(patch['updated_at']);
  });

  it('COM a 049: data_update sozinho NÃO é mudança — o Control recarimbando ao gravar o que puxou não vira pingue-pongue', async () => {
    const { service, fake } = await carregar(
      {
        price_tables: { data: [], error: null },
        customers: emSequencia(
          {
            data: [
              {
                id: 'a',
                erp_id: '00001',
                name: 'LOJA A',
                cnpj: null,
                erp_updated_at: '2026-09-16T12:00:00+00:00',
                updated_at: '2026-09-16T12:00:00.250+00:00',
              },
            ],
            error: null,
          },
          OK,
        ),
      },
      { com049: true },
    );

    const r = await service.receberClientes(EMPRESA, [
      { codigo: '1', razao_social: 'LOJA A', data_update: '2026-09-16T15:30:00-03:00' },
    ]);

    expect(r).toMatchObject({ atualizados: 0, sem_mudanca: 1, ignorados: [] });
    expect(fake.gravacoes).toHaveLength(0);
  });

  it('COM a 049: o app mexeu depois do último carimbo e o Control ainda não puxou — grava o que veio, mas NÃO carimba', async () => {
    // Carimbar aqui esconderia do GET ?desde= a mudança que o app fez e o
    // Control nunca viu. Em dia (updated_at dentro da folga), carimba.
    const { service, fake } = await carregar(
      {
        price_tables: { data: [], error: null },
        customers: emSequencia(
          {
            data: [
              {
                id: 'app-pendente',
                erp_id: '00001',
                name: 'LOJA A',
                cnpj: null,
                whatsapp: null,
                erp_updated_at: '2026-09-16T12:00:00+00:00',
                updated_at: '2026-09-16T12:10:00+00:00',
              },
              {
                id: 'em-dia',
                erp_id: '00002',
                name: 'LOJA B',
                cnpj: null,
                whatsapp: null,
                erp_updated_at: '2026-09-16T12:00:00+00:00',
                // A trigger da 013: um pouco depois do carimbo, dentro da folga.
                updated_at: '2026-09-16T12:00:01.500+00:00',
              },
            ],
            error: null,
          },
          OK,
        ),
      },
      { com049: true },
    );

    const r = await service.receberClientes(EMPRESA, [
      { codigo: '1', razao_social: 'LOJA A', whatsapp: '00900000001' },
      { codigo: '2', razao_social: 'LOJA B', whatsapp: '00900000002' },
    ]);

    expect(r).toMatchObject({ atualizados: 2 });
    const updates = fake.gravacoes.filter((g) => g.tabela === 'customers' && g.operacao === 'update').map(valoresDe);
    expect(updates[0]).toMatchObject({ whatsapp: '00900000001' });
    expect('erp_updated_at' in updates[0]!).toBe(false);
    expect(typeof updates[0]!['updated_at']).toBe('string');
    expect(updates[1]).toMatchObject({ whatsapp: '00900000002' });
    expect(updates[1]!['erp_updated_at']).toBe(updates[1]!['updated_at']);
  });

  it('valores ruins da 049 não mexem e avisam; SEM a 049 os campos ficam de fora com aviso', async () => {
    const { service, fake } = await carregar(
      {
        price_tables: { data: [], error: null },
        customers: [{ data: [], error: null }, OK],
      },
      { com049: true },
    );

    const r = await service.receberClientes(EMPRESA, [
      { codigo: '1', razao_social: 'A', pendencia_financeira: -5, titulos_vencidos: 1.5, data_update: '2026-09-16T10:00:00' },
    ]);

    const linha = (fake.ultimaGravacao('customers', 'insert')!.valores as Record<string, unknown>[])[0]!;
    expect(linha['pendencia_financeira']).toBeNull();
    expect(linha['titulos_vencidos']).toBeNull();
    expect(linha['erp_updated_at']).toBe(linha['updated_at']);
    expect(r.avisos.some((a) => a.includes('pendencia_financeira'))).toBe(true);
    expect(r.avisos.some((a) => a.includes('titulos_vencidos'))).toBe(true);
    expect(r.avisos.some((a) => a.includes('data_update'))).toBe(true);

    vi.resetModules();
    const sem = await carregar({
      price_tables: { data: [], error: null },
      customers: [{ data: [], error: null }, OK],
    });
    const r2 = await sem.service.receberClientes(EMPRESA, [
      { codigo: '1', razao_social: 'A', pendencia_financeira: 10, titulos_vencidos: 1, data_update: '2026-09-16T10:00:00Z' },
    ]);
    const semLinha = (sem.fake.ultimaGravacao('customers', 'insert')!.valores as Record<string, unknown>[])[0]!;
    for (const coluna of ['pendencia_financeira', 'pendencia_financeira_em', 'titulos_vencidos', 'erp_updated_at']) {
      expect(coluna in semLinha, coluna).toBe(false);
    }
    expect(sem.fake.filtrosDe('customers', 'select')[0]!.args[0]).not.toContain('pendencia_financeira');
    expect(r2.avisos.some((a) => a.includes('migração 049'))).toBe(true);
  });
});

// ─── Representantes ──────────────────────────────────────────────────────────

describe('representantes', () => {
  it('atualiza o que existe e lista o novo, sem criar login', async () => {
    const { service, fake } = await carregar({
      users: [
        { data: [{ id: 'u1', erp_rep_id: 'R01', name: 'NOME ANTIGO', email: 'rep@teste.invalid', active: false }], error: null }, // select
        { data: null, error: null }, // update do R01
      ],
    });

    const r = await service.receberRepresentantes(EMPRESA, [
      { codigo: 'R01', nome: 'REP TESTE', email: 'REP@TESTE.INVALID', ativo: 'S' },
      { codigo: 'R99', nome: 'REP NOVO' },
      { nome: 'SEM CODIGO' },
    ]);

    expect(r.atualizados).toBe(1);
    expect(r.criados).toBe(0);
    expect(r.sem_mudanca).toBe(0);
    expect(r.novos).toEqual([{ codigo: 'R99', nome: 'REP NOVO' }]);
    expect(r.ignorados).toEqual([{ codigo: null, motivo: 'sem código do ERP' }]);

    const update = fake.gravacoes.find((g) => g.tabela === 'users' && g.operacao === 'update');
    const campos = valoresDe(update);
    expect(campos['name']).toBe('REP TESTE');
    expect(campos['active']).toBe(true);
    // O mesmo e-mail em outra caixa não é "diferente": sem aviso.
    expect(r.avisos.some((a) => a.includes('e-mail do Control'))).toBe(false);
    // Nunca mexe em senha nem no login.
    expect(campos['password_hash']).toBeUndefined();
    expect('email' in campos).toBe(false);
  });

  it('o e-mail do Control NÃO troca o login: fica fora do update e volta como aviso', async () => {
    const { service, fake } = await carregar({
      users: [{ data: [{ id: 'u1', erp_rep_id: '00779', name: 'REP TESTE', email: 'login@teste.invalid' }], error: null }, OK],
    });

    const r = await service.receberRepresentantes(EMPRESA, [
      { codigo: '779', nome: 'REP TESTE', email: 'outro@teste.invalid' },
    ]);

    expect(fake.gravacoes.filter((g) => g.tabela === 'users')).toHaveLength(0);
    expect(r.sem_mudanca).toBe(1);
    expect(r.avisos.some((a) => a.includes('e-mail do Control não troca o login do representante'))).toBe(true);
  });

  it('nunca insere na tabela users — login não nasce por POST', async () => {
    const { service, fake } = await carregar({
      users: [{ data: [], error: null }],
    });

    await service.receberRepresentantes(EMPRESA, [{ codigo: 'R01', nome: 'NOVO' }]);

    expect(fake.gravacoes.some((g) => g.tabela === 'users' && g.operacao === 'insert')).toBe(false);
  });

  it('`ativo` vazio ("") é "não veio": não mexe no acesso do rep', async () => {
    // Um CHAR nulo do Firebird costuma sair como "" no JSON gerado à mão. Antes,
    // "" contava como "veio" e virava active=false — desligava o login a cada envio.
    const { service, fake } = await carregar({
      users: [
        { data: [{ id: 'u1', erp_rep_id: 'R01' }], error: null },
        { data: null, error: null },
      ],
    });

    const r = await service.receberRepresentantes(EMPRESA, [{ codigo: 'R01', nome: 'REP TESTE', ativo: '' }]);

    expect(r.atualizados).toBe(1);
    const update = fake.gravacoes.find((g) => g.tabela === 'users' && g.operacao === 'update');
    expect('active' in valoresDe(update)).toBe(false);
  });

  it('`ativo` null ou não reconhecido não mexe no acesso (e o estranho avisa)', async () => {
    const { service, fake } = await carregar({
      users: emSequencia(
        { data: [{ id: 'u1', erp_rep_id: 'R01', active: true }, { id: 'u2', erp_rep_id: 'R02', active: true }], error: null },
        OK,
      ),
    });

    const r = await service.receberRepresentantes(EMPRESA, [
      { codigo: 'R01', nome: 'REP UM', ativo: null },
      { codigo: 'R02', nome: 'REP DOIS', ativo: 'talvez' },
    ]);

    const updates = fake.gravacoes.filter((g) => g.tabela === 'users' && g.operacao === 'update');
    expect(updates.every((u) => !('active' in valoresDe(u)))).toBe(true);
    expect(r.avisos.some((a) => a.includes('"ativo" não reconhecido') && a.includes('R02'))).toBe(true);
  });

  it('`ativo: "N"` (ou false) desativa; `"S"` (ou true) reativa', async () => {
    const { service, fake } = await carregar({
      users: [
        { data: [{ id: 'u1', erp_rep_id: 'R01', active: true }, { id: 'u2', erp_rep_id: 'R02', active: false }], error: null },
        { data: null, error: null },
        { data: null, error: null },
      ],
    });

    await service.receberRepresentantes(EMPRESA, [
      { codigo: 'R01', nome: 'REP UM', ativo: 'N' },
      { codigo: 'R02', nome: 'REP DOIS', ativo: true },
    ]);

    const updates = fake.gravacoes.filter((g) => g.tabela === 'users' && g.operacao === 'update');
    expect(updates.map((u) => valoresDe(u)['active'])).toEqual([false, true]);
  });

  it('SEM a 048: o update não leva users.updated_at (sonda de verdade, 42703) e só usa colunas reais', async () => {
    const { service, fake } = await carregar(
      {
        users: emSequencia(
          { data: null, error: { code: '42703', message: 'column users.erp_email does not exist' } }, // sonda da 049
          { data: [{ id: 'u1', erp_rep_id: '00779', name: 'NOME ANTIGO' }], error: null }, // select
          { data: null, error: { code: '42703', message: 'column users.updated_at does not exist' } }, // sonda
          OK, // update
        ),
      },
      { sondaReal: true },
    );

    const r = await service.receberRepresentantes(EMPRESA, [
      { codigo: '779', nome: 'REP TESTE', razao_social: 'REP TESTE LTDA', ativo: 'S' },
    ]);

    expect(r.atualizados).toBe(1);
    const campos = valoresDe(fake.ultimaGravacao('users', 'update'));
    expect('updated_at' in campos).toBe(false);
    esperarSoColunasReais(campos, 'users', 47);
  });

  it('COM a 048: o update leva users.updated_at', async () => {
    const { service, fake } = await carregar(
      {
        users: emSequencia(
          { data: null, error: { code: '42703', message: 'column users.erp_email does not exist' } }, // sonda da 049
          { data: [{ id: 'u1', erp_rep_id: '00779', name: 'NOME ANTIGO' }], error: null },
          { data: [{ updated_at: null }], error: null }, // sonda: a coluna existe
          OK,
        ),
      },
      { sondaReal: true },
    );

    await service.receberRepresentantes(EMPRESA, [{ codigo: '779', nome: 'REP TESTE' }]);

    const campos = valoresDe(fake.ultimaGravacao('users', 'update'));
    expect(typeof campos['updated_at']).toBe('string');
    esperarSoColunasReais(campos, 'users', 48);
  });

  it('COM a 049: o e-mail do Control vai para users.erp_email, sem aviso e sem tocar no login', async () => {
    const { service, fake } = await carregar(
      {
        users: [
          { data: [{ id: 'u1', erp_rep_id: '00779', name: 'REP TESTE', email: 'login@teste.invalid', erp_email: null }], error: null },
          OK,
        ],
      },
      { usersErpEmail: true, usersUpdatedAt: true },
    );

    const r = await service.receberRepresentantes(EMPRESA, [
      { codigo: '779', nome: 'REP TESTE', email: 'control@teste.invalid' },
    ]);

    expect(r.atualizados).toBe(1);
    expect(r.avisos.some((a) => a.includes('e-mail do Control'))).toBe(false);
    const campos = valoresDe(fake.ultimaGravacao('users', 'update'));
    expect(campos['erp_email']).toBe('control@teste.invalid');
    expect('email' in campos).toBe(false);
    expect(typeof campos['updated_at']).toBe('string');
    esperarSoColunasReais(campos, 'users', 49);
    // A leitura já pede a coluna nova.
    expect(fake.filtrosDe('users', 'select')[0]!.args[0]).toContain('erp_email');
  });

  it('COM a 049: e-mail igual ao guardado é sem_mudanca; null limpa', async () => {
    const { service, fake } = await carregar(
      {
        users: emSequencia(
          {
            data: [
              { id: 'u1', erp_rep_id: '00001', name: 'A', erp_email: 'a@teste.invalid' },
              { id: 'u2', erp_rep_id: '00002', name: 'B', erp_email: 'b@teste.invalid' },
            ],
            error: null,
          },
          OK,
        ),
      },
      { usersErpEmail: true },
    );

    const r = await service.receberRepresentantes(EMPRESA, [
      { codigo: '1', nome: 'A', email: 'a@teste.invalid' },
      { codigo: '2', nome: 'B', email: null },
    ]);

    expect(r).toMatchObject({ atualizados: 1, sem_mudanca: 1 });
    const updates = fake.gravacoes.filter((g) => g.tabela === 'users' && g.operacao === 'update').map(valoresDe);
    expect(updates).toEqual([{ erp_email: null }]);
  });

  it('razao_social vai para users.legal_name; ausente não mexe; null limpa', async () => {
    const { service, fake } = await carregar({
      users: emSequencia(
        {
          data: [
            { id: 'u1', erp_rep_id: '00001', name: 'A', legal_name: null },
            { id: 'u2', erp_rep_id: '00002', name: 'B', legal_name: 'RAZAO ANTIGA' },
            { id: 'u3', erp_rep_id: '00003', name: 'ANTIGO', legal_name: 'RAZAO GUARDADA' },
          ],
          error: null,
        },
        OK,
      ),
    });

    await service.receberRepresentantes(EMPRESA, [
      { codigo: '1', nome: 'A', razao_social: 'REP TESTE LTDA' },
      { codigo: '2', nome: 'B', razao_social: null },
      { codigo: '3', nome: 'NOVO NOME' },
    ]);

    const updates = fake.gravacoes.filter((g) => g.tabela === 'users' && g.operacao === 'update').map(valoresDe);
    expect(updates).toHaveLength(3);
    expect(updates[0]).toEqual({ legal_name: 'REP TESTE LTDA' });
    expect(updates[1]).toEqual({ legal_name: null });
    expect('legal_name' in updates[2]!).toBe(false);
  });

  it('casa pelo miolo: "779" e "#00779" são o login "00779"', async () => {
    const { service, fake } = await carregar({
      users: [{ data: [{ id: 'u-779', erp_rep_id: '00779', name: 'ANTIGO' }], error: null }, OK],
    });

    const r = await service.receberRepresentantes(EMPRESA, [{ codigo: '#779', nome: 'REP TESTE' }]);

    expect(r.atualizados).toBe(1);
    expect(r.novos).toEqual([]);
    expect(fake.filtrosDe('users', 'eq').map((f) => f.args)).toContainEqual(['id', 'u-779']);
  });

  it('dois logins com o mesmo miolo ("5525" e "05525"): ignorado, nenhum update', async () => {
    const { service, fake } = await carregar({
      users: {
        data: [
          { id: 'u1', erp_rep_id: '5525', name: 'A' },
          { id: 'u2', erp_rep_id: '05525', name: 'B' },
        ],
        error: null,
      },
    });

    const r = await service.receberRepresentantes(EMPRESA, [{ codigo: '5525', nome: 'REP TESTE' }]);

    expect(r.ignorados).toEqual([{ codigo: '5525', motivo: 'código repetido no app (dois logins com o mesmo código)' }]);
    expect(fake.gravacoes).toHaveLength(0);
  });

  it('código repetido no lote: vale o primeiro', async () => {
    const { service, fake } = await carregar({
      users: [{ data: [{ id: 'u1', erp_rep_id: '00001', name: 'ANTIGO' }], error: null }, OK],
    });

    const r = await service.receberRepresentantes(EMPRESA, [
      { codigo: '1', nome: 'PRIMEIRO' },
      { codigo: '00001', nome: 'SEGUNDO' },
    ]);

    expect(r.ignorados).toEqual([{ codigo: '00001', motivo: 'código repetido no lote' }]);
    const updates = fake.gravacoes.filter((g) => g.tabela === 'users' && g.operacao === 'update');
    expect(updates.map((u) => valoresDe(u)['name'])).toEqual(['PRIMEIRO']);
  });

  it('erro ao ler os logins LANÇA — e ninguém vira "novo" por engano', async () => {
    const { service, fake } = await carregar({
      users: { data: null, error: { message: 'timeout' } },
    });

    await expect(service.receberRepresentantes(EMPRESA, [{ codigo: '1', nome: 'REP TESTE' }])).rejects.toThrow(
      /representantes/,
    );
    expect(fake.gravacoes).toHaveLength(0);
  });

  it('restrição do banco (23505/23514) vira ignorado e o seguinte grava; outro erro lança', async () => {
    const { service, fake } = await carregar({
      users: emSequencia(
        {
          data: [
            { id: 'u1', erp_rep_id: '00001', name: 'A' },
            { id: 'u2', erp_rep_id: '00002', name: 'B' },
          ],
          error: null,
        },
        { data: null, error: { code: '23514', message: 'violates check constraint' } },
        OK,
      ),
    });

    const r = await service.receberRepresentantes(EMPRESA, [
      { codigo: '1', nome: 'A NOVO' },
      { codigo: '2', nome: 'B NOVO' },
    ]);
    expect(r.ignorados).toEqual([{ codigo: '1', motivo: 'falha ao gravar: violates check constraint' }]);
    expect(r.atualizados).toBe(1);
    expect(fake.gravacoes.filter((g) => g.operacao === 'update')).toHaveLength(2);

    vi.resetModules();
    const outro = await carregar({
      users: emSequencia(
        { data: [{ id: 'u1', erp_rep_id: '00001', name: 'A' }], error: null },
        { data: null, error: { message: 'connection reset' } },
      ),
    });
    await expect(outro.service.receberRepresentantes(EMPRESA, [{ codigo: '1', nome: 'A NOVO' }])).rejects.toThrow(
      /connection reset/,
    );
  });

  it('o update filtra por id, company_id e role rep', async () => {
    const { service, fake } = await carregar({
      users: [{ data: [{ id: 'u1', erp_rep_id: '00001', name: 'A' }], error: null }, OK],
    });

    await service.receberRepresentantes(EMPRESA, [{ codigo: '1', nome: 'A NOVO' }]);

    const eqs = fake.filtrosDe('users', 'eq').map((f) => f.args);
    // select: company_id e role; update: id, company_id e role.
    expect(eqs).toEqual([
      ['company_id', EMPRESA],
      ['role', 'rep'],
      ['id', 'u1'],
      ['company_id', EMPRESA],
      ['role', 'rep'],
    ]);
  });

  it('sem mudança: não grava, não sonda updated_at e conta em sem_mudanca', async () => {
    const { service, fake, sondas } = await carregar({
      users: [{ data: [{ id: 'u1', erp_rep_id: '00001', name: 'A', legal_name: 'A LTDA', active: true }], error: null }, OK],
    });

    const r = await service.receberRepresentantes(EMPRESA, [
      { codigo: '1', nome: 'A', razao_social: 'A LTDA', ativo: 'S' },
    ]);

    expect(r).toMatchObject({ atualizados: 0, sem_mudanca: 1, ignorados: [], novos: [] });
    expect(fake.gravacoes).toHaveLength(0);
    expect(sondas).not.toContain('users.updated_at');
  });
});

// ─── A outra mão: o que mudou no app (GET ?desde=) ───────────────────────────

describe('o que mudou no app — listarClientesAlterados', () => {
  const LOJA = {
    id: 'c-1',
    erp_id: '00123',
    name: 'LOJA TESTE LTDA',
    trade_name: 'Loja Teste',
    cnpj: '00.000.000/0001-91',
    rep_erp_id: '00779',
    price_table_id: 't-16',
    blocked: true,
    block_reason: 'em atraso',
    credit_limit: '1500.50',
    whatsapp: '00900000000',
    email: 'loja@teste.invalid',
    address: 'Rua Teste, 1 - Centro - Cidade Teste/XX - CEP 00000-001',
    cep: '00000001',
    logradouro: 'Rua Teste',
    numero: '1',
    complemento: null,
    bairro: 'Centro',
    cidade: 'Cidade Teste',
    uf: 'XX',
    inscricao_estadual: 'ISENTO',
    observacoes: null,
    updated_at: '2026-09-16T12:00:00+00:00',
  };

  it('devolve o cliente NO FORMATO DO POST, com chave (CNPJ só dígitos), filtrando por empresa e desde', async () => {
    const { service, fake } = await carregar({
      price_tables: { data: [{ id: 't-16', erp_code: '00016' }], error: null },
      customers: { data: [LOJA], error: null },
    });

    const { registros, avisos } = await service.listarClientesAlterados(EMPRESA, '2026-09-16T00:00:00Z');

    expect(registros).toEqual([
      {
        codigo: '00123',
        chave: '00000000000191',
        novo_no_control: false,
        razao_social: 'LOJA TESTE LTDA',
        nome_fantasia: 'Loja Teste',
        cnpj_cpf: '00.000.000/0001-91',
        representante: '00779',
        tabela_preco: '00016',
        endereco: {
          logradouro: 'Rua Teste',
          numero: '1',
          complemento: null,
          bairro: 'Centro',
          cidade: 'Cidade Teste',
          uf: 'XX',
          cep: '00000001',
        },
        inscricao_estadual: 'ISENTO',
        observacoes: null,
        bloqueado: 'S',
        motivo_bloqueio: 'em atraso',
        limite_credito: 1500.5,
        whatsapp: '00900000000',
        email: 'loja@teste.invalid',
        atualizado_em: '2026-09-16T12:00:00+00:00',
        // Campo novo da 051 (17/09/2026), aditivo: nada editado no app à espera do Control.
        alterado_no_app: null,
      },
    ]);
    // Sem a 049 a lista pode trazer o eco do próprio Control: fica dito.
    expect(avisos.some((a) => a.includes('049'))).toBe(true);
    expect(fake.filtrosDe('customers', 'eq').map((f) => f.args)).toContainEqual(['company_id', EMPRESA]);
    expect(fake.filtrosDe('customers', 'gte').map((f) => f.args)).toEqual([['updated_at', '2026-09-16T00:00:00Z']]);
    expect(fake.filtrosDe('customers', 'order').map((f) => f.args[0])).toEqual(['updated_at', 'id']);
  });

  it('cliente nascido no app sai com codigo null, novo_no_control true e a chave = CNPJ', async () => {
    const { service } = await carregar({
      price_tables: { data: [], error: null },
      customers: { data: [{ ...LOJA, id: 'c-2', erp_id: null, price_table_id: null }], error: null },
    });

    const { registros } = await service.listarClientesAlterados(EMPRESA);

    expect(registros[0]).toMatchObject({ codigo: null, novo_no_control: true, chave: '00000000000191', tabela_preco: null });
  });

  it('COM a 049: a trigger da 013 (updated_at uns instantes depois do carimbo) não devolve o cliente; passou da folga, devolve', async () => {
    const { service } = await carregar(
      {
        price_tables: { data: [], error: null },
        customers: {
          data: [
            // O Control gravou: o carimbo é a hora da API, updated_at a do banco.
            { ...LOJA, id: 'trigger', erp_id: '00001', erp_updated_at: '2026-09-16T12:00:00.000+00:00', updated_at: '2026-09-16T12:00:00.180+00:00' },
            // Sob carga, alguns segundos — ainda a mão do Control.
            { ...LOJA, id: 'lento', erp_id: '00002', erp_updated_at: '2026-09-16T12:00:00Z', updated_at: '2026-09-16T12:00:04.900Z' },
            // O rep trocou a tabela minutos depois.
            { ...LOJA, id: 'app', erp_id: '00003', erp_updated_at: '2026-09-16T12:00:00Z', updated_at: '2026-09-16T12:03:00Z' },
            // Carimbo em outro fuso, mesmo instante.
            { ...LOJA, id: 'fuso', erp_id: '00004', erp_updated_at: '2026-09-16T09:00:00-03:00', updated_at: '2026-09-16T12:00:00.500Z' },
          ],
          error: null,
        },
      },
      { com049: true },
    );

    const { registros } = await service.listarClientesAlterados(EMPRESA, '2026-09-16T00:00:00Z');

    expect(registros.map((r) => r.codigo)).toEqual(['00003']);
  });

  it('COM a 049: o que o próprio Control gravou por último não volta; o que o app mexeu depois volta com os campos da 049', async () => {
    const { service, fake } = await carregar(
      {
        price_tables: { data: [], error: null },
        customers: {
          data: [
            // A última mão foi a do Control: updated_at = erp_updated_at.
            { ...LOJA, id: 'do-control', erp_updated_at: '2026-09-16T12:00:00+00:00', pendencia_financeira: '10.00', titulos_vencidos: 1 },
            // O app mexeu depois do Control.
            {
              ...LOJA,
              id: 'do-app',
              updated_at: '2026-09-16T13:00:00+00:00',
              erp_updated_at: '2026-09-16T12:00:00+00:00',
              pendencia_financeira: null,
              titulos_vencidos: null,
            },
            // O Control nunca mandou este (nasceu no app).
            { ...LOJA, id: 'nunca', erp_id: null, erp_updated_at: null },
          ],
          error: null,
        },
      },
      { com049: true },
    );

    const { registros, avisos } = await service.listarClientesAlterados(EMPRESA, '2026-09-16T00:00:00Z');

    expect(registros.map((r) => r.codigo)).toEqual(['00123', null]);
    expect(registros[0]).toMatchObject({
      pendencia_financeira: null,
      titulos_vencidos: null,
      atualizado_em: '2026-09-16T13:00:00+00:00',
      atualizado_pelo_control_em: '2026-09-16T12:00:00+00:00',
    });
    expect(registros[1]).toMatchObject({ novo_no_control: true, atualizado_pelo_control_em: null });
    expect(avisos).toEqual([]);
    expect(fake.filtrosDe('customers', 'select')[0]!.args[0]).toContain('erp_updated_at');
  });

  it('SEM a 041: o endereço sai como linha, sem IE e observações', async () => {
    const { service } = await carregar(
      {
        price_tables: { data: [], error: null },
        customers: { data: [LOJA], error: null },
      },
      { cadastroReal: false },
    );

    const { registros } = await service.listarClientesAlterados(EMPRESA);

    expect(registros[0]!.endereco).toBe(LOJA.address);
    expect('inscricao_estadual' in registros[0]!).toBe(false);
  });

  it('a lista vem inteira (paginada) e erro numa página LANÇA', async () => {
    const pagina = Array.from({ length: 1000 }, (_, i) => ({ ...LOJA, id: `c-${i}`, erp_id: `X${i}` }));
    const { service } = await carregar({
      price_tables: { data: [], error: null },
      customers: emSequencia({ data: pagina, error: null }, { data: [{ ...LOJA, id: 'ultimo' }], error: null }),
    });

    const { registros } = await service.listarClientesAlterados(EMPRESA);
    expect(registros).toHaveLength(1001);

    vi.resetModules();
    const outro = await carregar({
      price_tables: { data: [], error: null },
      customers: emSequencia({ data: pagina, error: null }, { data: null, error: { message: 'soluço' } }),
    });
    await expect(outro.service.listarClientesAlterados(EMPRESA)).rejects.toThrow(/soluço/);
  });
});

describe('o que mudou no app — listarRepresentantesAlterados', () => {
  it('COM a 048 e a 049: filtra por desde, ordena por updated_at e sai no formato do POST com o e-mail do Control', async () => {
    const { service, fake } = await carregar(
      {
        users: {
          data: [
            {
              id: 'u1',
              erp_rep_id: '00779',
              name: 'REP TESTE',
              legal_name: 'REP TESTE LTDA',
              active: true,
              erp_email: 'rep@teste.invalid',
              updated_at: '2026-09-16T12:00:00+00:00',
            },
            {
              id: 'u2',
              erp_rep_id: '00780',
              name: 'REP DOIS',
              legal_name: null,
              active: false,
              erp_email: null,
              updated_at: '2026-09-16T12:30:00+00:00',
            },
          ],
          error: null,
        },
      },
      { usersUpdatedAt: true, usersErpEmail: true },
    );

    const { registros, avisos } = await service.listarRepresentantesAlterados(EMPRESA, '2026-09-16T00:00:00Z');

    expect(registros).toEqual([
      {
        codigo: '00779',
        nome: 'REP TESTE',
        razao_social: 'REP TESTE LTDA',
        ativo: 'S',
        atualizado_em: '2026-09-16T12:00:00+00:00',
        email: 'rep@teste.invalid',
      },
      { codigo: '00780', nome: 'REP DOIS', razao_social: null, ativo: 'N', atualizado_em: '2026-09-16T12:30:00+00:00', email: null },
    ]);
    expect(avisos).toEqual([]);
    expect(fake.filtrosDe('users', 'eq').map((f) => f.args)).toEqual([
      ['company_id', EMPRESA],
      ['role', 'rep'],
    ]);
    expect(fake.filtrosDe('users', 'gte').map((f) => f.args)).toEqual([['updated_at', '2026-09-16T00:00:00Z']]);
    expect(fake.filtrosDe('users', 'order').map((f) => f.args[0])).toEqual(['updated_at', 'id']);
  });

  it('SEM a 048 (users.updated_at): não filtra, a lista vem inteira com aviso, e sem e-mail sem a 049', async () => {
    const { service, fake } = await carregar({
      users: { data: [{ id: 'u1', erp_rep_id: '00779', name: 'REP TESTE', legal_name: null, active: true }], error: null },
    });

    const { registros, avisos } = await service.listarRepresentantesAlterados(EMPRESA, '2026-09-16T00:00:00Z');

    expect(registros).toEqual([{ codigo: '00779', nome: 'REP TESTE', razao_social: null, ativo: 'S', atualizado_em: null }]);
    expect(avisos.some((a) => a.includes('048'))).toBe(true);
    expect(fake.filtrosDe('users', 'gte')).toEqual([]);
    expect(fake.filtrosDe('users', 'select')[0]!.args[0]).not.toContain('updated_at');
  });
});
