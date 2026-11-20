-- Cadastro voluntário de visitantes, separado por loja, sem cupons.
-- A migração é aditiva: preserva clientes, compras e os dados existentes.
ALTER TABLE tenants ADD COLUMN signup_popup_enabled INTEGER NOT NULL DEFAULT 1
  CHECK(signup_popup_enabled IN (0,1));
ALTER TABLE tenants ADD COLUMN signup_popup_title TEXT NOT NULL DEFAULT '🍓 Fresquinho de verdade, novidades em primeira mão!';
ALTER TABLE tenants ADD COLUMN signup_popup_description TEXT NOT NULL DEFAULT 'Cadastre-se para conhecer os produtos fresquinhos, as novidades e as ofertas da nossa loja!';
ALTER TABLE tenants ADD COLUMN signup_popup_button TEXT NOT NULL DEFAULT 'Quero ficar por dentro!';

ALTER TABLE customers ADD COLUMN email TEXT;
ALTER TABLE customers ADD COLUMN marketing_opt_in INTEGER NOT NULL DEFAULT 0
  CHECK(marketing_opt_in IN (0,1));
ALTER TABLE customers ADD COLUMN marketing_consented_at TEXT;
ALTER TABLE customers ADD COLUMN signup_consented_at TEXT;
ALTER TABLE customers ADD COLUMN signup_source TEXT NOT NULL DEFAULT 'checkout';

CREATE INDEX IF NOT EXISTS idx_customers_tenant_marketing
  ON customers(tenant_id, marketing_opt_in, created_at);
