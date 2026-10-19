import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { TIPOS_DE_EVENTO_ERP, CAMPOS_DO_RASTRO } from '../apps/api/src/modules/orders/eventosErp.service.js';

/**
 * A 055 (pedido inativo) roda À MÃO, nos dois bancos, e o código sobe antes
 * dela. O que este teste tranca é o que só se descobre no SQL Editor (ou pior,
 * em produção):
 *
 *   • o arquivo de _tools é o MESMO SQL da migração e termina recarregando o
 *     cache do PostgREST;
 *   • é aditiva e reexecutável: quatro colunas em orders com IF NOT EXISTS,
 *     um índice parcial, e o CHECK de tipo do rastro recriado (DROP IF EXISTS
 *     antes) — nada renomeado, nenhuma linha gravada ou apagada;
 *   • as colunas são EXATAMENTE as combinadas em 15/10/2026, e o
 *     conferir-055.mjs pergunta por todas elas, nem uma a mais;
 *   • o CHECK de order_erp_events.tipo é a lista da 050 mais os dois tipos do
 *     carimbo, e é a lista inteira que o código grava (a fonte passou a ser
 *     esta); o rastro carrega `inactive`/`inactive_at`;
 *   • o conferir pergunta por GET (nunca HEAD) e nos DOIS bancos.
 */

const ler = (rel: string) => readFileSync(path.resolve(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n');

const MIGRACAO = ler('apps/api/src/config/migrations/055_pedido_inativo.sql');
const MIGRACAO_050 = ler('apps/api/src/config/migrations/050_cliente_excluido_e_solicitacao.sql');
const PARA_RODAR = ler('_tools/SQL-PARA-RODAR-055.sql');
const CONFERIR = ler('_tools/conferir-055.mjs');
const ESTRUTURA = ler('ESTRUTURA.md');
const BRIEF = ler('docs/BRIEF-ERP-FABIO.md');

const NOTIFY = "NOTIFY pgrst, 'reload schema';";

/** As colunas de orders combinadas em 15/10/2026, na ordem do SQL. */
const COLUNAS_DA_055: Record<string, string> = {
  inactive: 'BOOLEAN NOT NULL DEFAULT false',
  inactive_at: 'TIMESTAMPTZ',
  inactive_by: 'UUID REFERENCES users(id) ON DELETE SET NULL',
  inactive_note: 'TEXT',
};

const TIPOS_NOVOS = ['pedido_inativado', 'pedido_reativado'];

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

/** A lista de um CHECK ... IN (...) pelo nome da trava. */
function listaDoCheck(sql: string, trava: string): string[] {
  const re = new RegExp(`${trava}\\s+CHECK\\s*\\(([\\s\\S]*?)\\)\\s*(?:NOT VALID)?\\s*;`);
  const m = re.exec(semComentarios(sql));
  if (!m) throw new Error(`trava ${trava} não encontrada`);
  const dentro = /IN\s*\(([^)]*)\)/.exec(m[1]!);
  if (!dentro) throw new Error(`trava ${trava} sem lista IN`);
  return [...dentro[1]!.matchAll(/'([^']*)'/g)].map((x) => x[1]!);
}

function colunasDoConferir(codigo: string): Record<string, string[]> {
  const bloco = /const colunas = \{([\s\S]*?)\n\};/.exec(codigo)?.[1];
  if (!bloco) throw new Error('conferir-055.mjs sem o objeto `colunas`');
  const semJs = bloco.replace(/\/\/.*$/gm, '');
  const saida: Record<string, string[]> = {};
  for (const m of semJs.matchAll(/(\w+):\s*\[([^\]]*)\]/g)) {
    saida[m[1]!] = [...m[2]!.matchAll(/'([^']+)'/g)].map((c) => c[1]!);
  }
  return saida;
}

