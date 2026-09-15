import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { codigoMiolo, codigoCanonico, mesmoCodigo } from '../packages/shared/src/cadastro/codigoErp.js';
import * as shared from '../packages/shared/src/index.js';

/**
 * A regra única do código do Control, em DUAS pontas: codigoMiolo() no app e
 * public.codigo_miolo() no banco (migração 048, que sustenta o índice único de
 * price_tables.erp_code). Se as duas divergirem, o app acha que dois códigos
 * são o mesmo cadastro e o banco não (ou o contrário) — e o casamento falha
 * calado, ou o índice recusa uma gravação que o app julgava nova.
 *
 * O teste não tem banco. A paridade é conferida de três jeitos:
 *   1. os casos da consulta de conferência da 048 são LIDOS do próprio arquivo
 *      SQL (a mesma lista que o Yan roda no SQL Editor);
 *   2. o corpo da função no SQL é conferido letra a letra contra o texto que
 *      `miolosql` abaixo imita — mudou o SQL, este teste obriga a mudar a imitação;
 *   3. a imitação passo a passo do SQL e a função do app são comparadas numa
 *      bateria de entradas geradas.
 */

const MIGRACAO = readFileSync(
  path.resolve(__dirname, '../apps/api/src/config/migrations/048_integracao_control_fase_0.sql'),
  'utf8',
).replace(/\r\n/g, '\n');

/** Os pares (entrada, esperado) da consulta de paridade no fim da 048. */
function casosDaMigracao(): Array<[string | null, string | null]> {
  const lit = (s: string): string | null => (s === 'NULL' ? null : s.slice(1, -1).replace(/''/g, "'"));
  const casos: Array<[string | null, string | null]> = [];
  const re = /^--\s+\((NULL|'(?:[^']|'')*'),\s*(NULL|'(?:[^']|'')*')\),?\s*$/gm;
  for (const m of MIGRACAO.matchAll(re)) casos.push([lit(m[1]!), lit(m[2]!)]);
  return casos;
}

/** O corpo exato de public.codigo_miolo na 048, que `miolosql` imita. */
const CORPO_SQL = [
  'SELECT CASE',
  "WHEN regexp_replace(upper(coalesce(t, '')), '[#[:space:]]', '', 'g') = '' THEN NULL",
  "ELSE coalesce(nullif(ltrim(regexp_replace(upper(t), '[#[:space:]]', '', 'g'), '0'), ''), '0')",
  'END',
].join(' ');

/** A função SQL, passo a passo, com a semântica do Postgres. */
function miolosql(t: string | null): string | null {
  const upper = (s: string) => s.toUpperCase();
  const coalesce = <T>(a: T | null, b: T): T => (a === null ? b : a);
  // [[:space:]] do Postgres: espaço, \t, \n, \v, \f, \r.
  const regexpReplace = (s: string) => s.replace(/[# \t\n\v\f\r]/g, '');
  const ltrimZero = (s: string) => s.replace(/^0+/, '');
  const nullif = (a: string, b: string): string | null => (a === b ? null : a);

  if (regexpReplace(upper(coalesce(t, ''))) === '') return null;
  return coalesce(nullif(ltrimZero(regexpReplace(upper(t!))), ''), '0');
}

describe('código do Control: codigoMiolo (casar)', () => {
  it('a consulta de paridade da 048 tem casos e o app acerta todos', () => {
    const casos = casosDaMigracao();
    expect(casos.length).toBeGreaterThanOrEqual(20);
    for (const [entrada, esperado] of casos) {
      expect({ entrada, miolo: codigoMiolo(entrada) }).toEqual({ entrada, miolo: esperado });
    }
  });

  it('o corpo da função no SQL é o que a imitação reproduz', () => {
    const m = /CREATE OR REPLACE FUNCTION public\.codigo_miolo\(t text\) RETURNS text\s+LANGUAGE sql IMMUTABLE AS \$\$([\s\S]*?)\$\$;/.exec(
      MIGRACAO,
    );
    expect(m).not.toBeNull();
    expect(m![1]!.replace(/\s+/g, ' ').trim()).toBe(CORPO_SQL);
  });

  it('a imitação do SQL e o app concordam numa bateria de entradas', () => {
    const pedacos = ['', '0', '00', '#', ' ', '\t', '1', '7', '9', 'A', 'a', 'cs', 'Z', '-', '.', '/', 'ç'];
    const entradas: Array<string | null> = [null];
    for (const a of pedacos) for (const b of pedacos) for (const c of pedacos) entradas.push(a + b + c);
    for (const entrada of entradas) {
      expect({ entrada, app: codigoMiolo(entrada) }).toEqual({ entrada, app: miolosql(entrada) });
    }
  });

  it('as grafias do mesmo cliente casam; prefixo e sufixo não', () => {
    expect(mesmoCodigo('#02225', '2225')).toBe(true);
    expect(mesmoCodigo(' 00779 ', 779)).toBe(true);
    expect(mesmoCodigo('cs 779', 'CS779')).toBe(true);
    expect(mesmoCodigo('779', '7790')).toBe(false);
    expect(mesmoCodigo('1234', '234')).toBe(false);
    expect(mesmoCodigo(null, null)).toBe(false);
    expect(mesmoCodigo('', '#')).toBe(false);
    // "0" é código (só zeros), não vazio.
    expect(mesmoCodigo('000', '0')).toBe(true);
  });

  it('aceita número vindo do JSON', () => {
    expect(codigoMiolo(2225)).toBe('2225');
    expect(codigoMiolo(undefined)).toBeNull();
  });
});

describe('código do Control: codigoCanonico (gravar)', () => {
  it('só dígitos: completa com zeros até 5, pelo miolo', () => {
    expect(codigoCanonico('779')).toBe('00779');
    expect(codigoCanonico('00779')).toBe('00779');
    expect(codigoCanonico('0000779')).toBe('00779');
    expect(codigoCanonico('#779')).toBe('00779');
    expect(codigoCanonico(' 7 79 ')).toBe('00779');
    expect(codigoCanonico(779)).toBe('00779');
    expect(codigoCanonico('123456')).toBe('123456');
    expect(codigoCanonico('0')).toBe('00000');
  });

  it('com letra: maiúscula, sem # e sem espaços, zeros mantidos', () => {
    expect(codigoCanonico('cs 779')).toBe('CS779');
    expect(codigoCanonico('#0a1')).toBe('0A1');
    expect(codigoCanonico('A001')).toBe('A001');
  });

  it('vazio vira null', () => {
    expect(codigoCanonico('')).toBeNull();
    expect(codigoCanonico('  ')).toBeNull();
    expect(codigoCanonico('#')).toBeNull();
    expect(codigoCanonico(null)).toBeNull();
  });

  it('o canônico tem o mesmo miolo da entrada', () => {
    for (const [entrada] of casosDaMigracao()) {
      expect(codigoMiolo(codigoCanonico(entrada))).toBe(codigoMiolo(entrada));
    }
  });

  it('sai pelo índice do shared', () => {
    expect(shared.codigoMiolo).toBe(codigoMiolo);
    expect(shared.codigoCanonico).toBe(codigoCanonico);
  });
});
