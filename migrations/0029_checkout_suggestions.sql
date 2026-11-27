-- Configuração independente de venda sugestiva por estabelecimento.
ALTER TABLE tenants ADD COLUMN checkout_suggestions_json TEXT;
