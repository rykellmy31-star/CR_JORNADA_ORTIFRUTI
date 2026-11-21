-- Produtos com opções de quantidade/preço fechado (ex.: 500 g por R$ 5,00).
-- Reutiliza product_variants e stock_pools de gramas; preserva produtos existentes.
ALTER TABLE products ADD COLUMN fixed_options_enabled INTEGER NOT NULL DEFAULT 0
 CHECK (fixed_options_enabled IN (0,1));
