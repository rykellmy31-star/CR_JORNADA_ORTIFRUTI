/**
 * Camada Universal de Banco de Dados compatível 1:1 com Cloudflare D1 (`D1Database`)
 * e `better-sqlite3` para execução local, homologação e suíte de testes automatizados.
 */

export interface DbRunMeta {
  changes: number;
  last_row_id?: number;
}

export interface DbRunResult<T = Record<string, unknown>> {
  success: boolean;
  meta: DbRunMeta;
  results?: T[];
}

export interface DbPreparedStatement {
  bind(...values: unknown[]): DbPreparedStatement;
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: boolean }>;
  run(): Promise<DbRunResult>;
  /** Usado internamente pelo adaptador SQLite para transações atômicas condicionais */
  _rawSql?: string;
  _boundValues?: unknown[];
}

export interface DbClient {
  prepare(query: string): DbPreparedStatement;
  batch<T = unknown>(statements: DbPreparedStatement[]): Promise<DbRunResult<T>[]>;
  /**
   * Executa um conjunto de comandos dentro de uma transação atômica onde
   * determinados comandos exigem `changes >= expectedMinChanges` (ex: reserva de estoque
   * condicional `WHERE (physical_qty - reserved_qty) >= ?`).
   * Se qualquer condição falhar, reverte (ROLLBACK) toda a operação!
   */
  atomicConditionalBatch?(
    steps: Array<{
      stmt: DbPreparedStatement;
      requireChanges?: number;
      failErrorMessage?: string;
    }>
  ): Promise<void>;
}

export class StockConflictError extends Error {
  public readonly statusCode = 409;
  constructor(message: string) {
    super(message);
    this.name = 'StockConflictError';
  }
}

/**
 * Executa lote transacional condicional funcionando tanto no SQLite local (com ROLLBACK nativo)
 * quanto no Cloudflare D1 (`db.batch()` com cláusulas atômicas SQL e compensação imediata caso aplicável).
 */
export async function runConditionalTransaction(
  db: DbClient,
  steps: Array<{
    stmt: DbPreparedStatement;
    requireChanges?: number;
    failErrorMessage?: string;
  }>
): Promise<void> {
  if (typeof db.atomicConditionalBatch === 'function') {
    await db.atomicConditionalBatch(steps);
    return;
  }

  // D1 batch is one SQLite transaction: add an SQL guard immediately after every
  // conditional write. json_extract() on malformed JSON raises a SQLite error and
  // therefore forces D1 to roll back the entire batch (orders, lines and reservations).
  const expanded: DbPreparedStatement[] = [];
  const guardedSteps: Array<{ index: number; message: string }> = [];
  for (const step of steps) {
    expanded.push(step.stmt);
    if (step.requireChanges !== undefined) {
      guardedSteps.push({ index: expanded.length - 1, message: step.failErrorMessage || 'Estoque insuficiente para concluir a operação.' });
      expanded.push(db.prepare(`SELECT CASE WHEN changes() < ${Math.max(0, Math.floor(step.requireChanges))} THEN json_extract('CR_JORNADA_ABORT', '$') ELSE 1 END`));
    }
  }
  try {
    await db.batch(expanded);
  } catch (error) {
    const message = String((error as Error)?.message || error);
    if (/malformed json|json_extract|CR_JORNADA_ABORT/i.test(message)) {
      const failed = guardedSteps[guardedSteps.length - 1];
      throw new StockConflictError(failed?.message || 'Estoque insuficiente para concluir a operação.');
    }
    throw error;
  }
}
