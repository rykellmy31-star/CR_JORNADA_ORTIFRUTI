
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
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','confirmed','revoked')),
 revision INTEGER NOT NULL DEFAULT 0,
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

-- A pontuação acompanha a compra desde o checkout; resgate só após a entrega.
CREATE TRIGGER loyalty_earn_on_checkout AFTER INSERT ON orders
WHEN NEW.status='received' AND NEW.customer_id IS NOT NULL AND NEW.deleted_at IS NULL AND NEW.loyalty_minimum_cents>0 AND NEW.loyalty_goal BETWEEN 1 AND 100 AND NEW.loyalty_reward_name IS NOT NULL AND NEW.subtotal_cents>=NEW.loyalty_minimum_cents
BEGIN
 INSERT INTO loyalty_earnings(tenant_id,order_id,customer_id,minimum_cents,subtotal_cents,state,revision,created_at)
 VALUES(NEW.tenant_id,NEW.id,NEW.customer_id,NEW.loyalty_minimum_cents,NEW.subtotal_cents,'pending',0,NEW.updated_at);
END;
CREATE TRIGGER loyalty_account_on_earn AFTER INSERT ON loyalty_earnings
BEGIN
 INSERT INTO loyalty_accounts(tenant_id,customer_id,progress,goal,reward_name,updated_at)
 SELECT NEW.tenant_id,NEW.customer_id,1,o.loyalty_goal,o.loyalty_reward_name,o.updated_at FROM orders o WHERE o.id=NEW.order_id AND o.tenant_id=NEW.tenant_id
 ON CONFLICT(tenant_id,customer_id) DO UPDATE SET
 goal=CASE WHEN progress=0 THEN excluded.goal ELSE goal END,
 reward_name=CASE WHEN progress=0 THEN excluded.reward_name ELSE reward_name END,
 progress=progress+1,updated_at=excluded.updated_at;
 INSERT INTO whatsapp_message_queue(id,tenant_id,order_id,event_type,idempotency_key,recipient_phone,recipient_name,rendered_message,status,attempts,max_attempts,next_retry_at,created_at,updated_at)
 SELECT lower(hex(randomblob(16))),o.tenant_id,o.id,'loyalty_earned',o.id||':loyalty_earned:'||NEW.revision,o.customer_phone,o.customer_name,
 CASE WHEN o.whatsapp_opt_in=1 THEN 'Mais um ponto pra conta! 😎'||char(10)||'Esse é o *seu progresso atual* no Plano Fidelidade ⬇️'||char(10)||char(10)||CASE WHEN a.goal<=20 THEN substr('✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅',1,min(a.progress,a.goal))||substr('🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴',1,max(0,a.goal-a.progress))||' = 🎁'||char(10) ELSE '' END||'*'||a.progress||' de '||a.goal||' pontos*'||char(10)||CASE WHEN a.progress>=a.goal THEN '🎉 Você atingiu a meta! Seu prêmio *'||a.reward_name||'* ficará disponível após a confirmação das entregas.' ELSE 'Faltam '||(a.goal-a.progress)||' ponto(s) para ganhar: *'||a.reward_name||'*.' END ELSE '[Envio ignorado: cliente não autorizou notificações]' END,
 CASE WHEN o.whatsapp_opt_in=1 THEN 'pending' ELSE 'skipped_no_optin' END,0,3,
 CASE WHEN o.whatsapp_opt_in=1 THEN o.updated_at ELSE NULL END,o.updated_at,o.updated_at
 FROM orders o JOIN loyalty_accounts a ON a.tenant_id=o.tenant_id AND a.customer_id=o.customer_id
 WHERE o.id=NEW.order_id AND o.tenant_id=NEW.tenant_id AND (1);
