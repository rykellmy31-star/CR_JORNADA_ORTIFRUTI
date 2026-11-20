-- Catálogo de fotos reutilizável por nome entre lojas, sem compartilhar produtos.
-- Apenas imagens curadas do acervo aberto (Wikimedia Commons) são globais.
-- Fotos enviadas por proprietários continuam no R2 privativo da loja.
CREATE TABLE IF NOT EXISTS product_image_library (
  normalized_name TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  image_url TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('wikimedia','builtin')),
  source_page_url TEXT,
  license_name TEXT,
  license_url TEXT,
  author TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_product_image_library_url ON product_image_library(image_url);
