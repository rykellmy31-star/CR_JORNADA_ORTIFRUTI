import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import {
  type DbClient,
  type DbPreparedStatement,
  type DbRunResult,
  StockConflictError,
} from './adapter';

class SqlitePreparedStatement implements DbPreparedStatement {
  public _rawSql: string;
  public _boundValues: unknown[];
  private sqlite: Database.Database;

  constructor(sqlite: Database.Database, sql: string, boundValues: unknown[] = []) {
    this.sqlite = sqlite;
    this._rawSql = sql;
    this._boundValues = boundValues;
  }

  bind(...values: unknown[]): DbPreparedStatement {
    const normalized = values.map((v) => (v === undefined ? null : v));
    return new SqlitePreparedStatement(this.sqlite, this._rawSql, normalized);
  }

  async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
    const stmt = this.sqlite.prepare(this._rawSql);
    const row = stmt.get(...this._boundValues) as Record<string, unknown> | undefined;
    if (!row) return null;
    if (colName) {
      return ((row[colName] as T) ?? null);
    }
    return row as T;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: boolean }> {
    const stmt = this.sqlite.prepare(this._rawSql);
    const rows = stmt.all(...this._boundValues) as T[];
    return { results: rows, success: true };
  }

  async run(): Promise<DbRunResult> {
    const stmt = this.sqlite.prepare(this._rawSql);
    const info = stmt.run(...this._boundValues);
    return {
      success: true,
      meta: {
        changes: info.changes,
        last_row_id: Number(info.lastInsertRowid),
      },
    };
  }
}

export class SqliteD1Adapter implements DbClient {
  public readonly sqlite: Database.Database;

  constructor(dbPath: string = ':memory:') {
    if (dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.sqlite = new Database(dbPath);
    this.sqlite.pragma('journal_mode = WAL');
    this.sqlite.pragma('foreign_keys = ON');
    this.sqlite.pragma('busy_timeout = 5000');
  }

  execMigrations(migrationsDir: string): void {
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      this.sqlite.exec(sql);
    }
  }

  prepare(query: string): DbPreparedStatement {
    return new SqlitePreparedStatement(this.sqlite, query);
  }

  async batch<T = unknown>(statements: DbPreparedStatement[]): Promise<DbRunResult<T>[]> {
    const tx = this.sqlite.transaction((stmts: DbPreparedStatement[]) => {
      const results: DbRunResult<T>[] = [];
      for (const s of stmts) {
        const sql = s._rawSql || '';
        const vals = s._boundValues || [];
        const prepared = this.sqlite.prepare(sql);
        if (/^\s*SELECT\b/i.test(sql)) {
          const rows = prepared.all(...vals) as T[];
          results.push({
            success: true,
            results: rows,
            meta: { changes: 0 },
          });
        } else {
          const info = prepared.run(...vals);
          results.push({
            success: true,
            meta: {
              changes: info.changes,
              last_row_id: Number(info.lastInsertRowid),
            },
          });
        }
      }
      return results;
    });

    return tx.immediate(statements);
  }

  async atomicConditionalBatch(
    steps: Array<{
      stmt: DbPreparedStatement;
      requireChanges?: number;
      failErrorMessage?: string;
    }>
  ): Promise<void> {
    const tx = this.sqlite.transaction(() => {
      for (const step of steps) {
        const sql = step.stmt._rawSql || '';
        const vals = step.stmt._boundValues || [];
        const info = this.sqlite.prepare(sql).run(...vals);
        if (step.requireChanges !== undefined && info.changes < step.requireChanges) {
          throw new StockConflictError(
            step.failErrorMessage || 'Estoque insuficiente para concluir a operação.'
          );
        }
      }
    });
    tx.immediate();
  }

  close(): void {
    this.sqlite.close();
  }
}
