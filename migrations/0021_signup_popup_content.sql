-- Textos e emojis editáveis do convite de cadastro por estabelecimento.
ALTER TABLE tenants ADD COLUMN signup_popup_emojis TEXT NOT NULL DEFAULT '🛒 🍎 📦';
ALTER TABLE tenants ADD COLUMN signup_popup_eyebrow TEXT NOT NULL DEFAULT '🛒 NOVIDADES DA SUA LOJA';
ALTER TABLE tenants ADD COLUMN signup_popup_name_label TEXT NOT NULL DEFAULT 'Nome completo';
ALTER TABLE tenants ADD COLUMN signup_popup_email_label TEXT NOT NULL DEFAULT 'E-mail';
ALTER TABLE tenants ADD COLUMN signup_popup_phone_label TEXT NOT NULL DEFAULT 'Celular com WhatsApp e DDD';
ALTER TABLE tenants ADD COLUMN signup_popup_privacy_consent TEXT NOT NULL DEFAULT 'Autorizo o cadastro de meus dados nesta loja para identificação e contato relacionado ao meu cadastro.';
ALTER TABLE tenants ADD COLUMN signup_popup_marketing_consent TEXT NOT NULL DEFAULT 'Quero receber novidades e ofertas por WhatsApp e e-mail (opcional).';
ALTER TABLE tenants ADD COLUMN signup_popup_privacy_note TEXT NOT NULL DEFAULT 'Seus dados ficam vinculados somente a {loja}. Você escolhe se quer receber novidades e pode solicitar atualização ou exclusão à loja.';
