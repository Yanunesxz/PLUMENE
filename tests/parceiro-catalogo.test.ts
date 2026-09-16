import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { criarSupabaseFake, type RespostaTabela } from './supabaseFake.js';

/**
 * O CATÁLOGO que o Control empurra pela API de Parceiro (decisão 6, 16/09/2026):
 * tabelas de preço, condições de pagamento, produtos e tamanhos, preço por
 * tabela e estoque.
 *
 * O que estes testes trancam:
 *  • cada rota casa pelo código do ERP (miolo), cria o que falta, atualiza o
 *    que existe e ignora o que não dá para usar — sem derrubar o lote;
 *  • `price_tables.name` e `payment_conditions.description` NUNCA são
 *    regravados (o CRM casa por eles); a descrição do Control vai para
 *    `erp_description`;
 *  • campo ausente não apaga; `null` limpa; reenviar o mesmo lote não grava
 *    nada (`sem_mudanca`);
 *  • o preço do Control SOBRESCREVE o que estava; o estoque também;
 *  • as colunas da 049 só são lidas e gravadas onde a migração rodou — e sem
 *    ela o dado correspondente volta como aviso;
 *  • as cinco rotas só abrem com `canal_catalogo = 'api'` (409 CANAL_FECHADO).
 *
 * Dados fictícios de propósito — nada de cliente ou produto real aqui.
 */

const EMPRESA = 'empresa-1';
const SUPABASE = '../apps/api/src/config/supabase.js';
const DETECTAR = '../apps/api/src/lib/detectarColuna.js';
const SERVICE = '../apps/api/src/modules/partner/partner.catalogo.service.js';
const CONTROLLER = '../apps/api/src/modules/partner/partner.catalogo.controller.js';
const AUTH = '../apps/api/src/modules/partner/partner.auth.js';

/** O dublê adianta uma resposta a cada consulta: esta ocupa o espaço entre duas. */
const ENCHIMENTO: RespostaTabela = { data: null, error: null };
const OK: RespostaTabela = { data: null, error: null };
const SEM_COLUNA: RespostaTabela = { data: null, error: { code: '42703', message: 'column does not exist' } };

/** Respostas em sequência para a mesma tabela (cada `from()` aguardado consome duas posições). */
function emSequencia(...respostas: RespostaTabela[]): RespostaTabela[] {
  return respostas.flatMap((r, i) => (i === respostas.length - 1 ? [r] : [r, ENCHIMENTO]));
}

interface Opcoes {
  /** A migração 049 rodou. Padrão: sim. */
  com049?: boolean;
  /** Usa o detectarColuna de verdade, sondando pelo dublê. */
  sondaReal?: boolean;
}

async function carregar(respostas: Record<string, RespostaTabela | RespostaTabela[]>, opcoes: Opcoes = {}) {
  const fake = criarSupabaseFake(respostas);
  vi.doMock(SUPABASE, () => ({ supabase: fake.cliente }));
  const sondas: string[] = [];
  if (!opcoes.sondaReal) {
    const responder = async (tabela: string, coluna?: string) => {
      sondas.push(`${tabela}.${coluna ?? ''}`);
      return opcoes.com049 ?? true;
    };
    vi.doMock(DETECTAR, () => ({
      detectar: responder,
      detectarOuFalhar: responder,
      detectarComCerteza: async (t: string, c?: string) => ((await responder(t, c)) ? 'existe' : 'nao_existe'),
      esquecerDeteccoes: () => undefined,
    }));
  }
  const service = await import(SERVICE);
  return { service, fake, sondas, onConflicts: registrarOnConflict(fake) };
}

/** O dublê não guarda o `onConflict` do upsert; este envelope guarda. */
function registrarOnConflict(fake: ReturnType<typeof criarSupabaseFake>): string[] {
  const registros: string[] = [];
  const cliente = fake.cliente as unknown as { from: (tabela: string) => Record<string, unknown> };
  const fromOriginal = cliente.from.bind(cliente);
  cliente.from = (tabela: string) => {
    const query = fromOriginal(tabela);
    const upsertOriginal = query['upsert'] as (v: unknown) => unknown;
    query['upsert'] = (valores: unknown, opcoes?: { onConflict?: string }) => {
      registros.push(opcoes?.onConflict ?? '');
      return upsertOriginal(valores);
    };
    return query;
  };
  return registros;
}

const valoresDe = (g: { valores: unknown } | undefined) => g?.valores as Record<string, unknown>;
const linhasDe = (g: { valores: unknown } | undefined) => g?.valores as Record<string, unknown>[];

// ─── Guarda de esquema: as colunas que EXISTEM, lidas das migrações ─────────

const PASTA_MIGRACOES = path.resolve(__dirname, '../apps/api/src/config/migrations');

/** Colunas graváveis de uma tabela depois das migrações até `ate` (inclusive). */
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
  it('as colunas da 049 só existem a partir dela', () => {
    expect(colunasDasMigracoes('price_tables', 48).has('erp_description')).toBe(false);
    expect(colunasDasMigracoes('price_tables', 48).has('active')).toBe(false);
    expect(colunasDasMigracoes('price_tables', 49).has('active')).toBe(true);
    expect(colunasDasMigracoes('payment_conditions', 48).has('active')).toBe(true); // da 028
    expect(colunasDasMigracoes('payment_conditions', 48).has('valor_minimo')).toBe(false);
    expect(colunasDasMigracoes('products', 48).has('erp_updated_at')).toBe(false);
    expect(colunasDasMigracoes('products', 48).has('image_url')).toBe(true);
    expect(colunasDasMigracoes('product_prices', 48).has('price_larger')).toBe(true);
    expect(colunasDasMigracoes('product_prices', 48).has('preco_original')).toBe(false);
    expect(colunasDasMigracoes('product_variants', 48).has('stock_updated_at')).toBe(false);
    expect(colunasDasMigracoes('product_variants', 49).has('stock_updated_at')).toBe(true);
  });
});

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.doUnmock(SUPABASE);
  vi.doUnmock(DETECTAR);
  vi.doUnmock(AUTH);
  vi.doUnmock(SERVICE);
  vi.restoreAllMocks();
});

// ─── (a) Tabelas de preço ────────────────────────────────────────────────────

const TABELA_1 = {
  id: 't-1',
  erp_code: '00001',
  name: 'T1 ATACADO',
  price_column: 1,
  erp_description: null,
  active: true,
  erp_updated_at: null,
};

