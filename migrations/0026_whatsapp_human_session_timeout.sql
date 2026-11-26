-- Prazo configurável do atendimento humano e controle de encerramento.
ALTER TABLE whatsapp_auto_reply_settings ADD COLUMN human_timeout_minutes INTEGER NOT NULL DEFAULT 30;
ALTER TABLE whatsapp_auto_reply_settings ADD COLUMN human_timeout_message TEXT NOT NULL DEFAULT 'Por falta de comunicação, nossa conversa será encerrada. Quando precisar, é só mandar uma nova mensagem. 😊';
ALTER TABLE whatsapp_auto_reply_sessions ADD COLUMN last_bot_message_id TEXT;
ALTER TABLE whatsapp_auto_reply_sessions ADD COLUMN last_human_message_at TEXT;
ALTER TABLE whatsapp_auto_reply_sessions ADD COLUMN closure_claimed_at TEXT;
CREATE INDEX IF NOT EXISTS idx_whatsapp_human_sessions_timeout ON whatsapp_auto_reply_sessions(paused_until,closure_claimed_at);
