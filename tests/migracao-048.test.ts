import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { VALORES_DOS_CANAIS } from '../apps/api/src/lib/canais.js';
import {
  TIPOS_DE_EVENTO_ERP,
  ORIGENS_DE_EVENTO_ERP,
  ORIGENS_DO_NUMERO,
} from '../apps/api/src/modules/orders/eventosErp.service.js';

/**
 * A 048 roda À MÃO, nos dois bancos, e o código sobe antes dela. O que este
 * teste tranca é o que só se descobre no SQL Editor (ou pior, em produção):
 *
 *   • o arquivo de _tools é o MESMO SQL da migração e termina recarregando o
 *     cache do PostgREST (sem isso a 046 ficou invisível por quatro dias);
 *   • a migração é aditiva e reexecutável;
 *   • as listas dos CHECKs são as mesmas que o código grava — um valor que o
 *     código manda e o banco recusa vira evento perdido ou canal que nunca liga;
 *   • o arquivo do passo 1 leva a 013 inteira e o índice da 042.
 */

const ler = (rel: string) => readFileSync(path.resolve(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n');

const MIGRACAO = ler('apps/api/src/config/migrations/048_integracao_control_fase_0.sql');
const PARA_RODAR = ler('_tools/SQL-PARA-RODAR-048.sql');
const PASSO_1 = ler('_tools/SQL-PARA-RODAR-013-042-NA-CS.sql');
const MIGRACAO_013 = ler('apps/api/src/config/migrations/013_protecoes.sql');
const CONFERIR = ler('_tools/conferir-048.mjs');

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

describe('migração 048', () => {
  it('o SQL de _tools é o da migração e termina com o NOTIFY', () => {
    const inicio = MIGRACAO.indexOf('-- ─── A. erp_sync_log');
    const notify = "NOTIFY pgrst, 'reload schema';";
    const fim = MIGRACAO.indexOf(notify) + notify.length;
    expect(inicio).toBeGreaterThan(0);
    expect(fim).toBeGreaterThan(inicio);
    expect(PARA_RODAR).toContain(MIGRACAO.slice(inicio, fim));
    expect(PARA_RODAR.trimEnd().endsWith(notify)).toBe(true);
    expect(PARA_RODAR).toMatch(/nos DOIS bancos/);
  });

  it('é aditiva e reexecutável', () => {
    const sql = semComentarios(MIGRACAO);
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN|INDEX|FUNCTION|TRIGGER)/i);
    expect(sql).not.toMatch(/RENAME/i);
    expect(sql).not.toMatch(/\bUPDATE\s+\w+\s+SET\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    for (const m of sql.matchAll(/CREATE\s+(UNIQUE\s+)?(TABLE|INDEX)\s+(\S+)/gi)) {
      expect(m[3]).toMatch(/^IF$/i);
    }
    for (const m of sql.matchAll(/ADD\s+COLUMN\s+(\S+)/gi)) {
      expect(m[1]).toMatch(/^IF$/i);
    }
    // Toda trava nova ou é guardada por pg_constraint ou é recriada (DROP IF EXISTS antes).
    for (const m of sql.matchAll(/ADD\s+CONSTRAINT\s+(\w+)/gi)) {
      const nome = m[1]!;
      const guardada = sql.includes(`conname = '${nome}'`) || sql.includes(`DROP CONSTRAINT IF EXISTS ${nome}`);
      expect({ nome, guardada }).toEqual({ nome, guardada: true });
    }
  });

  it('não mexe em coluna que o CRM lê', () => {
    const sql = semComentarios(MIGRACAO);
    expect(sql).not.toMatch(/ALTER\s+COLUMN\s+(?!updated_at\s+SET\s+DEFAULT)/i);
    const alteradas = [...sql.matchAll(/ALTER\s+TABLE\s+(\w+)/gi)].map((m) => m[1]);
    expect(new Set(alteradas)).toEqual(
      new Set(['erp_sync_log', 'companies', 'orders', 'order_erp_events', 'price_tables', 'users', 'order_invoices', 'order_invoice_items']),
    );
  });

  it('as listas dos canais são as do código', () => {
    expect(listaDoCheck(MIGRACAO, 'chk_companies_canal_pedido_erp')).toEqual([...VALORES_DOS_CANAIS.pedido_erp]);
    expect(listaDoCheck(MIGRACAO, 'chk_companies_canal_faturamento')).toEqual([...VALORES_DOS_CANAIS.faturamento]);
    expect(listaDoCheck(MIGRACAO, 'chk_companies_canal_cadastro')).toEqual([...VALORES_DOS_CANAIS.cadastro]);
    expect(listaDoCheck(MIGRACAO, 'chk_companies_canal_retrato')).toEqual([...VALORES_DOS_CANAIS.retrato]);
    expect(listaDoCheck(MIGRACAO, 'chk_companies_canal_catalogo')).toEqual([...VALORES_DOS_CANAIS.catalogo]);
  });

  it('os padrões dos canais no banco são os padrões do código', () => {
    const padrao = (coluna: string) => new RegExp(`${coluna}\\s+TEXT NOT NULL DEFAULT '([^']+)'`).exec(MIGRACAO)?.[1];
    expect(padrao('canal_pedido_erp')).toBe('manual');
    expect(padrao('canal_faturamento')).toBe('manual');
    expect(padrao('canal_cadastro')).toBe('carga');
    expect(padrao('canal_retrato')).toBe('carga');
    expect(padrao('canal_catalogo')).toBe('carga');
  });

  it('as listas do rastro são as do código', () => {
    expect(listaDoCheck(MIGRACAO, 'chk_order_erp_events_tipo')).toEqual([...TIPOS_DE_EVENTO_ERP]);
    expect(listaDoCheck(MIGRACAO, 'chk_order_erp_events_origem')).toEqual([...ORIGENS_DE_EVENTO_ERP]);
    expect(listaDoCheck(MIGRACAO, 'chk_orders_erp_order_source')).toEqual([...ORIGENS_DO_NUMERO]);
  });

  it('order_erp_events sobrevive à exclusão do pedido (order_id sem FK); as notas não', () => {
    const eventos = /CREATE TABLE IF NOT EXISTS order_erp_events \(([\s\S]*?)\n\);/.exec(MIGRACAO)?.[1] ?? '';
    expect(eventos).toMatch(/order_id\s+UUID NOT NULL,/);
    expect(eventos).not.toMatch(/order_id[^\n]*REFERENCES/);
    const notas = /CREATE TABLE IF NOT EXISTS order_invoices \(([\s\S]*?)\n\);/.exec(MIGRACAO)?.[1] ?? '';
    expect(notas).toMatch(/order_id\s+UUID NOT NULL REFERENCES orders\(id\) ON DELETE CASCADE/);
    expect(notas).toMatch(/UNIQUE \(company_id, order_id, serie, numero\)/);
    expect(notas).toMatch(/serie\s+TEXT NOT NULL DEFAULT ''/);
  });

  it('RLS ligada nas três tabelas novas', () => {
    for (const t of ['order_erp_events', 'order_invoices', 'order_invoice_items']) {
      expect(MIGRACAO).toContain(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`);
    }
  });

  it('users.updated_at nasce sem backfill (sem DEFAULT no ADD COLUMN)', () => {
    expect(MIGRACAO).toContain('ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;');
    expect(MIGRACAO).toContain('ALTER TABLE users ALTER COLUMN updated_at SET DEFAULT now();');
    expect(semComentarios(MIGRACAO)).not.toMatch(/CREATE\s+TRIGGER/i);
  });
});

describe('passo 1: 013 e 042 na Corpo Sensual', () => {
  it('leva a 013 inteira', () => {
    expect(PASSO_1).toContain(MIGRACAO_013.trim());
  });

  it('leva o índice único da 042 e termina com o NOTIFY', () => {
    expect(PASSO_1).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_company_erp_order\s+ON orders \(company_id, erp_order_id\)\s+WHERE erp_order_id IS NOT NULL;/,
    );
    expect(PASSO_1.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';")).toBe(true);
  });

  it('avisa que é só na Corpo Sensual e manda rodar antes a consulta de repetidos', () => {
    expect(PASSO_1).toMatch(/SÓ NA CORPO SENSUAL/);
    expect(PASSO_1).toMatch(/HAVING COUNT\(\*\) > 1/);
  });
});

describe('conferir-048.mjs', () => {
  it('pergunta por GET com limit(0): nunca HEAD, nunca linhas', () => {
    const codigo = semComentarios(CONFERIR);
    expect(codigo).toContain('.limit(0)');
    expect(codigo).not.toMatch(/head\s*:\s*true/);
    expect(codigo).not.toMatch(/\.limit\((?!0\))/);
    expect(codigo).not.toMatch(/\.(insert|update|upsert|delete)\(/);
    expect(codigo).toContain('process.argv[2]');
  });
});
