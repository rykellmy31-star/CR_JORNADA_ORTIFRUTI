-- Personalização opcional da vitrine com a paleta extraída da logomarca.
ALTER TABLE tenants ADD COLUMN use_logo_colors INTEGER NOT NULL DEFAULT 0 CHECK (use_logo_colors IN (0,1));
ALTER TABLE tenants ADD COLUMN logo_palette_json TEXT;
