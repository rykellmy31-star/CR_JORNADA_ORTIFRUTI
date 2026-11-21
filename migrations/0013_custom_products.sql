-- Modalidade personalizável sobre venda unitária; estoque continua por unidade.
ALTER TABLE products ADD COLUMN custom_config_json TEXT;
ALTER TABLE order_items ADD COLUMN customization_snapshot TEXT;