END;
CREATE TRIGGER loyalty_reinstate AFTER UPDATE OF state ON loyalty_earnings
WHEN OLD.state='revoked' AND NEW.state='pending'
BEGIN
 INSERT INTO loyalty_accounts(tenant_id,customer_id,progress,goal,reward_name,updated_at)
 SELECT NEW.tenant_id,NEW.customer_id,1,o.loyalty_goal,o.loyalty_reward_name,o.updated_at FROM orders o WHERE o.id=NEW.order_id AND o.tenant_id=NEW.tenant_id
 ON CONFLICT(tenant_id,customer_id) DO UPDATE SET
 goal=CASE WHEN progress=0 THEN excluded.goal ELSE goal END,
 reward_name=CASE WHEN progress=0 THEN excluded.reward_name ELSE reward_name END,
 progress=progress+1,updated_at=excluded.updated_at;
 INSERT INTO whatsapp_message_queue(id,tenant_id,order_id,event_type,idempotency_key,recipient_phone,recipient_name,rendered_message,status,attempts,max_attempts,next_retry_at,created_at,updated_at)
 SELECT lower(hex(randomblob(16))),o.tenant_id,o.id,'loyalty_earned',o.id||':loyalty_earned:'||NEW.revision,o.customer_phone,o.customer_name,
 CASE WHEN o.whatsapp_opt_in=1 THEN 'Mais um ponto pra conta! 😎'||char(10)||'Esse é o *seu progresso atual* no Plano Fidelidade ⬇️'||char(10)||char(10)||CASE WHEN a.goal<=20 THEN substr('✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅',1,min(a.progress,a.goal))||substr('🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴',1,max(0,a.goal-a.progress))||' = 🎁'||char(10) ELSE '' END||'*'||a.progress||' de '||a.goal||' pontos*'||char(10)||CASE WHEN a.progress>=a.goal THEN '🎉 Você atingiu a meta! Seu prêmio *'||a.reward_name||'* ficará disponível após a confirmação das entregas.' ELSE 'Faltam '||(a.goal-a.progress)||' ponto(s) para ganhar: *'||a.reward_name||'*.' END ELSE '[Envio ignorado: cliente não autorizou notificações]' END,
 CASE WHEN o.whatsapp_opt_in=1 THEN 'pending' ELSE 'skipped_no_optin' END,0,3,
 CASE WHEN o.whatsapp_opt_in=1 THEN o.updated_at ELSE NULL END,o.updated_at,o.updated_at
 FROM orders o JOIN loyalty_accounts a ON a.tenant_id=o.tenant_id AND a.customer_id=o.customer_id
 WHERE o.id=NEW.order_id AND o.tenant_id=NEW.tenant_id AND (1);
END;
CREATE TRIGGER loyalty_reverse AFTER UPDATE OF state ON loyalty_earnings
WHEN OLD.state='pending' AND NEW.state='revoked'
BEGIN
 UPDATE loyalty_accounts SET progress=progress-1,updated_at=(SELECT updated_at FROM orders WHERE id=NEW.order_id)
 WHERE tenant_id=NEW.tenant_id AND customer_id=NEW.customer_id AND progress>0;
 -- Evita enviar um aviso antigo de ganho que ainda não saiu da fila.
 UPDATE whatsapp_message_queue SET status='skipped_disabled',next_retry_at=NULL,last_error='Ponto recalculado antes do envio'
 WHERE tenant_id=NEW.tenant_id AND order_id=NEW.order_id AND event_type='loyalty_earned' AND status='pending';
 INSERT INTO whatsapp_message_queue(id,tenant_id,order_id,event_type,idempotency_key,recipient_phone,recipient_name,rendered_message,status,attempts,max_attempts,next_retry_at,created_at,updated_at)
 SELECT lower(hex(randomblob(16))),o.tenant_id,o.id,'loyalty_recalculated',o.id||':loyalty_recalculated:'||NEW.revision,o.customer_phone,o.customer_name,
 CASE WHEN o.whatsapp_opt_in=1 THEN CASE WHEN o.status='cancelled' THEN 'Que pena! Seu pedido *nº '||o.order_number||'* foi cancelado.' ELSE 'Seu pedido *nº '||o.order_number||'* foi atualizado e ficou abaixo do valor mínimo para pontuar.' END||char(10)||'Seus *pontos de fidelidade foram recalculados!*'||char(10)||char(10)||'Saldo anterior: *'||(a.progress+1)||' de '||a.goal||' pontos*'||char(10)||'Saldo atual: *'||a.progress||' de '||a.goal||' pontos*'||char(10)||char(10)||CASE WHEN a.goal<=20 THEN substr('✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅',1,min(a.progress,a.goal))||substr('🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴',1,max(0,a.goal-a.progress))||' = 🎁'||char(10) ELSE '' END||'*'||a.progress||' de '||a.goal||' pontos*'||char(10)||'Pontos das outras compras preservados.' ELSE '[Envio ignorado: cliente não autorizou notificações]' END,
 CASE WHEN o.whatsapp_opt_in=1 THEN 'pending' ELSE 'skipped_no_optin' END,0,3,
 CASE WHEN o.whatsapp_opt_in=1 THEN o.updated_at ELSE NULL END,o.updated_at,o.updated_at
 FROM orders o JOIN loyalty_accounts a ON a.tenant_id=o.tenant_id AND a.customer_id=o.customer_id
 WHERE o.id=NEW.order_id AND o.tenant_id=NEW.tenant_id AND (1);
