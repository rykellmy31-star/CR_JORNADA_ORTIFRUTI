-- CR Jornada Express: base da fila de impressão térmica.
-- Adiciona somente estrutura; impressão vem DESATIVADA em todas as lojas.
-- Nada nesta migração envia pedidos para aparelhos ou altera dados históricos.

ALTER TABLE tenants ADD COLUMN auto_print_enabled INTEGER NOT NULL DEFAULT 0
 CHECK (auto_print_enabled IN (0,1));

CREATE TABLE IF NOT EXISTS print_jobs (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
 order_number INTEGER NOT NULL,
 idempotency_key TEXT NOT NULL,
 job_type TEXT NOT NULL DEFAULT 'new_order'
  CHECK (job_type IN ('new_order','reprint')),
 status TEXT NOT NULL DEFAULT 'queued'
  CHECK (status IN ('queued','leased','printed','failed')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
 leased_by_device_id TEXT,
 lease_token_hash TEXT,
 lease_expires_at TEXT,
 last_error TEXT,
 printed_at TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_print_jobs_tenant_status
 ON print_jobs (tenant_id,status,created_at);
CREATE INDEX IF NOT EXISTS idx_print_jobs_tenant_order
 ON print_jobs (tenant_id,order_id);
