import type { D1Database, D1PreparedStatement as CfStatement } from '@cloudflare/workers-types';
import type { DbClient, DbPreparedStatement, DbRunResult } from './adapter';

class D1Stmt implements DbPreparedStatement {
  constructor(private readonly stmt: CfStatement) {}
  bind(...values: unknown[]): DbPreparedStatement { return new D1Stmt(this.stmt.bind(...values as any[])); }
  async first<T=Record<string,unknown>>(colName?: string): Promise<T|null> { return await (colName ? this.stmt.first(colName) : this.stmt.first()) as T|null; }
  async all<T=Record<string,unknown>>(): Promise<{results:T[];success:boolean}> { const r=await this.stmt.all<T>(); return {results:r.results||[],success:r.success}; }
  async run(): Promise<DbRunResult> { const r=await this.stmt.run(); return {success:r.success,meta:{changes:r.meta.changes,last_row_id:r.meta.last_row_id}}; }
  get raw(){return this.stmt;}
}

export class CloudflareD1Adapter implements DbClient {
  constructor(private readonly db:D1Database){}
  prepare(query:string):DbPreparedStatement{return new D1Stmt(this.db.prepare(query));}
  async batch<T=unknown>(statements:DbPreparedStatement[]):Promise<DbRunResult<T>[]> {
    const raw=statements.map((s)=>(s as D1Stmt).raw); const results=await this.db.batch(raw);
    return results.map(r=>({success:r.success,meta:{changes:r.meta.changes,last_row_id:r.meta.last_row_id},results:r.results as T[]|undefined}));
  }
}