describe('tabelas de preço', () => {
  it('cria a nova, atualiza a existente sem tocar no name, e ignora a sem código', async () => {
    const { service, fake, sondas } = await carregar({
      price_tables: emSequencia({ data: [TABELA_1], error: null }, OK, OK),
    });

    const r = await service.receberTabelasDePreco(EMPRESA, [
      { codigo: '2', descricao: 'TABELA VAREJO', coluna: 2, ativo: 'S' },
      { codigo: '#1', descricao: 'TABELA 1 DO CONTROL', coluna: 1, ativo: 'talvez' },
      { descricao: 'SEM CODIGO' },
    ]);

    expect(sondas).toContain('price_tables.erp_description');
    expect(r).toMatchObject({ recebidos: 3, criados: 1, atualizados: 1, sem_mudanca: 0 });
    expect(r.ignorados).toEqual([{ codigo: null, motivo: 'sem código do ERP' }]);
    expect(r.avisos.some((a) => a.includes('"ativo" não reconhecido') && a.includes('#1'))).toBe(true);

    const linha = linhasDe(fake.ultimaGravacao('price_tables', 'insert'))[0]!;
    expect(linha).toMatchObject({
      company_id: EMPRESA,
      erp_code: '00002',
      name: 'TABELA VAREJO',
      price_column: 2,
      erp_description: 'TABELA VAREJO',
      active: true,
    });
    expect(typeof linha['erp_updated_at']).toBe('string');
    expect(typeof linha['updated_at']).toBe('string');
    esperarSoColunasReais(linha, 'price_tables', 49);

    const patch = valoresDe(fake.ultimaGravacao('price_tables', 'update'));
    expect(Object.keys(patch).sort()).toEqual(['erp_description', 'erp_updated_at', 'updated_at']);
    expect(patch['erp_description']).toBe('TABELA 1 DO CONTROL');
    expect('name' in patch).toBe(false);
    const eqs = fake.filtrosDe('price_tables', 'eq').map((f) => f.args);
    expect(eqs).toContainEqual(['id', 't-1']);
    expect(eqs.filter((a) => a[0] === 'company_id' && a[1] === EMPRESA)).toHaveLength(2); // select e update
  });

  it('o name NUNCA é regravado, mesmo com descrição diferente; o código vira a grafia única', async () => {
    const { service, fake } = await carregar({
      price_tables: emSequencia({ data: [{ ...TABELA_1, erp_code: '1', name: 'T1' }], error: null }, OK),
    });

    const r = await service.receberTabelasDePreco(EMPRESA, [{ codigo: '1', descricao: 'OUTRO NOME', coluna: 1 }]);

    expect(r.atualizados).toBe(1);
    const patch = valoresDe(fake.ultimaGravacao('price_tables', 'update'));
    expect(patch['erp_code']).toBe('00001');
    expect(patch['erp_description']).toBe('OUTRO NOME');
    expect('name' in patch).toBe(false);
  });

  it('reenvio igual (data_update inclusive, em outro fuso) não grava nada', async () => {
    const { service, fake } = await carregar({
      price_tables: emSequencia(
        {
          data: [{ ...TABELA_1, price_column: 2, erp_description: 'X', erp_updated_at: '2026-09-10T10:00:00.000Z' }],
          error: null,
        },
        OK,
      ),
    });

    const r = await service.receberTabelasDePreco(EMPRESA, [
      { codigo: '00001', descricao: 'X', coluna: '2', ativo: true, data_update: '2026-09-10T07:00:00-03:00' },
    ]);

    expect(r).toMatchObject({ criados: 0, atualizados: 0, sem_mudanca: 1, ignorados: [] });
    expect(fake.gravacoes).toHaveLength(0);
  });

  it('data_update mais nova sem outra mudança grava só o carimbo', async () => {
    const { service, fake } = await carregar({
      price_tables: emSequencia({ data: [{ ...TABELA_1, erp_updated_at: '2026-09-10T10:00:00Z' }], error: null }, OK),
    });

    await service.receberTabelasDePreco(EMPRESA, [{ codigo: '1', coluna: 1, data_update: '2026-09-11T10:00:00Z' }]);

    const patch = valoresDe(fake.ultimaGravacao('price_tables', 'update'));
    expect(Object.keys(patch).sort()).toEqual(['erp_updated_at', 'updated_at']);
    expect(patch['erp_updated_at']).toBe('2026-09-11T10:00:00Z');
  });

  it('campo ausente não mexe: só código e coluna não apagam descrição nem desligam', async () => {
    const { service, fake } = await carregar({
      price_tables: emSequencia({ data: [{ ...TABELA_1, erp_description: 'GUARDADA', active: false }], error: null }, OK),
    });

    const r = await service.receberTabelasDePreco(EMPRESA, [{ codigo: '1', coluna: 1, ativo: '', descricao: '' }]);

    expect(r.sem_mudanca).toBe(1);
    expect(fake.gravacoes).toHaveLength(0);
  });

  it('coluna fora de 1 a 6 é ignorada; tabela nova sem coluna nasce com 1 e avisa', async () => {
    const { service, fake } = await carregar({ price_tables: emSequencia({ data: [], error: null }, OK) });

    const r = await service.receberTabelasDePreco(EMPRESA, [
      { codigo: '3', coluna: 9 },
      { codigo: '4', descricao: 'D' },
      { codigo: '5', coluna: 1, data_update: '2026-09-10T10:00:00' },
    ]);

    expect(r.ignorados).toEqual([
      { codigo: '3', motivo: '"coluna" precisa ser um inteiro de 1 a 6' },
      { codigo: '5', motivo: '"data_update" precisa de fuso (Z ou -03:00)' },
    ]);
    const linhas = linhasDe(fake.ultimaGravacao('price_tables', 'insert'));
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ erp_code: '00004', name: 'D', price_column: 1 });
    expect(r.avisos.some((a) => a.includes('sem "coluna"') && a.includes('4'))).toBe(true);
  });

  it('SEM a 049 (sonda de verdade, 42703): não lê nem grava as colunas novas, e avisa', async () => {
    const { service, fake } = await carregar(
      {
        price_tables: emSequencia(
          SEM_COLUNA, // sonda
          { data: [{ id: 't-1', erp_code: '00001', name: 'T1', price_column: 1 }], error: null },
          OK, // insert
        ),
      },
      { sondaReal: true },
    );

    const r = await service.receberTabelasDePreco(EMPRESA, [
      { codigo: '2', descricao: 'NOVA', coluna: 1, ativo: 'N' },
      { codigo: '1', descricao: 'DESCRICAO DO CONTROL', coluna: 1 },
    ]);

    const selects = fake.filtrosDe('price_tables', 'select').map((f) => String(f.args[0]));
    expect(selects[1]).not.toContain('erp_description');
    expect(selects[1]).not.toContain('active');
    expect(r.criados).toBe(1);
    expect(r.sem_mudanca).toBe(1); // a descrição não tem onde ficar; o name não é regravado
    const linha = linhasDe(fake.ultimaGravacao('price_tables', 'insert'))[0]!;
    expect(linha).toMatchObject({ erp_code: '00002', name: 'NOVA', price_column: 1 });
    expect('active' in linha).toBe(false);
    esperarSoColunasReais(linha, 'price_tables', 48);
    expect(fake.gravacoes.filter((g) => g.operacao === 'update')).toHaveLength(0);
    expect(r.avisos).toContain(service.AVISO_SEM_049.tabelas);
  });

  it('código repetido no lote e código com duas tabelas no app: ignorados, nada gravado', async () => {
    const { service, fake } = await carregar({
      price_tables: {
        data: [
          { ...TABELA_1, id: 'a', erp_code: '1' },
          { ...TABELA_1, id: 'b', erp_code: '00001' },
        ],
        error: null,
      },
    });

    const r = await service.receberTabelasDePreco(EMPRESA, [
      { codigo: '1', coluna: 1 },
      { codigo: '01', coluna: 1 },
    ]);

    expect(r.ignorados).toEqual([
      { codigo: '1', motivo: 'código com mais de uma tabela no app' },
      { codigo: '01', motivo: 'código repetido no lote' },
    ]);
    expect(fake.gravacoes).toHaveLength(0);
  });

  it('erro ao ler as tabelas LANÇA antes de gravar qualquer coisa', async () => {
    const { service, fake } = await carregar({ price_tables: { data: null, error: { message: 'timeout' } } });

    await expect(service.receberTabelasDePreco(EMPRESA, [{ codigo: '1', coluna: 1 }])).rejects.toThrow(/timeout/);
    expect(fake.gravacoes).toHaveLength(0);
  });

  it('falha ao gravar UMA tabela vira ignorado e as outras seguem; insert em lote que falha repete um a um', async () => {
    const existentes = [1, 2].map((n) => ({ ...TABELA_1, id: `t-${n}`, erp_code: `0000${n}` }));
    const { service, fake } = await carregar({
      price_tables: emSequencia(
        { data: existentes, error: null },
        { data: null, error: { message: 'duplicate key' } }, // lote de insert
        OK, // insert 3
        { data: null, error: { message: 'duplicate key' } }, // insert 4
        { data: null, error: { message: 'violates check constraint' } }, // update 1
        OK, // update 2
      ),
    });

    const r = await service.receberTabelasDePreco(EMPRESA, [
      { codigo: '1', coluna: 3 },
      { codigo: '2', coluna: 3 },
      { codigo: '3', coluna: 1 },
      { codigo: '4', coluna: 1 },
    ]);

    expect(r.criados).toBe(1);
    expect(r.atualizados).toBe(1);
    expect(r.ignorados).toEqual([
      { codigo: '4', motivo: 'falha ao gravar: duplicate key' },
      { codigo: '1', motivo: 'falha ao gravar: violates check constraint' },
    ]);
    expect(fake.gravacoes.filter((g) => g.operacao === 'insert')).toHaveLength(3);
    expect(fake.gravacoes.filter((g) => g.operacao === 'update')).toHaveLength(2);
  });
});

