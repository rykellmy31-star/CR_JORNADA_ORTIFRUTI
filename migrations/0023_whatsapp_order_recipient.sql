-- Número interno que recebe alertas de novos pedidos pelo WhatsApp conectado.
ALTER TABLE tenants ADD COLUMN whatsapp_order_recipient_phone TEXT;
