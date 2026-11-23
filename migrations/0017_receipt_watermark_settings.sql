-- Personalização individual da marca-d'água impressa por estabelecimento.
ALTER TABLE tenants ADD COLUMN receipt_watermark_text TEXT NOT NULL DEFAULT '';
ALTER TABLE tenants ADD COLUMN receipt_watermark_orientation TEXT NOT NULL DEFAULT 'diagonal';
ALTER TABLE tenants ADD COLUMN receipt_watermark_opacity INTEGER NOT NULL DEFAULT 10;
ALTER TABLE tenants ADD COLUMN receipt_watermark_font_size INTEGER NOT NULL DEFAULT 21;
