-- Venda opcional do mesmo produto por peso (kg) e por unidade.
-- O estoque de produtos por peso continua em gramas.
-- Quando preço por unidade estiver configurado, cada unidade desconta seu peso médio.
ALTER TABLE products ADD COLUMN unit_price_cents INTEGER
  CHECK (unit_price_cents IS NULL OR unit_price_cents >= 0);

ALTER TABLE products ADD COLUMN unit_weight_grams INTEGER
  CHECK (unit_weight_grams IS NULL OR unit_weight_grams > 0);
