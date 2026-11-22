
-- Regras isoladas por loja e fotografadas no momento do pedido.
ALTER TABLE tenants ADD COLUMN loyalty_config_json TEXT;
ALTER TABLE orders ADD COLUMN loyalty_minimum_cents INTEGER;
ALTER TABLE orders ADD COLUMN loyalty_goal INTEGER;
ALTER TABLE orders ADD COLUMN loyalty_reward_name TEXT;
CREATE TABLE loyalty_accounts (
 tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 customer_id TEXT NOT NULL REFERENCES customers(id),
 progress INTEGER NOT NULL DEFAULT 0 CHECK(progress>=0),
 goal INTEGER NOT NULL CHECK(goal BETWEEN 1 AND 100),
 reward_name TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,customer_id)
);
CREATE TABLE loyalty_earnings (
 tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 order_id TEXT NOT NULL REFERENCES orders(id),
 customer_id TEXT NOT NULL REFERENCES customers(id),
 minimum_cents INTEGER NOT NULL,
 subtotal_cents INTEGER NOT NULL,
 created_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,order_id)
);
CREATE INDEX idx_loyalty_earnings_customer ON loyalty_earnings(tenant_id,customer_id);
CREATE TABLE loyalty_rewards (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 customer_id TEXT NOT NULL REFERENCES customers(id),
 earned_order_id TEXT NOT NULL REFERENCES orders(id),
 reward_name TEXT NOT NULL,
 points_used INTEGER NOT NULL,
 created_at TEXT NOT NULL,
 redeemed_at TEXT,
 redeemed_by_user_id TEXT,
 UNIQUE(tenant_id,earned_order_id)
);
CREATE INDEX idx_loyalty_rewards_customer ON loyalty_rewards(tenant_id,customer_id,redeemed_at);
-- A entrega e a pontuação são uma única transação. Pedido cancelado não pontua.
-- Mudanças de meta/prêmio valem no próximo ciclo; pedidos anteriores mantêm a regra prometida.
CREATE TRIGGER loyalty_award_on_delivery AFTER UPDATE OF status ON orders
WHEN NEW.status='delivered' AND OLD.status!='delivered'
 AND NEW.stock_state='committed' AND NEW.deleted_at IS NULL AND NEW.customer_id IS NOT NULL
 AND NEW.loyalty_minimum_cents>0 AND NEW.loyalty_goal BETWEEN 1 AND 100
 AND NEW.loyalty_reward_name IS NOT NULL AND NEW.subtotal_cents>=NEW.loyalty_minimum_cents
 AND NOT EXISTS(SELECT 1 FROM loyalty_earnings WHERE tenant_id=NEW.tenant_id AND order_id=NEW.id)
BEGIN
 INSERT INTO loyalty_earnings(tenant_id,order_id,customer_id,minimum_cents,subtotal_cents,created_at)
 VALUES(NEW.tenant_id,NEW.id,NEW.customer_id,NEW.loyalty_minimum_cents,NEW.subtotal_cents,NEW.updated_at);
 INSERT INTO loyalty_accounts(tenant_id,customer_id,progress,goal,reward_name,updated_at)
 VALUES(NEW.tenant_id,NEW.customer_id,1,NEW.loyalty_goal,NEW.loyalty_reward_name,NEW.updated_at)
 ON CONFLICT(tenant_id,customer_id) DO UPDATE SET
 goal=CASE WHEN progress=0 THEN excluded.goal ELSE goal END,
 reward_name=CASE WHEN progress=0 THEN excluded.reward_name ELSE reward_name END,
 progress=progress+1,updated_at=excluded.updated_at;
 INSERT INTO loyalty_rewards(id,tenant_id,customer_id,earned_order_id,reward_name,points_used,created_at)
 SELECT lower(hex(randomblob(16))),tenant_id,customer_id,NEW.id,reward_name,goal,NEW.updated_at
 FROM loyalty_accounts WHERE tenant_id=NEW.tenant_id AND customer_id=NEW.customer_id AND progress>=goal;
 INSERT INTO whatsapp_message_queue(id,tenant_id,order_id,event_type,idempotency_key,recipient_phone,recipient_name,rendered_message,status,attempts,max_attempts,next_retry_at,created_at,updated_at)
 SELECT lower(hex(randomblob(16))),NEW.tenant_id,NEW.id,'loyalty_earned',NEW.id||':loyalty_earned',NEW.customer_phone,NEW.customer_name,
 CASE WHEN NEW.whatsapp_opt_in=0 THEN '[Envio ignorado: cliente não autorizou notificações]'
 ELSE 'Mais um ponto pra conta! 😎'||char(10)||'Esse é o *seu progresso atual* no Plano Fidelidade ⬇️'||char(10)||char(10)||
 CASE WHEN goal<=20 THEN substr('✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅',1,progress)||substr('🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴',1,goal-progress)||' = 🎁'||char(10) ELSE '' END||
 '*'||progress||' de '||goal||' pontos*'||char(10)||
 CASE WHEN progress>=goal THEN '🎉 Parabéns! Você conquistou: *'||reward_name||'*! Fale com a loja para resgatar seu prêmio.' 
 ELSE 'Faltam '||(goal-progress)||' ponto(s) para ganhar: *'||reward_name||'*.' END END,
 CASE WHEN NEW.whatsapp_opt_in=1 THEN 'pending' ELSE 'skipped_no_optin' END,0,3,
 CASE WHEN NEW.whatsapp_opt_in=1 THEN NEW.updated_at ELSE NULL END,NEW.updated_at,NEW.updated_at
 FROM loyalty_accounts WHERE tenant_id=NEW.tenant_id AND customer_id=NEW.customer_id;
 UPDATE loyalty_accounts SET progress=0 WHERE tenant_id=NEW.tenant_id AND customer_id=NEW.customer_id AND progress>=goal;
END;
