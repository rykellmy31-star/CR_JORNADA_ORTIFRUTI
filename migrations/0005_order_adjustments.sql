-- Edição auditável de itens antes da saída para entrega.
-- ALTER TABLE é aditivo; dados dos pedidos e demais lojas são preservados.
ALTER TABLE orders ADD COLUMN adjustment_version INTEGER NOT NULL DEFAULT 0
  CHECK(adjustment_version >= 0);

CREATE TABLE IF NOT EXISTS order_adjustments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  old_subtotal_cents INTEGER NOT NULL,
  new_subtotal_cents INTEGER NOT NULL,
  old_total_cents INTEGER NOT NULL,
  new_total_cents INTEGER NOT NULL,
  changes_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(tenant_id,order_id,version)
);

CREATE INDEX IF NOT EXISTS idx_order_adjustments_tenant_order
 ON order_adjustments(tenant_id,order_id,version DESC);