// ─── (b) Condições de pagamento ──────────────────────────────────────────────

const CONDICAO_15 = {
  id: 'c-15',
  code: 15,
  description: '60 DIAS',
  active: true,
  erp_description: null,
  valor_minimo: null,
  erp_updated_at: null,
};

describe('condições de pagamento', () => {
  it('cria a nova com description = descrição, atualiza a existente sem tocar na description', async () => {
    const { service, fake, sondas } = await carregar({
      payment_conditions: emSequencia({ data: [CONDICAO_15], error: null }, OK, OK),
    });

    const r = await service.receberCondicoesDePagamento(EMPRESA, [
      { codigo: '015', descricao: '60 DIAS (CONTROL)', ativo: 'S', valor_minimo: '1.500,00' },
      { codigo: '200', descricao: 'NOVA', valor_minimo: 300 },
      { codigo: 'A1', descricao: 'X' },
      { codigo: '201' },
    ]);

    expect(sondas).toContain('payment_conditions.erp_description');
    expect(r).toMatchObject({ recebidos: 4, criados: 1, atualizados: 1, sem_mudanca: 0 });
    expect(r.ignorados).toEqual([
      { codigo: 'A1', motivo: 'código da condição precisa ser numérico' },
      { codigo: '201', motivo: 'sem descrição' },
    ]);

    const linha = linhasDe(fake.ultimaGravacao('payment_conditions', 'insert'))[0]!;
    expect(linha).toMatchObject({
      company_id: EMPRESA,
      code: 200,
      description: 'NOVA',
      active: true,
      erp_description: 'NOVA',
      valor_minimo: 300,
    });
    expect(typeof linha['erp_updated_at']).toBe('string');
    esperarSoColunasReais(linha, 'payment_conditions', 49);

    const patch = valoresDe(fake.ultimaGravacao('payment_conditions', 'update'));
    expect(Object.keys(patch).sort()).toEqual(['erp_description', 'erp_updated_at', 'updated_at', 'valor_minimo']);
    expect(patch['valor_minimo']).toBe(1500);
    expect('description' in patch).toBe(false);
    expect(fake.filtrosDe('payment_conditions', 'eq').map((f) => f.args)).toContainEqual(['id', 'c-15']);
  });

  it('reenvio igual não grava nada (numeric vem como texto do banco)', async () => {
    const { service, fake } = await carregar({
      payment_conditions: emSequencia(
        {
          data: [{ ...CONDICAO_15, erp_description: '60 DIAS', valor_minimo: '1500.00', erp_updated_at: '2026-09-10T10:00:00Z' }],
          error: null,
        },
        OK,
      ),
    });

    const r = await service.receberCondicoesDePagamento(EMPRESA, [
      { codigo: 15, descricao: '60 DIAS', ativo: true, valor_minimo: 1500, data_update: '2026-09-10T10:00:00.000Z' },
    ]);

    expect(r).toMatchObject({ atualizados: 0, sem_mudanca: 1, ignorados: [] });
    expect(fake.gravacoes).toHaveLength(0);
  });

  it('null limpa o valor mínimo; ausente não mexe; "N" desliga', async () => {
    const { service, fake } = await carregar({
      payment_conditions: emSequencia(
        {
          data: [
            { ...CONDICAO_15, id: 'c-1', code: 1, valor_minimo: 100 },
            { ...CONDICAO_15, id: 'c-2', code: 2, valor_minimo: 200 },
          ],
          error: null,
        },
        OK,
      ),
    });

    await service.receberCondicoesDePagamento(EMPRESA, [
      { codigo: 1, valor_minimo: null },
      { codigo: 2, ativo: 'N' },
    ]);

    const updates = fake.gravacoes.filter((g) => g.tabela === 'payment_conditions' && g.operacao === 'update').map(valoresDe);
    expect(updates).toHaveLength(2);
    expect(updates[0]).toMatchObject({ valor_minimo: null });
    expect('active' in updates[0]!).toBe(false);
    expect(updates[1]).toMatchObject({ active: false });
    expect('valor_minimo' in updates[1]!).toBe(false);
  });

  it('SEM a 049: ativo grava, o resto fica de fora (só colunas reais) e avisa', async () => {
    const { service, fake } = await carregar(
      {
        payment_conditions: emSequencia({ data: [{ id: 'c-1', code: 1, description: 'A VISTA', active: true }], error: null }, OK, OK),
      },
      { com049: false },
    );

    const r = await service.receberCondicoesDePagamento(EMPRESA, [
      { codigo: '1', descricao: 'À VISTA', ativo: 'N', valor_minimo: 10 },
      { codigo: '9', descricao: 'NOVA' },
    ]);

    expect(String(fake.filtrosDe('payment_conditions', 'select')[0]!.args[0])).not.toContain('valor_minimo');
    const patch = valoresDe(fake.ultimaGravacao('payment_conditions', 'update'));
    expect(Object.keys(patch).sort()).toEqual(['active', 'updated_at']);
    esperarSoColunasReais(patch, 'payment_conditions', 48);
    const linha = linhasDe(fake.ultimaGravacao('payment_conditions', 'insert'))[0]!;
    expect(linha).toMatchObject({ code: 9, description: 'NOVA', active: true });
    esperarSoColunasReais(linha, 'payment_conditions', 48);
    expect(r.avisos).toContain(service.AVISO_SEM_049.condicoes);
  });
});