describe('migração 055', () => {
  it('o SQL de _tools é o da migração, para os dois bancos, e termina com o NOTIFY', () => {
    // Do bloco 0 (a trava da 050) ao NOTIFY: é esse trecho que se cola.
    const inicio = MIGRACAO.indexOf('-- ─── 0. A 050 precisa estar aplicada');
    const fim = MIGRACAO.indexOf(NOTIFY) + NOTIFY.length;
    expect(inicio).toBeGreaterThan(0);
    expect(fim).toBeGreaterThan(inicio);
    expect(PARA_RODAR).toContain(MIGRACAO.slice(inicio, fim));
    expect(PARA_RODAR.trimEnd().endsWith(NOTIFY)).toBe(true);
    expect(PARA_RODAR).toMatch(/nos DOIS bancos/);
    expect(PARA_RODAR).toMatch(/conferir-055\.mjs/);
    expect(semComentarios(PARA_RODAR).trim()).toBe(semComentarios(MIGRACAO.slice(inicio, fim)).trim());
  });

  it('o bloco 0 para o SQL inteiro se a 050 ainda não rodou neste banco (16/10/2026)', () => {
    // A 055 recria o CHECK da 050 com dois tipos a mais; rodada ANTES da 050,
    // a 050 que viesse depois tiraria 'pedido_inativado' do CHECK e todo
    // inativar gravaria rastro "falhou" em silêncio. A ordem 050 → 055 vivia só
    // em comentário; agora o Postgres recusa, como a 050 faz com a 049.
    const sql = semComentarios(MIGRACAO);
    const bloco0 = MIGRACAO.indexOf('-- ─── 0. A 050 precisa estar aplicada');
    const blocoA = MIGRACAO.indexOf('-- ─── A. O carimbo no pedido');
    expect(bloco0).toBeGreaterThan(0);
    expect(bloco0).toBeLessThan(blocoA);
    const trava = /DO \$\$[\s\S]*?END \$\$;/.exec(sql.slice(0, sql.indexOf('ALTER TABLE orders')))?.[0];
    expect(trava).toBeDefined();
    // O que só a 050 deixa: a tabela deleted_customers e 'solicitacao_cancelada' no CHECK.
    expect(trava).toContain("to_regclass('public.deleted_customers') IS NULL");
    expect(trava).toContain('pg_get_constraintdef(oid)');
    expect(trava).toContain("conname = 'chk_order_erp_events_tipo'");
    expect(trava).toContain("position('solicitacao_cancelada' IN trava) = 0");
    expect(trava).toMatch(/RAISE EXCEPTION '[^']*050[^']*SQL-PARA-RODAR-050\.sql antes da 055[^']*'/);
    // E a cópia de _tools leva o bloco 0 junto (o teste do trecho colado começa nele).
    expect(semComentarios(PARA_RODAR)).toContain(trava!);
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
    // Só orders ganha coluna; o rastro só tem o CHECK recriado.
    const alteradas = [...sql.matchAll(/ALTER\s+TABLE\s+(\w+)/gi)].map((m) => m[1]);
    expect(new Set(alteradas)).toEqual(new Set(['orders', 'order_erp_events']));
    expect(sql).not.toMatch(/\bstatus\s*=/i);
  });

  it('orders ganha exatamente as quatro colunas combinadas em 15/10/2026', () => {
    expect(colunasAdicionadas(MIGRACAO, 'orders')).toEqual(COLUNAS_DA_055);
    // E cada uma tem o seu COMMENT, em português.
    for (const coluna of Object.keys(COLUNAS_DA_055)) {
      expect(MIGRACAO).toMatch(new RegExp(`COMMENT ON COLUMN orders\\.${coluna} IS`));
    }
  });

  it('índice parcial por empresa, só sobre os inativos', () => {
    expect(semComentarios(MIGRACAO)).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_orders_inativos\s+ON orders \(company_id\)\s+WHERE inactive;/,
    );
  });

  it("o CHECK de tipo do rastro é a lista da 050 mais 'pedido_inativado' e 'pedido_reativado', e é a do código", () => {
    const da050 = listaDoCheck(MIGRACAO_050, 'chk_order_erp_events_tipo');
    const da055 = listaDoCheck(MIGRACAO, 'chk_order_erp_events_tipo');
    expect(da055).toEqual([...da050, ...TIPOS_NOVOS]);
    expect(da055).toEqual([...TIPOS_DE_EVENTO_ERP]);
    expect(new Set(da055).size).toBe(da055.length);
    // Só quando a tabela do rastro existe (048): sem ela não há CHECK a recriar.
    const sql = semComentarios(MIGRACAO);
    expect(sql.indexOf("to_regclass('public.order_erp_events') IS NOT NULL")).toBeLessThan(
      sql.indexOf('DROP CONSTRAINT IF EXISTS chk_order_erp_events_tipo'),
    );
    // A origem do evento não muda: a 055 não recria essa trava.
    expect(() => listaDoCheck(MIGRACAO, 'chk_order_erp_events_origem')).toThrow();
    // O NOTIFY vem depois de tudo.
    expect(sql.trimEnd().indexOf(NOTIFY)).toBeGreaterThan(sql.indexOf('chk_order_erp_events_tipo'));
    // E avisa que a 048, a 049 e a 050 não devem ser rerodadas depois dela.
    expect(MIGRACAO).toMatch(/NÃO rerode a 048, a 049 nem a 050/);
  });

  it('o rastro carrega o carimbo: antes/depois com inactive e inactive_at', () => {
    expect([...CAMPOS_DO_RASTRO]).toEqual(expect.arrayContaining(['inactive', 'inactive_at']));
  });

  it('ESTRUTURA.md e o BRIEF registram a 055, a rota e o arquivo para os dois bancos', () => {
    expect(ESTRUTURA).toContain('055_pedido_inativo.sql');
    expect(ESTRUTURA).toContain('SQL-PARA-RODAR-055.sql');
    expect(ESTRUTURA).toContain('conferir-055');
    // A rota por extenso: "/inativo" sozinho já batia no customers.inativo da
    // 052 (a asserção antiga passava com a rota apagada do arquivo).
    expect(ESTRUTURA).toContain('PATCH /orders/:id/inativo');
    // ...na linha do módulo orders/, ao lado das rotas irmãs — não só na da migração.
    expect(ESTRUTURA).toMatch(/orders\/\s+→ GET\/POST \/orders, \/:id, \/status, \/invoice, PATCH \/orders\/:id\/inativo/);
    expect(ESTRUTURA).not.toMatch(/a 051[^\n]*É A ÚLTIMA/);
    // Os arquivos novos desta mudança, nos blocos que enumeram cada arquivo.
    expect(ESTRUTURA).toMatch(/│\s+(├|└)── nomeDoUsuario\.ts\s+→ nome do usuário pelo id/);
    expect(ESTRUTURA).toMatch(/│\s+(├|└)── pedidoInativo\.ts\s+→ quem marca\/desmarca "Pedido inativo" \(055\)/);
    expect(BRIEF).toMatch(/Pedido inativo/);
    expect(BRIEF).toMatch(/055/);
  });

  it('o BRIEF não manda mais colar a 050 (já está nos dois bancos) — depois da 055, rerodá-la derrubaria o rastro', () => {
    // Conferido por GET em 16/10/2026 (node _tools/conferir-050.mjs, CS e
    // PLUMENE): "050 visível para a API neste banco" nos dois. Quem seguisse o
    // texto antigo e colasse a 050 depois da 055 recriaria o CHECK com a lista
    // antiga — sem 'pedido_inativado'.
    expect(BRIEF).not.toMatch(/Falta colar `_tools\/SQL-PARA-RODAR-050\.sql`/);
    expect(BRIEF).toMatch(/a 048, a 049 e a 050 já estão nos \*\*DOIS bancos\*\*/);
    expect(BRIEF).toMatch(/\*\*Não rerodar a 048, a 049 nem a 050\*\*/);
    // E o que falta agora é a 055, com o bloco 0 que recusa o banco sem a 050.
    expect(BRIEF).toMatch(/colar `_tools\/SQL-PARA-RODAR-055\.sql`[^\n]*bloco 0 recusa se a 050 não rodou/);
    expect(BRIEF).toContain('node _tools/conferir-055.mjs');
  });
});

describe('conferir-055.mjs', () => {
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

  it('pergunta por todas as colunas da 055, e só por elas', () => {
    expect(colunasDoConferir(CONFERIR)).toEqual({ orders: Object.keys(COLUNAS_DA_055) });
  });
});
