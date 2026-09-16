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
 *    só é gravado com a coluna existindo (048).
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
      'users.updated_at': opcoes.usersUpdatedAt ?? false,
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