// ─── (c) Produtos e tamanhos ─────────────────────────────────────────────────

const PRODUTO_0706 = {
  id: 'p-1',
  erp_id: '0706',
  sku: '0706',
  name: 'PIJAMA TESTE',
  collection: 'VERAO TESTE',
  brand: null,
  group_name: null,
  active: true,
  erp_updated_at: null,
};

describe('produtos e tamanhos', () => {
  it('cria o novo com a grade, atualiza o existente e nunca toca em image_url, description ou sku', async () => {
    const { service, fake, sondas } = await carregar({
      products: emSequencia(
        { data: [PRODUTO_0706], error: null },
        { data: [{ id: 'p-2', erp_id: '0800' }], error: null }, // insert devolve o id
        OK, // update
      ),
      product_variants: emSequencia({ data: [{ id: 'v-1', product_id: 'p-1', size: 'M', active: true }], error: null }, OK, OK),
    });

    const r = await service.receberProdutos(EMPRESA, [
      { codigo: '0706', nome: 'PIJAMA TESTE NOVO', grupo: 'ADULTO', tamanhos: [{ tamanho: 'm', ativo: 'N' }, { tamanho: 'G' }] },
      { codigo: '0800', referencia: '0800', nome: 'CAMISOLA TESTE', marca: 'MARCA TESTE', tamanhos: [{ tamanho: 'P' }, { tamanho: 'M' }] },
    ]);

    expect(sondas).toContain('products.erp_updated_at');
    expect(r).toMatchObject({ recebidos: 2, criados: 1, atualizados: 1, sem_mudanca: 0, tamanhos_criados: 3, tamanhos_atualizados: 1 });
    expect(r.ignorados).toEqual([]);

    const produtoNovo = linhasDe(fake.ultimaGravacao('products', 'insert'))[0]!;
    expect(produtoNovo).toMatchObject({
      company_id: EMPRESA,
      erp_id: '0800',
      sku: '0800',
      name: 'CAMISOLA TESTE',
      brand: 'MARCA TESTE',
      group_name: null,
      collection: null,
      active: true,
    });
    expect(typeof produtoNovo['erp_updated_at']).toBe('string');
    for (const coluna of ['image_url', 'description', 'variant_group', 'color_name', 'color_hex']) {
      expect(coluna in produtoNovo, coluna).toBe(false);
    }
    esperarSoColunasReais(produtoNovo, 'products', 49);
    // O insert pede o id de volta: é ele que liga a grade ao produto novo.
    expect(fake.filtrosDe('products', 'select').map((f) => f.args[0])).toContain('id, erp_id');

    const patch = valoresDe(fake.ultimaGravacao('products', 'update'));
    expect(Object.keys(patch).sort()).toEqual(['erp_updated_at', 'group_name', 'name', 'updated_at']);
    expect(patch).toMatchObject({ name: 'PIJAMA TESTE NOVO', group_name: 'ADULTO' });

    const tamanhosNovos = linhasDe(fake.ultimaGravacao('product_variants', 'insert'));
    expect(tamanhosNovos.map((t) => t['erp_sku'])).toEqual(['0706|G', '0800|P', '0800|M']);
    expect(tamanhosNovos.map((t) => t['product_id'])).toEqual(['p-1', 'p-2', 'p-2']);
    expect(tamanhosNovos[0]).toMatchObject({ company_id: EMPRESA, size: 'G', stock_quantity: 0, stock_committed: 0, active: true });
    esperarSoColunasReais(tamanhosNovos[0]!, 'product_variants', 48);

    const tamanhoDesligado = valoresDe(fake.ultimaGravacao('product_variants', 'update'));
    expect(Object.keys(tamanhoDesligado).sort()).toEqual(['active', 'updated_at']);
    expect(tamanhoDesligado['active']).toBe(false);
    expect(fake.filtrosDe('product_variants', 'eq').map((f) => f.args)).toContainEqual(['id', 'v-1']);
  });

  it('ADOTA pelo sku o produto do PDF que não tinha código — a mesma referência não vira duas', async () => {
    const { service, fake } = await carregar({
      products: emSequencia({ data: [{ ...PRODUTO_0706, id: 'p-pdf', erp_id: null }], error: null }, OK),
      product_variants: { data: [], error: null },
    });

    const r = await service.receberProdutos(EMPRESA, [{ codigo: '000706', referencia: '0706', nome: 'PIJAMA TESTE' }]);

    expect(r).toMatchObject({ criados: 0, atualizados: 1 });
    expect(fake.gravacoes.filter((g) => g.operacao === 'insert')).toHaveLength(0);
    const patch = valoresDe(fake.ultimaGravacao('products', 'update'));
    expect(patch['erp_id']).toBe('000706');
    expect('sku' in patch).toBe(false); // já tinha sku
    expect(fake.filtrosDe('products', 'eq').map((f) => f.args)).toContainEqual(['id', 'p-pdf']);
    expect(r.avisos.some((a) => a.includes('aprenderam o código'))).toBe(true);
  });

  it('campo ausente não apaga, tamanho que não veio não é desativado, e reenvio igual não grava nada', async () => {
    const { service, fake } = await carregar({
      products: emSequencia({ data: [{ ...PRODUTO_0706, group_name: 'ADULTO' }], error: null }, OK),
      product_variants: emSequencia(
        {
          data: [
            { id: 'v-1', product_id: 'p-1', size: 'M', active: true },
            { id: 'v-2', product_id: 'p-1', size: 'G', active: true },
          ],
          error: null,
        },
        OK,
      ),
    });

    const r = await service.receberProdutos(EMPRESA, [
      { codigo: '706', nome: 'PIJAMA TESTE', tamanhos: [{ tamanho: 'M', ativo: 'S' }], marca: '' },
    ]);

    expect(r).toMatchObject({ atualizados: 0, sem_mudanca: 1, tamanhos_criados: 0, tamanhos_atualizados: 0 });
    expect(fake.gravacoes).toHaveLength(0);
  });

  it('null limpa grupo, coleção e marca; "N" desliga; nome null não apaga o nome', async () => {
    const { service, fake } = await carregar({
      products: emSequencia({ data: [{ ...PRODUTO_0706, group_name: 'A', brand: 'C' }], error: null }, OK),
      product_variants: { data: [], error: null },
    });

    await service.receberProdutos(EMPRESA, [{ codigo: '0706', nome: null, grupo: null, colecao: null, marca: null, ativo: 'N' }]);

    const patch = valoresDe(fake.ultimaGravacao('products', 'update'));
    expect(patch).toMatchObject({ group_name: null, collection: null, brand: null, active: false });
    expect('name' in patch).toBe(false);
  });

  it('produto novo sem nome é ignorado; sem o id devolvido, a grade fica para o próximo envio', async () => {
    const { service, fake } = await carregar({
      products: emSequencia({ data: [], error: null }, OK), // o insert não devolve linhas
      product_variants: { data: [], error: null },
    });

    const r = await service.receberProdutos(EMPRESA, [
      { codigo: '1' },
      { codigo: '2', nome: 'X', tamanhos: [{ tamanho: 'U' }] },
    ]);

    expect(r.ignorados).toEqual([{ codigo: '1', motivo: 'sem nome' }]);
    expect(r.criados).toBe(1);
    expect(r.tamanhos_criados).toBe(0);
    expect(fake.gravacoes.filter((g) => g.tabela === 'product_variants')).toHaveLength(0);
    expect(r.avisos.some((a) => a.includes('não devolveu o id') && a.includes('2'))).toBe(true);
  });

  it('SEM a 049 (sonda de verdade): o insert só leva colunas reais e o data_update vira aviso', async () => {
    const { service, fake } = await carregar(
      {
        products: emSequencia(
          SEM_COLUNA, // sonda
          { data: [], error: null },
          { data: [{ id: 'p-9', erp_id: '0900' }], error: null },
        ),
        product_variants: emSequencia({ data: [], error: null }, OK),
      },
      { sondaReal: true },
    );

    const r = await service.receberProdutos(EMPRESA, [
      { codigo: '0900', nome: 'NOVO', data_update: '2026-09-10T10:00:00Z', tamanhos: [{ tamanho: 'U' }] },
    ]);

    const selects = fake.filtrosDe('products', 'select').map((f) => String(f.args[0]));
    expect(selects[1]).not.toContain('erp_updated_at');
    const linha = linhasDe(fake.ultimaGravacao('products', 'insert'))[0]!;
    expect('erp_updated_at' in linha).toBe(false);
    esperarSoColunasReais(linha, 'products', 48);
    expect(r.tamanhos_criados).toBe(1);
    expect(r.avisos).toContain(service.AVISO_SEM_049.produtos);
  });

  it('código com dois produtos no app: ignorado; erro ao ler a grade LANÇA sem gravar', async () => {
    const { service, fake } = await carregar({
      products: {
        data: [
          { ...PRODUTO_0706, id: 'a', erp_id: '706' },
          { ...PRODUTO_0706, id: 'b', erp_id: '0706' },
        ],
        error: null,
      },
      product_variants: { data: [], error: null },
    });

    const r = await service.receberProdutos(EMPRESA, [{ codigo: '0706', nome: 'X' }]);
    expect(r.ignorados).toEqual([{ codigo: '0706', motivo: 'código com mais de um produto no app' }]);
    expect(fake.gravacoes).toHaveLength(0);

    vi.resetModules();
    const outro = await carregar({
      products: { data: [PRODUTO_0706], error: null },
      product_variants: { data: null, error: { message: 'soluço da rede' } },
    });
    await expect(outro.service.receberProdutos(EMPRESA, [{ codigo: '0706', nome: 'X' }])).rejects.toThrow(/soluço/);
    expect(outro.fake.gravacoes).toHaveLength(0);
  });
});

