-- Cores independentes para personalizar toda a vitrine por estabelecimento.
ALTER TABLE tenants ADD COLUMN button_color TEXT NOT NULL DEFAULT '#16834b';
ALTER TABLE tenants ADD COLUMN page_background_color TEXT NOT NULL DEFAULT '#ffffff';
ALTER TABLE tenants ADD COLUMN surface_color TEXT NOT NULL DEFAULT '#ffffff';
ALTER TABLE tenants ADD COLUMN text_color TEXT NOT NULL DEFAULT '#25372c';
