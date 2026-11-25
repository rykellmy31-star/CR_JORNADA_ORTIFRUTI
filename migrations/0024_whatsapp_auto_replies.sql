-- Atendimento automático por tenant
CREATE TABLE IF NOT EXISTS whatsapp_auto_reply_settings (
 tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
 enabled INTEGER NOT NULL DEFAULT 0,
 fallback_message TEXT NOT NULL DEFAULT '',
 store_url TEXT NOT NULL DEFAULT '',
 business_hours_only INTEGER NOT NULL DEFAULT 0,
 start_time TEXT NOT NULL DEFAULT '08:00',
 end_time TEXT NOT NULL DEFAULT '18:00',
 pause_on_human INTEGER NOT NULL DEFAULT 1,
 updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS whatsapp_auto_replies (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 title TEXT NOT NULL, intent TEXT NOT NULL DEFAULT '', keywords_json TEXT NOT NULL DEFAULT '[]',
 reply_text TEXT NOT NULL, is_enabled INTEGER NOT NULL DEFAULT 1, priority INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_auto_replies_tenant ON whatsapp_auto_replies(tenant_id,is_enabled,priority DESC);
CREATE TABLE IF NOT EXISTS whatsapp_auto_reply_events (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 provider_message_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', matched_rule_id TEXT,
 error_message TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(tenant_id,provider_message_id)
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_auto_reply_events_tenant ON whatsapp_auto_reply_events(tenant_id,created_at DESC);

CREATE TABLE IF NOT EXISTS whatsapp_auto_reply_sessions (
 tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 customer_phone TEXT NOT NULL,
 paused_until TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,customer_phone)
);