// ─── (d) Preço por tabela ────────────────────────────────────────────────────

describe('preço por tabela', () => {
  it('sobrescreve o preço por upsert em (produto, tabela); com a 049 guarda original, desconto e carimbo', async () => {
    const { service, fake, onConflicts, sondas } = await carregar({
      price_tables: { data: [{ id: 't-1', erp_code: '00001' }], error: null },
      products: {
        data: [
          { id: 'p-1', erp_id: '0706', sku: '0706' },
          { id: 'p-2', erp_id: null, sku: '0800' }, // do PDF: casa pelo sku
        ],
        error: null,
      },
      product_prices: emSequencia(
        {
          data: [{ product_id: 'p-1', price_table_id: 't-1', price: '41.90', preco_original: null, desconto_percentual: null, erp_updated_at: null }],
          error: null,
        },
        OK,
      ),
    });

    const r = await service.receberPrecos(EMPRESA, [
      { tabela: '1', produto: '0706', preco: 45.9, preco_original: '49.90', desconto_percentual: 8 },
      { tabela: '01', produto: '0800', preco: '30,00' },
      { tabela: '1', produto: '9999', preco: 10 },
      { tabela: '7', produto: '0706', preco: 10 },
      { tabela: '1', produto: '0801', preco: 0 },
    ]);

    expect(sondas).toContain('product_prices.erp_updated_at');
    expect(r).toMatchObject({ recebidos: 5, criados: 1, atualizados: 1, sem_mudanca: 0 });
    expect(r.ignorados).toEqual([
      { codigo: '9999', motivo: 'produto não encontrado no app' },
      { codigo: '0706', motivo: 'tabela 7 não encontrada no app' },
      { codigo: '0801', motivo: '"preco" precisa ser um número maior que zero' },
    ]);
    // Só os preços das tabelas envolvidas são lidos, e sempre pela empresa.
    expect(fake.filtrosDe('product_prices', 'in')[0]?.args).toEqual(['price_table_id', ['t-1']]);
    expect(fake.filtrosDe('product_prices', 'eq').map((f) => f.args)).toContainEqual(['company_id', EMPRESA]);

    const upserts = fake.gravacoes.filter((g) => g.tabela === 'product_prices' && g.operacao === 'upsert').map(linhasDe);
    expect(onConflicts).toEqual(['product_id,price_table_id', 'product_id,price_table_id']);
    const linhas = upserts.flat();
    const doExistente = linhas.find((l) => l['product_id'] === 'p-1')!;
    expect(doExistente).toMatchObject({
      company_id: EMPRESA,
      price_table_id: 't-1',
      price: 45.9,
      preco_original: 49.9,
      desconto_percentual: 8,
    });
    expect(typeof doExistente['erp_updated_at']).toBe('string');
    expect(typeof doExistente['updated_at']).toBe('string');
    const doNovo = linhas.find((l) => l['product_id'] === 'p-2')!;
    expect(doNovo).toMatchObject({ company_id: EMPRESA, price_table_id: 't-1', price: 30 });
    for (const l of linhas) {
      // Sem `preco_faixa_maior` no corpo a faixa maior não é mexida; a variante nunca.
      expect('price_larger' in l).toBe(false);
      expect('variant_id' in l).toBe(false);
      esperarSoColunasReais(l, 'product_prices', 49);
    }
    expect(r.avisos.some((a) => a.includes('9999') && a.includes('/produtos'))).toBe(true);
    expect(r.avisos.some((a) => a.includes('7') && a.includes('/tabelas-preco'))).toBe(true);
  });

  it('preco_faixa_maior grava price_larger; null limpa; ausente não mexe e avisa quando o PDF tinha deixado um; zero é inválido', async () => {
    // O pedido precifica EG/XG e 48–54 por price_larger sempre que ele não é
    // nulo: só `price` deixava o preço da faixa maior do PDF valendo.
    const { service, fake, sondas } = await carregar({
      price_tables: { data: [{ id: 't-1', erp_code: '00001' }], error: null },
      products: {
        data: [
          { id: 'p-1', erp_id: '1', sku: '1' },
          { id: 'p-2', erp_id: '2', sku: '2' },
          { id: 'p-3', erp_id: '3', sku: '3' },
          { id: 'p-4', erp_id: '4', sku: '4' },
        ],
        error: null,
      },
      product_prices: emSequencia(
        {
          data: [
            { product_id: 'p-1', price_table_id: 't-1', price: '40.00', price_larger: '48.00', erp_updated_at: null },
            { product_id: 'p-2', price_table_id: 't-1', price: '40.00', price_larger: '48.00', erp_updated_at: null },
            { product_id: 'p-3', price_table_id: 't-1', price: '40.00', price_larger: '48.00', erp_updated_at: null },
            { product_id: 'p-4', price_table_id: 't-1', price: '40.00', price_larger: '48.00', erp_updated_at: null },
          ],
          error: null,
        },
        OK,
      ),
    });

    const r = await service.receberPrecos(EMPRESA, [
      { tabela: '1', produto: '1', preco: 42, preco_faixa_maior: '52,90' },
      { tabela: '1', produto: '2', preco: 42, preco_faixa_maior: null },
      { tabela: '1', produto: '3', preco: 42 },
      { tabela: '1', produto: '4', preco: 42, preco_faixa_maior: 0 },
    ]);

    expect(sondas).toContain('product_prices.price_larger');
    expect(String(fake.filtrosDe('product_prices', 'select').at(-1)!.args[0])).toContain('price_larger');
    const linhas = fake.gravacoes
      .filter((g) => g.tabela === 'product_prices' && g.operacao === 'upsert')
      .flatMap(linhasDe);
    const de = (id: string) => linhas.find((l) => l['product_id'] === id)!;
    expect(de('p-1')).toMatchObject({ price: 42, price_larger: 52.9 });
    expect(de('p-2')).toMatchObject({ price: 42, price_larger: null });
    expect('price_larger' in de('p-3')).toBe(false);
    expect('price_larger' in de('p-4')).toBe(false);
    for (const l of linhas) esperarSoColunasReais(l, 'product_prices', 49);
    expect(r.avisos.find((a) => a.startsWith('Preço da faixa maior'))).toMatch(/: 3\.$/);
    expect(r.avisos.some((a) => a.includes('"preco_faixa_maior" precisa ser um número maior que zero') && a.includes('4'))).toBe(true);
  });

  it('mesmo preço (centavos) e mesmo carimbo: nada gravado', async () => {
    const { service, fake } = await carregar({
      price_tables: { data: [{ id: 't-1', erp_code: '00001' }], error: null },
      products: { data: [{ id: 'p-1', erp_id: '0706', sku: '0706' }], error: null },
      product_prices: emSequencia(
        { data: [{ product_id: 'p-1', price_table_id: 't-1', price: '45.90', preco_original: '49.90', desconto_percentual: null, erp_updated_at: '2026-09-10T10:00:00Z' }], error: null },
        OK,
      ),
    });

    const r = await service.receberPrecos(EMPRESA, [
      { tabela: '1', produto: '706', preco: '45.9', preco_original: 49.9, data_update: '2026-09-10T07:00:00-03:00' },
    ]);

    expect(r).toMatchObject({ criados: 0, atualizados: 0, sem_mudanca: 1, ignorados: [] });
    expect(fake.gravacoes).toHaveLength(0);
  });

  it('SEM a 049: o upsert só leva colunas reais, e original/desconto viram aviso', async () => {
    const { service, fake } = await carregar(
      {
        price_tables: { data: [{ id: 't-1', erp_code: '00001' }], error: null },
        products: { data: [{ id: 'p-1', erp_id: '0706', sku: '0706' }], error: null },
        product_prices: emSequencia({ data: [], error: null }, OK),
      },
      { com049: false },
    );

    const r = await service.receberPrecos(EMPRESA, [{ tabela: '1', produto: '0706', preco: 45.9, preco_original: 49.9 }]);

    expect(String(fake.filtrosDe('product_prices', 'select')[0]!.args[0])).not.toContain('preco_original');
    const linha = linhasDe(fake.ultimaGravacao('product_prices', 'upsert'))[0]!;
    expect(Object.keys(linha).sort()).toEqual(['company_id', 'price', 'price_table_id', 'product_id', 'updated_at']);
    esperarSoColunasReais(linha, 'product_prices', 48);
    expect(r.criados).toBe(1);
    expect(r.avisos).toContain(service.AVISO_SEM_049.precos);
  });

  it('lote de upsert que falha é repetido um a um e só o ruim fica de fora', async () => {
    const { service, fake } = await carregar({
      price_tables: { data: [{ id: 't-1', erp_code: '00001' }], error: null },
      products: {
        data: [
          { id: 'p-1', erp_id: '1', sku: '1' },
          { id: 'p-2', erp_id: '2', sku: '2' },
          { id: 'p-3', erp_id: '3', sku: '3' },
        ],
        error: null,
      },
      product_prices: emSequencia(
        { data: [], error: null },
        { data: null, error: { message: 'deadlock' } }, // o lote
        OK, // 1
        { data: null, error: { message: 'deadlock' } }, // 2
        OK, // 3
      ),
    });

    const r = await service.receberPrecos(EMPRESA, [
      { tabela: '1', produto: '1', preco: 10 },
      { tabela: '1', produto: '2', preco: 20 },
      { tabela: '1', produto: '3', preco: 30 },
    ]);

    expect(r.criados).toBe(2);
    expect(r.ignorados).toEqual([{ codigo: '2', motivo: 'falha ao gravar: deadlock' }]);
    expect(fake.gravacoes.filter((g) => g.operacao === 'upsert')).toHaveLength(4);
  });

  it('tabela com dois cadastros no app e par repetido no lote: ignorados', async () => {
    const { service, fake } = await carregar({
      price_tables: {
        data: [
          { id: 'a', erp_code: '1' },
          { id: 'b', erp_code: '00001' },
          { id: 'c', erp_code: '2' },
        ],
        error: null,
      },
      products: { data: [{ id: 'p-1', erp_id: '0706', sku: '0706' }], error: null },
      product_prices: emSequencia({ data: [], error: null }, OK),
    });

    const r = await service.receberPrecos(EMPRESA, [
      { tabela: '1', produto: '0706', preco: 10 },
      { tabela: '2', produto: '0706', preco: 10 },
      { tabela: '02', produto: '706', preco: 11 },
    ]);

    expect(r.ignorados).toEqual([
      { codigo: '0706', motivo: 'tabela 1 com mais de um cadastro no app' },
      { codigo: '706', motivo: 'repetido no lote (tabela 02)' },
    ]);
    expect(r.criados).toBe(1);
    expect(fake.gravacoes.filter((g) => g.operacao === 'upsert')).toHaveLength(1);
  });
});

