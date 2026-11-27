-- Preserva a escolha explícita do lojista de manter o produto sem foto.
ALTER TABLE products ADD COLUMN auto_image_disabled INTEGER NOT NULL DEFAULT 0 CHECK(auto_image_disabled IN (0,1));
