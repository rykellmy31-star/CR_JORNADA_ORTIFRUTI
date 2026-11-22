-- Respeita a preferência de exibição do prêmio nas mensagens WhatsApp.
-- Muda apenas a apresentação: pontos, elegibilidade e resgates ficam intactos.

DROP TRIGGER IF EXISTS loyalty_account_on_earn;
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
 CASE WHEN o.whatsapp_opt_in=1 THEN 'Mais um ponto pra conta! 😎'||char(10)||'Esse é o *seu progresso atual* no Plano Fidelidade ⬇️'||char(10)||char(10)||CASE WHEN a.goal<=20 THEN substr('✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅',1,min(a.progress,a.goal))||substr('⭕⭕⭕⭕⭕⭕⭕⭕⭕⭕⭕⭕⭕⭕⭕⭕⭕⭕⭕⭕',1,max(0,a.goal-a.progress))||' = 🎁'||char(10) ELSE '' END||'*'||a.progress||' de '||a.goal||' pontos*'||char(10)||CASE WHEN a.progress>=a.goal THEN CASE WHEN COALESCE(json_extract(t.loyalty_config_json,'$.showReward'),1)=1 THEN '🎉 Você atingiu a meta! Seu prêmio *'||a.reward_name||'* ficará disponível após a confirmação das entregas.' ELSE '🎉 Você atingiu a meta! Seu prêmio ficará disponível após a confirmação das entregas.' END ELSE CASE WHEN COALESCE(json_extract(t.loyalty_config_json,'$.showReward'),1)=1 THEN 'Faltam '||(a.goal-a.progress)||' ponto(s) para ganhar: *'||a.reward_name||'*.' ELSE 'Faltam '||(a.goal-a.progress)||' ponto(s) para conquistar seu prêmio!' END END ELSE '[Envio ignorado: cliente não autorizou notificações]' END,
 CASE WHEN o.whatsapp_opt_in=1 THEN 'pending' ELSE 'skipped_no_optin' END,0,3,
 CASE WHEN o.whatsapp_opt_in=1 THEN o.updated_at ELSE NULL END,o.updated_at,o.updated_at
 FROM orders o JOIN loyalty_accounts a ON a.tenant_id=o.tenant_id AND a.customer_id=o.customer_id JOIN tenants t ON t.id=o.tenant_id
 WHERE o.id=NEW.order_id AND o.tenant_id=NEW.tenant_id AND (1);
END;

DROP TRIGGER IF EXISTS loyalty_reinstate;
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
 CASE WHEN o.whatsapp_opt_in=1 THEN 'Mais um ponto pra conta! 😎'||char(10)||'Esse é o *seu progresso atual* no Plano Fidelidade ⬇️'||char(10)||char(10)||CASE WHEN a.goal<=20 THEN substr('✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅',1,min(a.progress,a.goal))||substr('⭕⭕⭕⭕⭕⭕⭕⭕⭕⭕⭕⭕⭕⭕⭕⭕⭕⭕⭕⭕',1,max(0,a.goal-a.progress))||' = 🎁'||char(10) ELSE '' END||'*'||a.progress||' de '||a.goal||' pontos*'||char(10)||CASE WHEN a.progress>=a.goal THEN CASE WHEN COALESCE(json_extract(t.loyalty_config_json,'$.showReward'),1)=1 THEN '🎉 Você atingiu a meta! Seu prêmio *'||a.reward_name||'* ficará disponível após a confirmação das entregas.' ELSE '🎉 Você atingiu a meta! Seu prêmio ficará disponível após a confirmação das entregas.' END ELSE CASE WHEN COALESCE(json_extract(t.loyalty_config_json,'$.showReward'),1)=1 THEN 'Faltam '||(a.goal-a.progress)||' ponto(s) para ganhar: *'||a.reward_name||'*.' ELSE 'Faltam '||(a.goal-a.progress)||' ponto(s) para conquistar seu prêmio!' END END ELSE '[Envio ignorado: cliente não autorizou notificações]' END,
 CASE WHEN o.whatsapp_opt_in=1 THEN 'pending' ELSE 'skipped_no_optin' END,0,3,
 CASE WHEN o.whatsapp_opt_in=1 THEN o.updated_at ELSE NULL END,o.updated_at,o.updated_at
 FROM orders o JOIN loyalty_accounts a ON a.tenant_id=o.tenant_id AND a.customer_id=o.customer_id JOIN tenants t ON t.id=o.tenant_id
 WHERE o.id=NEW.order_id AND o.tenant_id=NEW.tenant_id AND (1);