// ─── (e) Estoque ─────────────────────────────────────────────────────────────

const GRADE_0706 = [
  { id: 'v-1', product_id: 'p-1', erp_sku: '0706|M', size: 'M', stock_quantity: 5, stock_committed: 1, stock_updated_at: null },
  { id: 'v-2', product_id: 'p-1', erp_sku: '0706|G', size: 'G', stock_quantity: 3, stock_committed: 0, stock_updated_at: null },
];

describe('estoque', () => {
  it('sobrescreve o estoque e o reservado por upsert em (empresa, erp_sku); com a 049 carimba stock_updated_at', async () => {
    const { service, fake, onConflicts, sondas } = await carregar({
      products: { data: [{ id: 'p-1', erp_id: '0706', sku: '0706' }], error: null },
      product_variants: emSequencia({ data: GRADE_0706, error: null }, OK),
    });

    const r = await service.receberEstoque(EMPRESA, [
      { produto: '0706', tamanho: 'm', quantidade: 12, reservado: '2' },
      { produto: '0706', tamanho: 'G', quantidade: 3 },
      { produto: '0706', tamanho: 'XG', quantidade: 1 },
      { produto: '0999', tamanho: 'M', quantidade: 1 },
      { produto: '0706', tamanho: 'P', quantidade: 1.5 },
      { produto: '706', tamanho: 'M', quantidade: 1 },
    ]);

    expect(sondas).toContain('product_variants.stock_updated_at');
    expect(r).toMatchObject({ recebidos: 6, criados: 0, atualizados: 1, sem_mudanca: 1 });
    expect(r.ignorados).toEqual([
      { codigo: '0706|XG', motivo: 'tamanho não encontrado na grade do app' },
      { codigo: '0999|M', motivo: 'produto não encontrado no app' },
      { codigo: '0706|P', motivo: '"quantidade" precisa ser um número inteiro' },
      { codigo: '706|M', motivo: 'repetido no lote' },
    ]);

    expect(onConflicts).toEqual(['company_id,erp_sku']);
    const linhas = linhasDe(fake.ultimaGravacao('product_variants', 'upsert'));
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({
      company_id: EMPRESA,
      erp_sku: '0706|M',
      product_id: 'p-1',
      size: 'M',
      stock_quantity: 12,
      stock_committed: 2,
    });
    expect(typeof linhas[0]!['stock_updated_at']).toBe('string');
    expect('active' in linhas[0]!).toBe(false);
    esperarSoColunasReais(linhas[0]!, 'product_variants', 49);
    expect(fake.filtrosDe('product_variants', 'eq').map((f) => f.args)).toContainEqual(['company_id', EMPRESA]);
    expect(r.avisos.some((a) => a.includes('0999') && a.includes('/produtos'))).toBe(true);
    expect(r.avisos.some((a) => a.includes('0706|XG'))).toBe(true);
  });

  it('reservado ausente mantém o comprometido; null zera; negativo é aceito como o ERP conta', async () => {
    const { service, fake } = await carregar({
      products: { data: [{ id: 'p-1', erp_id: '0706', sku: '0706' }], error: null },
      product_variants: emSequencia(
        { data: [{ ...GRADE_0706[0]!, stock_committed: 4 }, { ...GRADE_0706[1]!, stock_committed: 2 }], error: null },
        OK,
      ),
    });

    const r = await service.receberEstoque(EMPRESA, [
      { produto: '0706', tamanho: 'M', quantidade: -2 },
      { produto: '0706', tamanho: 'G', quantidade: 3, reservado: null },
    ]);

    expect(r).toMatchObject({ atualizados: 2, sem_mudanca: 0 });
    const linhas = linhasDe(fake.ultimaGravacao('product_variants', 'upsert'));
    expect(linhas.map((l) => [l['erp_sku'], l['stock_quantity'], l['stock_committed']])).toEqual([
      ['0706|M', -2, 4],
      ['0706|G', 3, 0],
    ]);
  });

  it('SEM a 049: grava o estoque sem stock_updated_at (só colunas reais) e avisa', async () => {
    const { service, fake } = await carregar(
      {
        products: { data: [{ id: 'p-1', erp_id: '0706', sku: '0706' }], error: null },
        product_variants: emSequencia({ data: GRADE_0706, error: null }, OK),
      },
      { com049: false },
    );

    const r = await service.receberEstoque(EMPRESA, [{ produto: '0706', tamanho: 'M', quantidade: 9 }]);

    expect(String(fake.filtrosDe('product_variants', 'select')[0]!.args[0])).not.toContain('stock_updated_at');
    const linha = linhasDe(fake.ultimaGravacao('product_variants', 'upsert'))[0]!;
    expect('stock_updated_at' in linha).toBe(false);
    esperarSoColunasReais(linha, 'product_variants', 48);
    expect(r.atualizados).toBe(1);
    expect(r.avisos).toContain(service.AVISO_SEM_049.estoque);
  });

  it('reenvio igual não grava nada; erro ao ler a grade LANÇA', async () => {
    const { service, fake } = await carregar({
      products: { data: [{ id: 'p-1', erp_id: '0706', sku: '0706' }], error: null },
      product_variants: { data: GRADE_0706, error: null },
    });

    const r = await service.receberEstoque(EMPRESA, [
      { produto: '0706', tamanho: 'M', quantidade: '5', reservado: 1 },
      { produto: '0706', tamanho: 'G', quantidade: 3 },
    ]);
    expect(r).toMatchObject({ atualizados: 0, sem_mudanca: 2, ignorados: [], avisos: [] });
    expect(fake.gravacoes).toHaveLength(0);

    vi.resetModules();
    const outro = await carregar({
      products: { data: [{ id: 'p-1', erp_id: '0706', sku: '0706' }], error: null },
      product_variants: { data: null, error: { message: 'timeout' } },
    });
    await expect(outro.service.receberEstoque(EMPRESA, [{ produto: '0706', tamanho: 'M', quantidade: 1 }])).rejects.toThrow(/timeout/);
    expect(outro.fake.gravacoes).toHaveLength(0);
  });
});

