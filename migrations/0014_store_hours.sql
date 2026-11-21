-- Horário semanal opcional. Lojas antigas mantêm a abertura manual.
ALTER TABLE tenants ADD COLUMN opening_schedule_json TEXT;
