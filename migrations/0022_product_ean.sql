-- Código EAN opcional para identificação de produtos vendidos por unidade.
ALTER TABLE products ADD COLUMN ean TEXT;
CREATE INDEX IF NOT EXISTS idx_products_tenant_ean ON products(tenant_id,ean) WHERE ean IS NOT NULL;