END;

DROP TRIGGER IF EXISTS loyalty_reverse;
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
 CASE WHEN o.whatsapp_opt_in=1 THEN CASE WHEN o.status='cancelled' THEN 'Que pena! Seu pedido *nº '||o.order_number||'* foi cancelado.' ELSE 'Seu pedido *nº '||o.order_number||'* foi atualizado e ficou abaixo do valor mínimo para pontuar.' END||char(10)||'Seus *pontos de fidelidade foram recalculados!*'||char(10)||char(10)||'Saldo anterior: *'||(a.progress+1)||' de '||a.goal||' pontos*'||char(10)||'Saldo atual: *'||a.progress||' de '||a.goal||' pontos*'||char(10)||char(10)||CASE WHEN a.goal<=20 THEN substr('✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅',1,min(a.progress,a.goal))||substr('⭕⭕⭕⭕⭕⭕⭕⭕⭕⭕⭕⭕⭕⭕⭕⭕⭕⭕⭕⭕',1,max(0,a.goal-a.progress))||' = 🎁'||char(10) ELSE '' END||'*'||a.progress||' de '||a.goal||' pontos*'||char(10)||'Pontos das outras compras preservados.' ELSE '[Envio ignorado: cliente não autorizou notificações]' END,
 CASE WHEN o.whatsapp_opt_in=1 THEN 'pending' ELSE 'skipped_no_optin' END,0,3,
 CASE WHEN o.whatsapp_opt_in=1 THEN o.updated_at ELSE NULL END,o.updated_at,o.updated_at
 FROM orders o JOIN loyalty_accounts a ON a.tenant_id=o.tenant_id AND a.customer_id=o.customer_id JOIN tenants t ON t.id=o.tenant_id
 WHERE o.id=NEW.order_id AND o.tenant_id=NEW.tenant_id AND (1);
END;

DROP TRIGGER IF EXISTS loyalty_confirm;
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
 CASE WHEN o.whatsapp_opt_in=1 THEN CASE WHEN COALESCE(json_extract(t.loyalty_config_json,'$.showReward'),1)=1 THEN '🎉 Parabéns! Seu prêmio de fidelidade está disponível: *'||(SELECT reward_name FROM loyalty_rewards WHERE tenant_id=NEW.tenant_id AND earned_order_id=NEW.order_id)||'*! Fale com a loja para resgatar.' ELSE '🎉 Parabéns! Seu prêmio de fidelidade está disponível! Fale com a loja para resgatar.' END||char(10)||'Saldo atual: '||a.progress||' de '||a.goal||' pontos.' ELSE '[Envio ignorado: cliente não autorizou notificações]' END,
 CASE WHEN o.whatsapp_opt_in=1 THEN 'pending' ELSE 'skipped_no_optin' END,0,3,
 CASE WHEN o.whatsapp_opt_in=1 THEN o.updated_at ELSE NULL END,o.updated_at,o.updated_at
 FROM orders o JOIN loyalty_accounts a ON a.tenant_id=o.tenant_id AND a.customer_id=o.customer_id JOIN tenants t ON t.id=o.tenant_id
 WHERE o.id=NEW.order_id AND o.tenant_id=NEW.tenant_id AND (EXISTS(SELECT 1 FROM loyalty_rewards WHERE tenant_id=NEW.tenant_id AND earned_order_id=NEW.order_id));
END;
