import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { TIPOS_DE_EVENTO_ERP } from '../apps/api/src/modules/orders/eventosErp.service.js';

/**
 * A 050 roda À MÃO, nos dois bancos, depois da 049, e o código sobe antes
 * dela. O que este teste tranca é o que só se descobre no SQL Editor (ou pior,
 * em produção):
 *
 *   • o arquivo de _tools é o MESMO SQL da migração e termina recarregando o
 *     cache do PostgREST;
 *   • a migração para antes de mudar qualquer coisa se a 049 não rodou;
 *   • é aditiva e reexecutável, e não mexe em coluna que o CRM lê nem em
 *     orders.status — só cria deleted_customers e recria o CHECK de tipo;
 *   • deleted_customers tem EXATAMENTE as colunas combinadas com o Yan em
 *     16/09/2026 (tipo, nulidade, padrão e chave estrangeira de cada uma) — e o
 *     conferir-050.mjs pergunta por todas elas, nem uma a mais;
 *   • customer_id e juntado_em não têm chave estrangeira: o rastro sobrevive à
 *     exclusão do cliente e à do cadastro que ficou;
 *   • o CHECK de tipo do rastro é a lista da 049 mais 'solicitacao_cancelada',
 *     e é a lista inteira que o código grava (a fonte passou a ser esta).
 */

const ler = (rel: string) => readFileSync(path.resolve(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n');

const MIGRACAO = ler('apps/api/src/config/migrations/050_cliente_excluido_e_solicitacao.sql');
const MIGRACAO_049 = ler('apps/api/src/config/migrations/049_integracao_control_respostas.sql');
const PARA_RODAR = ler('_tools/SQL-PARA-RODAR-050.sql');
const CONFERIR = ler('_tools/conferir-050.mjs');
const ESTRUTURA = ler('ESTRUTURA.md');

const NOTIFY = "NOTIFY pgrst, 'reload schema';";

/**
 * As colunas de deleted_customers combinadas com o Yan em 16/09/2026, na ordem
 * do SQL, cada uma com a definição inteira (espaços normalizados).
 */
const COLUNAS_DE_DELETED_CUSTOMERS: Record<string, string> = {
  id: 'UUID PRIMARY KEY DEFAULT gen_random_uuid()',
  company_id: 'UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE',
  customer_id: 'UUID NOT NULL',
  erp_id: 'TEXT',
  cnpj_digits: 'TEXT',
  juntado_em: 'UUID',
  snapshot: 'JSONB NOT NULL',
  pedidos_movidos: 'INTEGER NOT NULL DEFAULT 0',
  deleted_at: 'TIMESTAMPTZ NOT NULL DEFAULT now()',
  deleted_by: 'UUID REFERENCES users(id) ON DELETE SET NULL',
  deleted_by_name: 'TEXT',
  motivo: 'TEXT',
  created_at: 'TIMESTAMPTZ NOT NULL DEFAULT now()',
  updated_at: 'TIMESTAMPTZ NOT NULL DEFAULT now()',
};

const TIPO_NOVO = 'solicitacao_cancelada';

/** O SQL sem os comentários de linha, para as conferências não casarem com texto explicativo. */
const semComentarios = (sql: string) =>
  sql
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');

/** A lista de um CHECK ... IN (...) pelo nome da trava. */
function listaDoCheck(sql: string, trava: string): string[] {
  const re = new RegExp(`${trava}\\s+CHECK\\s*\\(([\\s\\S]*?)\\)\\s*(?:NOT VALID)?\\s*;`);
  const m = re.exec(semComentarios(sql));
  if (!m) throw new Error(`trava ${trava} não encontrada`);
  const dentro = /IN\s*\(([^)]*)\)/.exec(m[1]!);
  if (!dentro) throw new Error(`trava ${trava} sem lista IN`);
  return [...dentro[1]!.matchAll(/'([^']*)'/g)].map((x) => x[1]!);
}

/** Coluna → definição (espaços normalizados) de um CREATE TABLE IF NOT EXISTS, na ordem. */
function colunasDaTabela(sql: string, tabela: string): Record<string, string> {
  const corpo = new RegExp(`CREATE TABLE IF NOT EXISTS ${tabela} \\(([\\s\\S]*?)\\n\\);`).exec(semComentarios(sql))?.[1];
  if (!corpo) throw new Error(`CREATE TABLE ${tabela} não encontrado`);
  const saida: Record<string, string> = {};
  for (const linha of corpo.split('\n')) {
    const limpa = linha.trim().replace(/,$/, '').replace(/\s+/g, ' ');
    if (!limpa) continue;
    const [nome, ...resto] = limpa.split(' ');
    saida[nome!] = resto.join(' ');
  }
  return saida;
}

/** Tabela → colunas que o conferir-050.mjs pergunta (o objeto `colunas`). */
function colunasDoConferir(codigo: string): Record<string, string[]> {
  const bloco = /const colunas = \{([\s\S]*?)\n\};/.exec(codigo)?.[1];
  if (!bloco) throw new Error('conferir-050.mjs sem o objeto `colunas`');
  const semJs = bloco.replace(/\/\/.*$/gm, '');
  const saida: Record<string, string[]> = {};
  for (const m of semJs.matchAll(/(\w+):\s*\[([^\]]*)\]/g)) {
    saida[m[1]!] = [...m[2]!.matchAll(/'([^']+)'/g)].map((c) => c[1]!);
  }
  return saida;
}

