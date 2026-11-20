-- Exclusão lógica de pedidos cancelados e alertas de desconexão com reenvio.
-- Nunca apaga clientes, pedidos nem estoque; preserva histórico para auditoria.
ALTER TABLE orders ADD COLUMN deleted_at TEXT;
ALTER TABLE orders ADD COLUMN deleted_by_user_id TEXT;
ALTER TABLE orders ADD COLUMN deleted_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_tenant_visible_created
  ON orders(tenant_id, deleted_at, created_at DESC);

CREATE TABLE IF NOT EXISTS whatsapp_disconnect_alerts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  instance_name TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('panel', 'webhook', 'monitor')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_retry_at TEXT,
  sent_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_disconnect_alerts_pending
  ON whatsapp_disconnect_alerts(status, next_retry_at, created_at);
CREATE INDEX IF NOT EXISTS idx_disconnect_alerts_tenant
  ON whatsapp_disconnect_alerts(tenant_id,created_at DESC);
-- Migração ativada no pipeline D1 remoto antes de habilitar os novos recursos.
