-- Modalidades comerciais por estabelecimento e arquivamento seguro.
ALTER TABLE tenants ADD COLUMN sale_modes_json TEXT NOT NULL DEFAULT '["weight","unit","dual","variants","custom"]';
ALTER TABLE tenants ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0,1));
CREATE INDEX IF NOT EXISTS idx_tenants_archived ON tenants(is_archived,status);
