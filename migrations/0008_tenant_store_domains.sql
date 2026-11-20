-- Apenas Hortifruti. Metadados novos, sem modificar tenants, users, produtos ou pedidos.
-- Um subdomínio por estabelecimento. Nenhum token Cloudflare é salvo no D1.
CREATE TABLE IF NOT EXISTS tenant_store_domains (
 tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE RESTRICT,
 hostname TEXT NOT NULL UNIQUE,
 status TEXT NOT NULL DEFAULT 'pending'
   CHECK(status IN ('pending','registered','conflict','manual')),
 domain_id TEXT,
 activate_on_success INTEGER NOT NULL DEFAULT 0 CHECK(activate_on_success IN (0,1)),
 last_error TEXT,
 updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tenant_store_domains_status
 ON tenant_store_domains(status,updated_at);