// ─── As rotas: porta, canal, corpo e registro ────────────────────────────────

function replyFalso() {
  const enviado: { status: number; corpo: unknown } = { status: 200, corpo: undefined };
  const reply = {
    status(codigo: number) {
      enviado.status = codigo;
      return reply;
    },
    code(codigo: number) {
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

function requisicao(body: unknown) {
  return { body, params: {}, query: {}, headers: { 'x-api-key': 'chave' } } as unknown as FastifyRequest & {
    partnerLog?: { company_id?: string | null; recebidos?: number; detalhe?: Record<string, unknown> | null } | null;
  };
}

const HANDLERS = [
  ['partnerTabelasPrecoHandler', 'receberTabelasDePreco', 'tabelas_preco'],
  ['partnerCondicoesPagamentoHandler', 'receberCondicoesDePagamento', 'condicoes_pagamento'],
  ['partnerProdutosHandler', 'receberProdutos', 'produtos'],
  ['partnerPrecosHandler', 'receberPrecos', 'precos'],
  ['partnerEstoqueHandler', 'receberEstoque', 'estoque'],
] as const;

type Handler = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

async function carregarRotas(canal: string) {
  const fake = criarSupabaseFake({
    companies: {
      data: {
        canal_pedido_erp: 'manual',
        canal_faturamento: 'manual',
        canal_cadastro: 'carga',
        canal_retrato: 'carga',
        canal_catalogo: canal,
      },
      error: null,
    },
  });
  vi.doMock(SUPABASE, () => ({ supabase: fake.cliente }));
  vi.doMock(AUTH, () => ({
    requirePartner: () => Promise.resolve({ name: 'control-teste', key: 'chave', company_id: EMPRESA }),
  }));
  const servicos: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const [, servico] of HANDLERS) {
    servicos[servico] = vi.fn().mockResolvedValue({ recebidos: 2, criados: 1, atualizados: 0, sem_mudanca: 1, ignorados: [], avisos: ['um aviso'] });
  }
  vi.doMock(SERVICE, () => ({ ...servicos, AVISO_SEM_049: {} }));
  const controller = (await import(CONTROLLER)) as Record<string, Handler>;
  return { controller, servicos, fake };
}

describe('as cinco rotas do catálogo', () => {
  it.each(HANDLERS)('%s com canal_catalogo = carga: 409 CANAL_FECHADO, sem chamar o serviço', async (handler, servico, chave) => {
    const { controller, servicos, fake } = await carregarRotas('carga');
    const { reply, enviado } = replyFalso();
    const req = requisicao({ [chave]: [{ codigo: '1' }] });

    await controller[handler]!(req, reply);

    expect(enviado.status).toBe(409);
    expect(enviado.corpo).toMatchObject({ code: 'CANAL_FECHADO', statusCode: 409, canal: 'catalogo', valor_atual: 'carga' });
    expect(servicos[servico]).not.toHaveBeenCalled();
    expect(fake.gravacoes).toEqual([]);
    expect(req.partnerLog).toMatchObject({ company_id: EMPRESA, detalhe: { code: 'CANAL_FECHADO' } });
  });

  it.each(HANDLERS)('%s com canal firebird também recusa', async (handler, servico) => {
    const { controller, servicos } = await carregarRotas('firebird');
    const { reply, enviado } = replyFalso();

    await controller[handler]!(requisicao([]), reply);

    expect(enviado.status).toBe(409);
    expect(enviado.corpo).toMatchObject({ code: 'CANAL_FECHADO', valor_atual: 'firebird' });
    expect(servicos[servico]).not.toHaveBeenCalled();
  });

  it.each(HANDLERS)('%s com canal api: chama o serviço pela chave do corpo e devolve os contadores', async (handler, servico, chave) => {
    const { controller, servicos } = await carregarRotas('api');
    const { reply, enviado } = replyFalso();
    const lista = [{ codigo: '1' }, { codigo: '2' }];
    const req = requisicao({ [chave]: lista });

    await controller[handler]!(req, reply);

    expect(enviado.status).toBe(200);
    expect(enviado.corpo).toMatchObject({ ok: true, recebidos: 2, criados: 1, atualizados: 0, sem_mudanca: 1, ignorados: [], avisos: ['um aviso'] });
    expect(typeof (enviado.corpo as { servidor_hora: unknown }).servidor_hora).toBe('string');
    expect(servicos[servico]).toHaveBeenCalledWith(EMPRESA, lista);
    expect(req.partnerLog).toMatchObject({ recebidos: 2, gravados: 1, sem_mudanca: 1, ignorados: 0, detalhe: { avisos: 1 } });
  });

  it('aceita { dados: [...] } e a lista pura no corpo', async () => {
    const { controller, servicos } = await carregarRotas('api');

    await controller['partnerEstoqueHandler']!(requisicao({ dados: [{ produto: '1' }] }), replyFalso().reply);
    await controller['partnerPrecosHandler']!(requisicao([{ produto: '2' }]), replyFalso().reply);

    expect(servicos['receberEstoque']).toHaveBeenCalledWith(EMPRESA, [{ produto: '1' }]);
    expect(servicos['receberPrecos']).toHaveBeenCalledWith(EMPRESA, [{ produto: '2' }]);
  });

  it('corpo sem lista é 400 INVALID_BODY (dizendo a chave); acima de 1000 é 400 BATCH_TOO_LARGE', async () => {
    const { controller, servicos } = await carregarRotas('api');

    const semLista = replyFalso();
    await controller['partnerTabelasPrecoHandler']!(requisicao({ tabela: 'x' }), semLista.reply);
    expect(semLista.enviado.status).toBe(400);
    expect(semLista.enviado.corpo).toMatchObject({ code: 'INVALID_BODY' });
    expect((semLista.enviado.corpo as { error: string }).error).toContain('tabelas_preco');

    const grande = replyFalso();
    const req = requisicao({ produtos: Array.from({ length: 1001 }, (_, i) => ({ codigo: String(i) })) });
    await controller['partnerProdutosHandler']!(req, grande.reply);
    expect(grande.enviado.status).toBe(400);
    expect(grande.enviado.corpo).toMatchObject({ code: 'BATCH_TOO_LARGE' });
    expect(req.partnerLog?.recebidos).toBe(1001);

    expect(servicos['receberTabelasDePreco']).not.toHaveBeenCalled();
    expect(servicos['receberProdutos']).not.toHaveBeenCalled();
  });

  it('banco sem resposta ao ler o canal: lança (500), sem chamar o serviço', async () => {
    const fake = criarSupabaseFake({ companies: { data: null, error: { message: 'tempo esgotado', code: '57014' } } });
    vi.doMock(SUPABASE, () => ({ supabase: fake.cliente }));
    vi.doMock(AUTH, () => ({
      requirePartner: () => Promise.resolve({ name: 'control-teste', key: 'chave', company_id: EMPRESA }),
    }));
    const receberEstoque = vi.fn();
    vi.doMock(SERVICE, () => ({
      receberTabelasDePreco: vi.fn(),
      receberCondicoesDePagamento: vi.fn(),
      receberProdutos: vi.fn(),
      receberPrecos: vi.fn(),
      receberEstoque,
      AVISO_SEM_049: {},
    }));
    const controller = (await import(CONTROLLER)) as Record<string, Handler>;

    await expect(controller['partnerEstoqueHandler']!(requisicao({ estoque: [] }), replyFalso().reply)).rejects.toThrow();
    expect(receberEstoque).not.toHaveBeenCalled();
  });
});
