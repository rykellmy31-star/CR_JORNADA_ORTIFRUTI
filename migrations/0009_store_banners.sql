-- Carrossel por estabelecimento. Apenas Hortifruti: preserva a imagem anterior.
CREATE TABLE IF NOT EXISTS store_banners (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 image_url TEXT NOT NULL,
 mobile_image_url TEXT,
 sort_order INTEGER NOT NULL DEFAULT 0,
 is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_store_banners_tenant_order ON store_banners(tenant_id, sort_order, created_at);
-- Importa o banner atual de cada estabelecimento sem exigir novo upload.
INSERT OR IGNORE INTO store_banners
 (id,tenant_id,image_url,mobile_image_url,sort_order,is_active,created_at,updated_at)
SELECT 'legacy-'||id,id,banner_url,NULL,0,1,datetime('now'),datetime('now')
FROM tenants WHERE banner_url IS NOT NULL AND length(trim(banner_url)) > 0;
