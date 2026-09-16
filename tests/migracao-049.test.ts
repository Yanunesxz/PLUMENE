import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { TIPOS_DE_EVENTO_ERP } from '../apps/api/src/modules/orders/eventosErp.service.js';

/**
 * A 049 roda À MÃO, nos dois bancos, depois da 048, e o código sobe antes
 * dela. O que este teste tranca é o que só se descobre no SQL Editor (ou pior,
 * em produção):
 *
 *   • o arquivo de _tools é o MESMO SQL da migração e termina recarregando o
 *     cache do PostgREST;
 *   • a migração é aditiva e reexecutável, e não mexe em coluna que o CRM lê;
 *   • as colunas são EXATAMENTE as combinadas com o Yan em 16/09/2026 — e o
 *     conferir-049.mjs pergunta por todas elas, nem uma a mais;
 *   • o CHECK de tipo do rastro é a lista da 048 mais os três acontecimentos
 *     novos, nesta ordem, e é o começo da lista que o código grava (a lista
 *     inteira passou a ser a da 050, que a recriou com um tipo a mais);
 *   • toda chave estrangeira nova é ON DELETE SET NULL: apagar um login ou
 *     uma nota nunca apaga um pedido, uma empresa ou outra nota;
 *   • nenhum status novo em orders.status.
 */