describe('migração 050', () => {
  it('o SQL de _tools é o da migração, avisa que vem depois da 049 e termina com o NOTIFY', () => {
    const inicio = MIGRACAO.indexOf('-- ─── 0. A 049 precisa estar aplicada');
    const fim = MIGRACAO.indexOf(NOTIFY) + NOTIFY.length;
    expect(inicio).toBeGreaterThan(0);
    expect(fim).toBeGreaterThan(inicio);
    expect(PARA_RODAR).toContain(MIGRACAO.slice(inicio, fim));
    expect(PARA_RODAR.trimEnd().endsWith(NOTIFY)).toBe(true);
    expect(PARA_RODAR).toMatch(/nos DOIS bancos/);
    expect(PARA_RODAR).toMatch(/DEPOIS da 049/);
    expect(PARA_RODAR).toMatch(/conferir-050\.mjs/);
    // Fora o cabeçalho, nada além do corpo da migração: nenhum SQL a mais.
    expect(semComentarios(PARA_RODAR).trim()).toBe(semComentarios(MIGRACAO.slice(inicio, fim)).trim());
  });

  it('para ANTES de mudar qualquer coisa se a 049 não rodou, e diz o que falta', () => {
    const sql = semComentarios(MIGRACAO);
    const trava = sql.indexOf("to_regclass('public.order_erp_events')");
    expect(trava).toBeGreaterThan(-1);
    expect(sql).toMatch(/table_name\s*=\s*'orders'\s+AND column_name\s*=\s*'erp_requested_at'/);
    expect(trava).toBeLessThan(sql.search(/CREATE\s+TABLE/i));
    expect(trava).toBeLessThan(sql.search(/ALTER\s+TABLE/i));
    expect(sql).toMatch(/RAISE EXCEPTION '[^']*049[^']*'/);
    expect(sql).toMatch(/RAISE EXCEPTION '[^']*SQL-PARA-RODAR-049\.sql[^']*'/);
  });

  it('é aditiva e reexecutável', () => {
    const sql = semComentarios(MIGRACAO);
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN|INDEX|FUNCTION|TRIGGER)/i);
    expect(sql).not.toMatch(/RENAME/i);
    expect(sql).not.toMatch(/\bUPDATE\s+\w+\s+SET\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/CREATE\s+TRIGGER/i);
    for (const m of sql.matchAll(/CREATE\s+(UNIQUE\s+)?(TABLE|INDEX)\s+(\S+)/gi)) {
      expect(m[3]).toMatch(/^IF$/i);
    }
    for (const m of sql.matchAll(/ADD\s+COLUMN\s+(\S+)/gi)) {
      expect(m[1]).toMatch(/^IF$/i);
    }
    // Toda trava ou é guardada por pg_constraint ou é recriada (DROP IF EXISTS antes).
    for (const m of sql.matchAll(/ADD\s+CONSTRAINT\s+(\w+)/gi)) {
      const nome = m[1]!;
      const guardada = sql.includes(`conname = '${nome}'`) || sql.includes(`DROP CONSTRAINT IF EXISTS ${nome}`);
      expect({ nome, guardada }).toEqual({ nome, guardada: true });
    }
  });

  it('não mexe em coluna que o CRM lê, nem em orders.status: só cria deleted_customers e recria o CHECK de tipo', () => {
    const sql = semComentarios(MIGRACAO);
    expect(sql).not.toMatch(/ALTER\s+COLUMN/i);
    expect(sql).not.toMatch(/ADD\s+COLUMN/i);
    expect(sql).not.toMatch(/\bstatus\b/i);
    const criadas = [...sql.matchAll(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(\w+)/gi)].map((m) => m[1]);
    expect(criadas).toEqual(['deleted_customers']);
    const alteradas = [...sql.matchAll(/ALTER\s+TABLE\s+(\w+)/gi)].map((m) => m[1]);
    expect(new Set(alteradas)).toEqual(new Set(['deleted_customers', 'order_erp_events']));
    // A única trava que a 050 recria é a lista de tipos do rastro.
    const recriadas = [...sql.matchAll(/DROP\s+CONSTRAINT\s+IF\s+EXISTS\s+(\w+)/gi)].map((m) => m[1]);
    expect(recriadas).toEqual(['chk_order_erp_events_tipo']);
    const indices = [...sql.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+(\w+)\s+ON\s+(\w+)/gi)];
    expect(indices.map((m) => m[2])).toEqual(['deleted_customers']);
  });

  it('deleted_customers tem exatamente as colunas combinadas em 16/09/2026', () => {
    const colunas = colunasDaTabela(MIGRACAO, 'deleted_customers');
    expect(Object.keys(colunas)).toEqual(Object.keys(COLUNAS_DE_DELETED_CUSTOMERS));
    expect(colunas).toEqual(COLUNAS_DE_DELETED_CUSTOMERS);
  });

  it('customer_id e juntado_em sem chave estrangeira: o rastro sobrevive à exclusão dos dois cadastros', () => {
    const colunas = colunasDaTabela(MIGRACAO, 'deleted_customers');
    expect(colunas['customer_id']).not.toMatch(/REFERENCES/);
    expect(colunas['juntado_em']).not.toMatch(/REFERENCES/);
    expect(colunas['juntado_em']).not.toMatch(/NOT NULL/);
    // Só duas chaves estrangeiras: a empresa (CASCADE) e quem excluiu (SET NULL).
    const refs = [...semComentarios(MIGRACAO).matchAll(/REFERENCES\s+(\w+)\(id\)\s+ON DELETE\s+(CASCADE|SET NULL)/gi)];
    expect(refs.map((r) => [r[1], r[2]])).toEqual([
      ['companies', 'CASCADE'],
      ['users', 'SET NULL'],
    ]);
    expect([...semComentarios(MIGRACAO).matchAll(/REFERENCES/gi)]).toHaveLength(2);
  });

  it('índice por empresa, os mais recentes primeiro, e RLS ligada', () => {
    expect(semComentarios(MIGRACAO)).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_deleted_customers_da_empresa\s+ON deleted_customers \(company_id, deleted_at DESC\);/,
    );
    expect(semComentarios(MIGRACAO)).toContain('ALTER TABLE deleted_customers ENABLE ROW LEVEL SECURITY;');
  });

  it("o CHECK de tipo do rastro é a lista da 049 mais 'solicitacao_cancelada', e é a do código", () => {
    const da049 = listaDoCheck(MIGRACAO_049, 'chk_order_erp_events_tipo');
    const da050 = listaDoCheck(MIGRACAO, 'chk_order_erp_events_tipo');
    expect(da050).toEqual([...da049, TIPO_NOVO]);
    expect(da050).toEqual([...TIPOS_DE_EVENTO_ERP]);
    expect(new Set(da050).size).toBe(da050.length);
    // A origem do evento não muda: a 050 não recria essa trava.
    expect(() => listaDoCheck(MIGRACAO, 'chk_order_erp_events_origem')).toThrow();
  });

  it('ESTRUTURA.md registra a 050 e o arquivo para os dois bancos', () => {
    expect(ESTRUTURA).toContain('050_cliente_excluido_e_solicitacao.sql');
    expect(ESTRUTURA).toContain('SQL-PARA-RODAR-050.sql');
    expect(ESTRUTURA).toContain('conferir-050');
  });
});

describe('conferir-050.mjs', () => {
  it('pergunta por GET com limit(0): nunca HEAD, nunca linhas, nunca grava', () => {
    const codigo = CONFERIR.replace(/\/\/.*$/gm, '');
    expect(codigo).toContain('.limit(0)');
    expect(codigo).not.toMatch(/head\s*:\s*true/);
    expect(codigo).not.toMatch(/\.limit\((?!0\))/);
    expect(codigo).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
    expect(codigo).toContain('process.argv[2]');
  });

  it('pergunta por todas as colunas de deleted_customers, e só por elas', () => {
    expect(colunasDoConferir(CONFERIR)).toEqual({
      deleted_customers: Object.keys(COLUNAS_DE_DELETED_CUSTOMERS),
    });
  });
});
