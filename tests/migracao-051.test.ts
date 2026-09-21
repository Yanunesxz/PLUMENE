import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * A 051 (edição do cadastro do cliente) roda À MÃO, nos dois bancos, e o
 * código sobe antes dela. O que este teste tranca é o que só se descobre no SQL
 * Editor (ou pior, em produção):
 *
 *   • o arquivo de _tools é o MESMO SQL da migração e termina recarregando o
 *     cache do PostgREST;
 *   • é aditiva e reexecutável: só cria customer_changes, seus dois índices e
 *     liga a RLS — não mexe em coluna que o CRM lê;
 *   • customer_changes tem EXATAMENTE as colunas combinadas em 17/09/2026 — e é
 *     delas que o service lê (COLUNAS_DA_ALTERACAO) e que o conferir-051.mjs
 *     pergunta, nem uma a mais;
 *   • o conferir pergunta por GET (nunca HEAD) e nos DOIS bancos.
 */

const ler = (rel: string) => readFileSync(path.resolve(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n');

const MIGRACAO = ler('apps/api/src/config/migrations/051_edicao_do_cadastro_do_cliente.sql');
const PARA_RODAR = ler('_tools/SQL-PARA-RODAR-051.sql');
const CONFERIR = ler('_tools/conferir-051.mjs');
const SERVICO = ler('apps/api/src/modules/customers/customers.alteracoes.service.ts');

const NOTIFY = "NOTIFY pgrst, 'reload schema';";

/** As colunas de customer_changes combinadas em 17/09/2026, na ordem do SQL. */
const COLUNAS_DE_CUSTOMER_CHANGES: Record<string, string> = {
  id: 'UUID PRIMARY KEY DEFAULT gen_random_uuid()',
  company_id: 'UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE',
  customer_id: 'UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE',
  alterado_por: 'UUID REFERENCES users(id) ON DELETE SET NULL',
  alterado_por_nome: 'TEXT',
  alterado_em: 'TIMESTAMPTZ NOT NULL DEFAULT now()',
  campos: 'JSONB NOT NULL',
  erp_pendente: 'BOOLEAN NOT NULL DEFAULT false',
  erp_atualizado_em: 'TIMESTAMPTZ',
  erp_atualizado_por: 'UUID REFERENCES users(id) ON DELETE SET NULL',
  erp_atualizado_por_nome: 'TEXT',
  erp_atualizado_via: "TEXT CHECK (erp_atualizado_via IN ('app', 'api'))",
};

const semComentarios = (sql: string) =>
  sql
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');

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

function colunasDoConferir(codigo: string): Record<string, string[]> {
  const bloco = /const colunas = \{([\s\S]*?)\n\};/.exec(codigo)?.[1];
  if (!bloco) throw new Error('conferir-051.mjs sem o objeto `colunas`');
  const semJs = bloco.replace(/\/\/.*$/gm, '');
  const saida: Record<string, string[]> = {};
  for (const m of semJs.matchAll(/(\w+):\s*\[([^\]]*)\]/g)) {
    saida[m[1]!] = [...m[2]!.matchAll(/'([^']+)'/g)].map((c) => c[1]!);
  }
  return saida;
}

describe('migração 051', () => {
  it('o SQL de _tools é o da migração, para os dois bancos, e termina com o NOTIFY', () => {
    const inicio = MIGRACAO.indexOf('-- ─── A. O histórico das edições do cadastro');
    const fim = MIGRACAO.indexOf(NOTIFY) + NOTIFY.length;
    expect(inicio).toBeGreaterThan(0);
    expect(fim).toBeGreaterThan(inicio);
    expect(PARA_RODAR).toContain(MIGRACAO.slice(inicio, fim));
    expect(PARA_RODAR.trimEnd().endsWith(NOTIFY)).toBe(true);
    expect(PARA_RODAR).toMatch(/nos DOIS bancos/);
    expect(PARA_RODAR).toMatch(/conferir-051\.mjs/);
    expect(semComentarios(PARA_RODAR).trim()).toBe(semComentarios(MIGRACAO.slice(inicio, fim)).trim());
  });

  it('é aditiva e reexecutável', () => {
    const sql = semComentarios(MIGRACAO);
    expect(sql).not.toMatch(/DROP\s/i);
    expect(sql).not.toMatch(/RENAME/i);
    expect(sql).not.toMatch(/\bUPDATE\s+\w+\s+SET\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/CREATE\s+TRIGGER/i);
    expect(sql).not.toMatch(/ALTER\s+COLUMN/i);
    expect(sql).not.toMatch(/ADD\s+COLUMN/i);
    for (const m of sql.matchAll(/CREATE\s+(UNIQUE\s+)?(TABLE|INDEX)\s+(\S+)/gi)) {
      expect(m[3]).toMatch(/^IF$/i);
    }
    const criadas = [...sql.matchAll(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(\w+)/gi)].map((m) => m[1]);
    expect(criadas).toEqual(['customer_changes']);
    const alteradas = [...sql.matchAll(/ALTER\s+TABLE\s+(\w+)/gi)].map((m) => m[1]);
    expect(alteradas).toEqual(['customer_changes']);
  });

  it('customer_changes tem exatamente as colunas combinadas em 17/09/2026', () => {
    expect(colunasDaTabela(MIGRACAO, 'customer_changes')).toEqual(COLUNAS_DE_CUSTOMER_CHANGES);
  });

  it('os dois índices (o da ficha e o parcial da fila) e a RLS', () => {
    const sql = semComentarios(MIGRACAO);
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_customer_changes_do_cliente\s+ON customer_changes \(company_id, customer_id, alterado_em DESC\);/,
    );
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_customer_changes_pendentes\s+ON customer_changes \(company_id, customer_id\)\s+WHERE erp_pendente AND erp_atualizado_em IS NULL;/,
    );
    expect(sql).toContain('ALTER TABLE customer_changes ENABLE ROW LEVEL SECURITY;');
    expect(sql.trimEnd().indexOf(NOTIFY)).toBeGreaterThan(sql.indexOf('ENABLE ROW LEVEL SECURITY'));
  });

  it('o service lê as colunas da tabela (todas, menos a empresa, que já vem no filtro)', () => {
    const lista = /COLUNAS_DA_ALTERACAO =\s*'([^']+)'/.exec(SERVICO)?.[1];
    expect(lista?.split(',').map((c) => c.trim())).toEqual(
      Object.keys(COLUNAS_DE_CUSTOMER_CHANGES).filter((c) => c !== 'company_id'),
    );
  });
});

describe('conferir-051.mjs', () => {
  it('pergunta por GET com limit(0): nunca HEAD, nunca linhas, nunca grava', () => {
    const codigo = CONFERIR.replace(/\/\/.*$/gm, '');
    expect(codigo).toContain('.limit(0)');
    expect(codigo).not.toMatch(/head\s*:\s*true/);
    expect(codigo).not.toMatch(/\.limit\((?!0\))/);
    expect(codigo).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
  });

  it('confere os DOIS bancos por padrão: o deste app e o da PLUMENE', () => {
    expect(CONFERIR).toContain("path.resolve(import.meta.dirname, '..')");
    expect(CONFERIR).toContain('C:/Users/Yan/Desktop/PLUMENE');
    expect(CONFERIR).toContain('apps/api/.env');
  });

  it('pergunta por todas as colunas de customer_changes, e só por elas', () => {
    expect(colunasDoConferir(CONFERIR)).toEqual({
      customer_changes: Object.keys(COLUNAS_DE_CUSTOMER_CHANGES),
    });
  });
});