END;
CREATE TRIGGER loyalty_confirm AFTER UPDATE OF state ON loyalty_earnings
WHEN OLD.state='pending' AND NEW.state='confirmed'
BEGIN
 INSERT INTO loyalty_rewards(id,tenant_id,customer_id,earned_order_id,reward_name,points_used,created_at)
 SELECT lower(hex(randomblob(16))),a.tenant_id,a.customer_id,NEW.order_id,a.reward_name,a.goal,o.updated_at
 FROM loyalty_accounts a JOIN orders o ON o.id=NEW.order_id AND o.tenant_id=a.tenant_id
 WHERE a.tenant_id=NEW.tenant_id AND a.customer_id=NEW.customer_id
 AND ((SELECT COUNT(*) FROM loyalty_earnings e WHERE e.tenant_id=a.tenant_id AND e.customer_id=a.customer_id AND e.state='confirmed')
 -COALESCE((SELECT SUM(points_used) FROM loyalty_rewards r WHERE r.tenant_id=a.tenant_id AND r.customer_id=a.customer_id),0))>=a.goal;
 UPDATE loyalty_accounts SET progress=progress-COALESCE((SELECT points_used FROM loyalty_rewards WHERE tenant_id=NEW.tenant_id AND earned_order_id=NEW.order_id),0)
 WHERE tenant_id=NEW.tenant_id AND customer_id=NEW.customer_id;
 INSERT INTO whatsapp_message_queue(id,tenant_id,order_id,event_type,idempotency_key,recipient_phone,recipient_name,rendered_message,status,attempts,max_attempts,next_retry_at,created_at,updated_at)
 SELECT lower(hex(randomblob(16))),o.tenant_id,o.id,'loyalty_reward',o.id||':loyalty_reward:'||NEW.revision,o.customer_phone,o.customer_name,
 CASE WHEN o.whatsapp_opt_in=1 THEN '🎉 Parabéns! Seu prêmio de fidelidade está disponível: *'||(SELECT reward_name FROM loyalty_rewards WHERE tenant_id=NEW.tenant_id AND earned_order_id=NEW.order_id)||'*! Fale com a loja para resgatar.'||char(10)||'Saldo atual: '||a.progress||' de '||a.goal||' pontos.' ELSE '[Envio ignorado: cliente não autorizou notificações]' END,
 CASE WHEN o.whatsapp_opt_in=1 THEN 'pending' ELSE 'skipped_no_optin' END,0,3,
 CASE WHEN o.whatsapp_opt_in=1 THEN o.updated_at ELSE NULL END,o.updated_at,o.updated_at
 FROM orders o JOIN loyalty_accounts a ON a.tenant_id=o.tenant_id AND a.customer_id=o.customer_id
 WHERE o.id=NEW.order_id AND o.tenant_id=NEW.tenant_id AND (EXISTS(SELECT 1 FROM loyalty_rewards WHERE tenant_id=NEW.tenant_id AND earned_order_id=NEW.order_id));
END;
CREATE TRIGGER loyalty_order_change AFTER UPDATE OF status,subtotal_cents ON orders
BEGIN
 UPDATE loyalty_earnings SET state='revoked',revision=revision+1,subtotal_cents=NEW.subtotal_cents
 WHERE tenant_id=NEW.tenant_id AND order_id=NEW.id AND state='pending'
 AND (NEW.status='cancelled' OR NEW.subtotal_cents<minimum_cents);
 INSERT INTO loyalty_earnings(tenant_id,order_id,customer_id,minimum_cents,subtotal_cents,state,revision,created_at)
 SELECT NEW.tenant_id,NEW.id,NEW.customer_id,NEW.loyalty_minimum_cents,NEW.subtotal_cents,'pending',0,NEW.updated_at
 WHERE NEW.status IN ('received','accepted','preparing') AND NEW.customer_id IS NOT NULL AND NEW.deleted_at IS NULL AND NEW.loyalty_minimum_cents>0 AND NEW.loyalty_goal BETWEEN 1 AND 100 AND NEW.loyalty_reward_name IS NOT NULL AND NEW.subtotal_cents>=NEW.loyalty_minimum_cents
 AND NOT EXISTS(SELECT 1 FROM loyalty_earnings WHERE tenant_id=NEW.tenant_id AND order_id=NEW.id);
 UPDATE loyalty_earnings SET state='pending',revision=revision+1,subtotal_cents=NEW.subtotal_cents
 WHERE tenant_id=NEW.tenant_id AND order_id=NEW.id AND state='revoked'
 AND NEW.status IN ('received','accepted','preparing') AND NEW.customer_id IS NOT NULL AND NEW.deleted_at IS NULL AND NEW.loyalty_minimum_cents>0 AND NEW.loyalty_goal BETWEEN 1 AND 100 AND NEW.loyalty_reward_name IS NOT NULL AND NEW.subtotal_cents>=NEW.loyalty_minimum_cents;
 UPDATE loyalty_earnings SET state='confirmed',revision=revision+1,subtotal_cents=NEW.subtotal_cents
 WHERE tenant_id=NEW.tenant_id AND order_id=NEW.id AND state='pending'
 AND NEW.status='delivered' AND NEW.stock_state='committed';
END;