const ler = (rel: string) => readFileSync(path.resolve(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n');

const MIGRACAO = ler('apps/api/src/config/migrations/049_integracao_control_respostas.sql');
const MIGRACAO_048 = ler('apps/api/src/config/migrations/048_integracao_control_fase_0.sql');
const MIGRACAO_028 = ler('apps/api/src/config/migrations/028_condicoes_de_pagamento.sql');
const MIGRACAO_050 = ler('apps/api/src/config/migrations/050_cliente_excluido_e_solicitacao.sql');
const PARA_RODAR = ler('_tools/SQL-PARA-RODAR-049.sql');
const CONFERIR = ler('_tools/conferir-049.mjs');

const NOTIFY = "NOTIFY pgrst, 'reload schema';";

/** As colunas combinadas com o Yan em 16/09/2026, tabela por tabela, na ordem do SQL. */
const COLUNAS_DA_049: Record<string, string[]> = {
  orders: ['erp_requested_at', 'erp_requested_by'],
  users: ['erp_email'],
  order_invoices: ['substituida_por', 'substituida_em'],
  companies: ['sync_solicitado_em', 'sync_solicitado_por'],
  customers: [
    'erp_updated_at',
    'retrato_referencia_em',
    'pendencia_financeira',
    'pendencia_financeira_em',
    'titulos_vencidos',
  ],
  price_tables: ['erp_description', 'erp_updated_at', 'active'],
  payment_conditions: ['erp_description', 'erp_updated_at', 'valor_minimo'],
  products: ['erp_updated_at'],
  product_variants: ['stock_updated_at'],
  product_prices: ['erp_updated_at', 'preco_original', 'desconto_percentual'],
};

const TIPOS_NOVOS = ['solicitado_ao_erp', 'nota_substituida', 'excluido_pelo_erp'];

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

/** Tabela → colunas que a migração acrescenta (ADD COLUMN IF NOT EXISTS), na ordem. */
function colunasAdicionadas(sql: string): Record<string, string[]> {
  const saida: Record<string, string[]> = {};
  for (const m of semComentarios(sql).matchAll(/ALTER\s+TABLE\s+(\w+)\s+([^;]*);/gi)) {
    const colunas = [...m[2]!.matchAll(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+(\w+)/gi)].map((c) => c[1]!);
    if (colunas.length === 0) continue;
    const tabela = m[1]!;
    saida[tabela] = [...(saida[tabela] ?? []), ...colunas];
  }
  return saida;
}

/** Tabela → colunas que o conferir-049.mjs pergunta (o objeto `colunas`). */
function colunasDoConferir(codigo: string): Record<string, string[]> {
  const bloco = /const colunas = \{([\s\S]*?)\n\};/.exec(codigo)?.[1];
  if (!bloco) throw new Error('conferir-049.mjs sem o objeto `colunas`');
  const semJs = bloco.replace(/\/\/.*$/gm, '');
  const saida: Record<string, string[]> = {};
  for (const m of semJs.matchAll(/(\w+):\s*\[([^\]]*)\]/g)) {
    saida[m[1]!] = [...m[2]!.matchAll(/'([^']+)'/g)].map((c) => c[1]!);
  }
  return saida;
}

describe('migração 049', () => {
  it('o SQL de _tools é o da migração, avisa que vem depois da 048 e termina com o NOTIFY', () => {
    const inicio = MIGRACAO.indexOf('-- ─── 0. A 048 precisa estar aplicada');
    const fim = MIGRACAO.indexOf(NOTIFY) + NOTIFY.length;
    expect(inicio).toBeGreaterThan(0);
    expect(fim).toBeGreaterThan(inicio);
    expect(PARA_RODAR).toContain(MIGRACAO.slice(inicio, fim));
    expect(PARA_RODAR.trimEnd().endsWith(NOTIFY)).toBe(true);
    expect(PARA_RODAR).toMatch(/nos DOIS bancos/);
    expect(PARA_RODAR).toMatch(/DEPOIS da 048/);
    expect(PARA_RODAR).toMatch(/conferir-049\.mjs/);
  });

  it('para ANTES de mudar qualquer coisa se a 048 não rodou, e diz o que falta', () => {
    const sql = semComentarios(MIGRACAO);
    const trava = sql.indexOf("to_regclass('public.order_invoices')");
    expect(trava).toBeGreaterThan(-1);
    expect(sql.indexOf("to_regclass('public.order_erp_events')")).toBeGreaterThan(-1);
    expect(trava).toBeLessThan(sql.search(/ALTER\s+TABLE/i));
    expect(sql).toMatch(/RAISE EXCEPTION '[^']*048[^']*'/);
  });

  it('é aditiva e reexecutável', () => {
    const sql = semComentarios(MIGRACAO);
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN|INDEX|FUNCTION|TRIGGER)/i);
    expect(sql).not.toMatch(/RENAME/i);
    expect(sql).not.toMatch(/\bUPDATE\s+\w+\s+SET\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/\bINSERT\s+INTO\b/i);
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

  it('não mexe em coluna que o CRM lê, nem em orders.status', () => {
    const sql = semComentarios(MIGRACAO);
    expect(sql).not.toMatch(/ALTER\s+COLUMN/i);
    expect(sql).not.toMatch(/\bstatus\b/i);
    const alteradas = [...sql.matchAll(/ALTER\s+TABLE\s+(\w+)/gi)].map((m) => m[1]);
    expect(new Set(alteradas)).toEqual(new Set([...Object.keys(COLUNAS_DA_049), 'order_erp_events']));
    // A única trava que a 049 recria é a lista de tipos do rastro.
    const recriadas = [...sql.matchAll(/DROP\s+CONSTRAINT\s+IF\s+EXISTS\s+(\w+)/gi)].map((m) => m[1]);
    expect(recriadas).toEqual(['chk_order_erp_events_tipo']);
  });

  it('as colunas são exatamente as combinadas em 16/09/2026', () => {
    expect(colunasAdicionadas(MIGRACAO)).toEqual(COLUNAS_DA_049);
  });

  it('payment_conditions.active vem da 028; price_tables.active só entra se não existir', () => {
    expect(colunasAdicionadas(MIGRACAO)['payment_conditions']).not.toContain('active');
    expect(MIGRACAO_028).toMatch(/active\s+BOOLEAN NOT NULL DEFAULT true/);
    expect(semComentarios(MIGRACAO)).toMatch(
      /ADD COLUMN IF NOT EXISTS active\s+BOOLEAN NOT NULL DEFAULT true/,
    );
  });

  it('a fila do parceiro tem índice parcial por empresa: solicitado e ainda sem número', () => {
    expect(semComentarios(MIGRACAO)).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_orders_solicitados_ao_erp\s+ON orders \(company_id\)\s+WHERE erp_requested_at IS NOT NULL AND erp_order_id IS NULL;/,
    );
  });

  it('toda chave estrangeira nova é ON DELETE SET NULL', () => {
    const refs = [...semComentarios(MIGRACAO).matchAll(/REFERENCES\s+(\w+)\(id\)([^,;]*)/gi)];
    expect(refs.map((r) => r[1])).toEqual(['users', 'order_invoices', 'users']);
    for (const r of refs) expect(r[2]).toMatch(/ON DELETE SET NULL/);
    // O que aponta para users: quem solicitou o lançamento e quem pediu a sincronização.
    expect(semComentarios(MIGRACAO)).toMatch(/erp_requested_by UUID REFERENCES users\(id\) ON DELETE SET NULL/);
    expect(semComentarios(MIGRACAO)).toMatch(/sync_solicitado_por UUID REFERENCES users\(id\) ON DELETE SET NULL/);
    expect(semComentarios(MIGRACAO)).toMatch(
      /substituida_por UUID REFERENCES order_invoices\(id\) ON DELETE SET NULL/,
    );
  });

  it('o CHECK de tipo do rastro é a lista da 048 mais os três novos, e é o começo da do código', () => {
    const da048 = listaDoCheck(MIGRACAO_048, 'chk_order_erp_events_tipo');
    const da049 = listaDoCheck(MIGRACAO, 'chk_order_erp_events_tipo');
    expect(da049).toEqual([...da048, ...TIPOS_NOVOS]);
    // A 050 recriou este CHECK com 'solicitacao_cancelada' no fim: a lista
    // inteira do código é a dela (tests/migracao-050.test.ts), e a daqui é o
    // começo — nenhum tipo da 049 saiu nem mudou de lugar.
    expect(TIPOS_DE_EVENTO_ERP.slice(0, da049.length)).toEqual(da049);
    expect(listaDoCheck(MIGRACAO_050, 'chk_order_erp_events_tipo').slice(0, da049.length)).toEqual(da049);
    // A origem do evento não muda: a 049 não recria essa trava.
    expect(() => listaDoCheck(MIGRACAO, 'chk_order_erp_events_origem')).toThrow();
  });
});

describe('conferir-049.mjs', () => {
  it('pergunta por GET com limit(0): nunca HEAD, nunca linhas, nunca grava', () => {
    const codigo = CONFERIR.replace(/\/\/.*$/gm, '');
    expect(codigo).toContain('.limit(0)');
    expect(codigo).not.toMatch(/head\s*:\s*true/);
    expect(codigo).not.toMatch(/\.limit\((?!0\))/);
    expect(codigo).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
    expect(codigo).toContain('process.argv[2]');
  });

  it('pergunta por todas as colunas da 049, e só por elas', () => {
    expect(colunasDoConferir(CONFERIR)).toEqual(COLUNAS_DA_049);
  });
});
