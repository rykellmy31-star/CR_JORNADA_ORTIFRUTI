-- Repasse configurável das taxas de cartão por estabelecimento e snapshot por pedido.
ALTER TABLE tenants ADD COLUMN pass_card_fee INTEGER NOT NULL DEFAULT 0 CHECK (pass_card_fee IN (0,1));
ALTER TABLE tenants ADD COLUMN debit_card_fee_bps INTEGER NOT NULL DEFAULT 0 CHECK (debit_card_fee_bps BETWEEN 0 AND 10000);
ALTER TABLE tenants ADD COLUMN credit_card_fee_bps INTEGER NOT NULL DEFAULT 0 CHECK (credit_card_fee_bps BETWEEN 0 AND 10000);
ALTER TABLE orders ADD COLUMN card_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK (card_fee_cents >= 0);
