import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * A 057 (fracionamento de pedidos) roda À MÃO, nos dois bancos, e o código
 * sobe antes dela. O que este teste tranca é o que só se descobre no SQL
 * Editor (ou pior, em produção):
 *
 *   • o arquivo de _tools é o MESMO SQL da migração e termina recarregando o
 *     cache do PostgREST;
 *   • é aditiva e reexecutável: seis colunas em orders com IF NOT EXISTS, uma
 *     trava (DROP IF EXISTS antes) e dois índices parciais — nada renomeado,
 *     nenhuma linha gravada ou apagada;
 *   • as colunas são EXATAMENTE as combinadas em 05/11/2026, e o
 *     conferir-057.mjs pergunta por todas elas, nem uma a mais;
 *   • NÃO mexe no CHECK do rastro (order_erp_events): a 057 pode rodar em
 *     qualquer ordem, sem entrar na fila "não rerode a 048/049/050";
 *   • o conferir pergunta por GET (nunca HEAD) e nos DOIS bancos.
 */

const ler = (rel: string) => readFileSync(path.resolve(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n');

const MIGRACAO = ler('apps/api/src/config/migrations/057_fracionamento_de_pedidos.sql');
const PARA_RODAR = ler('_tools/SQL-PARA-RODAR-057.sql');
const CONFERIR = ler('_tools/conferir-057.mjs');
const ESTRUTURA = ler('ESTRUTURA.md');

const NOTIFY = "NOTIFY pgrst, 'reload schema';";

/** As colunas de orders combinadas em 05/11/2026, na ordem do SQL. */
const COLUNAS_DA_057: Record<string, string> = {
  split_group_id: 'UUID',
  split_index: 'SMALLINT',
  split_count: 'SMALLINT',
  ship_date: 'DATE',
  split_at: 'TIMESTAMPTZ',
  split_by: 'UUID REFERENCES users(id) ON DELETE SET NULL',
};

const semComentarios = (sql: string) =>
  sql
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');

/** Coluna → definição dos ADD COLUMN IF NOT EXISTS de uma tabela, na ordem. */
function colunasAdicionadas(sql: string, tabela: string): Record<string, string> {
  const bloco = new RegExp(`ALTER TABLE ${tabela}\\s+([\\s\\S]*?);`).exec(semComentarios(sql))?.[1];
  if (!bloco) throw new Error(`ALTER TABLE ${tabela} não encontrado`);
  const saida: Record<string, string> = {};
  for (const m of bloco.matchAll(/ADD COLUMN IF NOT EXISTS (\w+)\s+([^,]+?)(?:,|$)/g)) {
    saida[m[1]!] = m[2]!.replace(/\s+/g, ' ').trim();
  }
  return saida;
}

function colunasDoConferir(codigo: string): Record<string, string[]> {
  const bloco = /const colunas = \{([\s\S]*?)\n\};/.exec(codigo)?.[1];
  if (!bloco) throw new Error('conferir-057.mjs sem o objeto `colunas`');
  const semJs = bloco.replace(/\/\/.*$/gm, '');
  const saida: Record<string, string[]> = {};
  for (const m of semJs.matchAll(/(\w+):\s*\[([^\]]*)\]/g)) {
    saida[m[1]!] = [...m[2]!.matchAll(/'([^']+)'/g)].map((c) => c[1]!);
  }
  return saida;
}

describe('migração 057', () => {
  it('o SQL de _tools é o da migração, para os dois bancos, e termina com o NOTIFY', () => {
    // Do bloco A ao NOTIFY: é esse trecho que se cola.
    const inicio = MIGRACAO.indexOf('-- ─── A. As entregas no pedido');
    const fim = MIGRACAO.indexOf(NOTIFY) + NOTIFY.length;
    expect(inicio).toBeGreaterThan(0);
    expect(fim).toBeGreaterThan(inicio);
    expect(PARA_RODAR).toContain(MIGRACAO.slice(inicio, fim));
    expect(PARA_RODAR.trimEnd().endsWith(NOTIFY)).toBe(true);
    expect(PARA_RODAR).toMatch(/nos DOIS bancos/);
    expect(PARA_RODAR).toMatch(/conferir-057\.mjs/);
    expect(semComentarios(PARA_RODAR).trim()).toBe(semComentarios(MIGRACAO.slice(inicio, fim)).trim());
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
    expect(sql).not.toMatch(/ALTER\s+COLUMN/i);
    expect(sql).not.toMatch(/CREATE\s+TABLE/i);
    for (const m of sql.matchAll(/CREATE\s+(UNIQUE\s+)?INDEX\s+(\S+)/gi)) {
      expect(m[2]).toMatch(/^IF$/i);
    }
    for (const m of sql.matchAll(/ADD\s+COLUMN\s+(\S+)/gi)) {
      expect(m[1]).toMatch(/^IF$/i);
    }
    for (const m of sql.matchAll(/ADD\s+CONSTRAINT\s+(\w+)/gi)) {
      expect(sql).toContain(`DROP CONSTRAINT IF EXISTS ${m[1]!}`);
    }
    // Só orders muda.
    const alteradas = [...sql.matchAll(/ALTER\s+TABLE\s+(\w+)/gi)].map((m) => m[1]);
    expect(new Set(alteradas)).toEqual(new Set(['orders']));
    // O status do pedido não entra nesta história: entrega é pedido, não status.
    expect(sql).not.toMatch(/\bstatus\b/i);
  });

  it('orders ganha exatamente as seis colunas combinadas em 05/11/2026, cada uma com o seu COMMENT', () => {
    expect(colunasAdicionadas(MIGRACAO, 'orders')).toEqual(COLUNAS_DA_057);
    for (const coluna of Object.keys(COLUNAS_DA_057)) {
      expect(MIGRACAO).toMatch(new RegExp(`COMMENT ON COLUMN orders\\.${coluna} IS`));
    }
    // O grupo NÃO tem FK: excluir a entrega 1 não pode desfazer o vínculo das outras.
    expect(COLUNAS_DA_057.split_group_id).toBe('UUID');
  });

  it('a trava mantém as três colunas do grupo juntas e a posição dentro da contagem', () => {
    const sql = semComentarios(MIGRACAO).replace(/\s+/g, ' ');
    expect(sql).toContain(
      'CHECK ( (split_group_id IS NULL AND split_index IS NULL AND split_count IS NULL) OR (split_group_id IS NOT NULL AND split_count BETWEEN 2 AND 12 AND split_index BETWEEN 1 AND split_count) )',
    );
  });

  it('dois índices parciais: o do grupo e o que impede duas entregas na mesma posição', () => {
    const sql = semComentarios(MIGRACAO).replace(/\s+/g, ' ');
    expect(sql).toContain(
      'CREATE INDEX IF NOT EXISTS idx_orders_fracionados ON orders (company_id, split_group_id) WHERE split_group_id IS NOT NULL;',
    );
    expect(sql).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_entrega_unica ON orders (split_group_id, split_index) WHERE split_group_id IS NOT NULL;',
    );
  });

  it('não mexe no rastro do pedido: pode rodar sem entrar na fila da 048/049/050/055', () => {
    const sql = semComentarios(MIGRACAO);
    expect(sql).not.toMatch(/order_erp_events/);
    expect(sql).not.toMatch(/chk_order_erp_events_tipo/);
    // E o NOTIFY vem depois de tudo.
    expect(sql.trimEnd().endsWith(NOTIFY)).toBe(true);
  });

  it('ESTRUTURA.md registra a 057, as rotas e os arquivos novos — e ela passa a ser a última', () => {
    expect(ESTRUTURA).toContain('057_fracionamento_de_pedidos.sql');
    expect(ESTRUTURA).toContain('SQL-PARA-RODAR-057.sql');
    expect(ESTRUTURA).toContain('conferir-057');
    expect(ESTRUTURA).toContain('POST /orders/:id/fracionar');
    expect(ESTRUTURA).toContain('PATCH /orders/:id/data-de-envio');
    expect(ESTRUTURA).toMatch(/│\s+(├|└)── fracionamento\.ts\s+→ /);
    expect(ESTRUTURA).toMatch(/│\s+(├|└)── mexerNoPedido\.ts\s+→ /);
    expect(ESTRUTURA).toContain('fracionamento.service.ts');
    expect(ESTRUTURA).toContain('FracionarPedido');
    expect(ESTRUTURA).toContain('EntregasDoPedido');
    // "É A ÚLTIMA" aparece uma vez só, e depois da 057.
    expect(ESTRUTURA.match(/É A ÚLTIMA/g)).toHaveLength(1);
    expect(ESTRUTURA.indexOf('É A ÚLTIMA')).toBeGreaterThan(ESTRUTURA.indexOf('057_fracionamento_de_pedidos.sql'));
  });
});

describe('conferir-057.mjs', () => {
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

  it('pergunta por todas as colunas da 057, e só por elas', () => {
    expect(colunasDoConferir(CONFERIR)).toEqual({ orders: Object.keys(COLUNAS_DA_057) });
  });
});
