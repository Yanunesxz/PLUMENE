/**
 * Gerenciador de conexão com o banco Firebird do ERP.
 *
 * Usa node-firebird via protocolo TCP (porta 3050).
 * O servidor Firebird 2.5 deve estar acessível em ERP_DB_HOST.
 *
 * Para desenvolvimento local com o arquivo .FDB diretamente,
 * use o script Python `_tools/erp-sync/sync.py` que usa fbembed.
 */
import Firebird from 'node-firebird';
import type { Database } from 'node-firebird';
import { env } from '../../config/env.js';

/** Alias for the node-firebird Database handle used in callbacks. */
export type FirebirdDb = Database;

const fbOptions: Firebird.Options = {
  host: env.ERP_DB_HOST,
  port: env.ERP_DB_PORT,
  database: env.ERP_DB_PATH,
  user: env.ERP_DB_USER,
  password: env.ERP_DB_PASSWORD,
  lowercase_keys: false,
  pageSize: 4096,
};

/**
 * Abre uma conexão Firebird, executa `fn` e fecha ao finalizar.
 * Garante fechamento mesmo em caso de erro.
 */
export async function withFirebird<T>(
  fn: (db: FirebirdDb) => Promise<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    Firebird.attach(fbOptions, (err, db) => {
      if (err) {
        reject(new Error(`Firebird connection failed: ${(err as Error).message}`));
        return;
      }

      fn(db)
        .then((result) => {
          db.detach();
          resolve(result);
        })
        .catch((error: unknown) => {
          db.detach();
          reject(error);
        });
    });
  });
}

/**
 * Executa uma query parametrizada e retorna as linhas como array.
 */
export function query<T = Record<string, unknown>>(
  db: FirebirdDb,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, result) => {
      if (err) reject(new Error(`Firebird query failed: ${(err as Error).message}`));
      else resolve((result ?? []) as T[]);
    });
  });
}

/**
 * Testa a conectividade com o banco ERP.
 */
export async function testConnection(): Promise<{ ok: boolean; message: string }> {
  try {
    const rows = await withFirebird((db) =>
      query<{ CNT: number }>(db, 'SELECT COUNT(*) AS CNT FROM PRODUTO WHERE ATIVO = ?', ['S']),
    );
    return { ok: true, message: `Firebird OK — ${rows[0]?.CNT ?? 0} produtos ativos` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
