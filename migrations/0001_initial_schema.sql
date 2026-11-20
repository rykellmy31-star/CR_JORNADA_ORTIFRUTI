-- =============================================================================
-- CR JORNADA HORTIFRUTI — CLOUDFLARE D1 / SQLITE MIGRATION 0001
-- Multi-tenant SaaS Schema with Strict Logical Tenant Isolation & Atomic Stock
-- =============================================================================

PRAGMA foreign_keys = ON;

-- 1. TENANTS (Estabelecimentos / Hortifrutis gerenciados pela CR Jornada)
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  crm_external_id TEXT UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  custom_domain TEXT UNIQUE,
  name TEXT NOT NULL,
  legal_name TEXT,
  document_cnpj TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked', 'suspended', 'onboarding')),
  blocked_reason TEXT,
  plan TEXT NOT NULL DEFAULT 'profissional',
  logo_url TEXT,
  banner_url TEXT,
  banner_title TEXT,
  banner_subtitle TEXT,
  primary_color TEXT NOT NULL DEFAULT '#16a34a',
  accent_color TEXT NOT NULL DEFAULT '#ea580c',
  whatsapp_public TEXT,
  instagram_url TEXT,
  address_text TEXT,
  business_hours TEXT DEFAULT 'Seg a Sáb: 07h às 19h • Dom: 07h às 13h',
  delivery_info TEXT DEFAULT 'Entregas rápidas com produtos selecionados fresquinhos do dia.',
  default_delivery_fee_cents INTEGER NOT NULL DEFAULT 600 CHECK (default_delivery_fee_cents >= 0),
  free_delivery_min_cents INTEGER,
  min_order_cents INTEGER NOT NULL DEFAULT 0 CHECK (min_order_cents >= 0),
  is_open INTEGER NOT NULL DEFAULT 1,
  accepts_cash INTEGER NOT NULL DEFAULT 1,
  accepts_pix_delivery INTEGER NOT NULL DEFAULT 1,
  accepts_debit_delivery INTEGER NOT NULL DEFAULT 1,
  accepts_credit_delivery INTEGER NOT NULL DEFAULT 1,
  pix_instructions_note TEXT,
  next_order_seq INTEGER NOT NULL DEFAULT 1001,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);
CREATE INDEX IF NOT EXISTS idx_tenants_crm_external_id ON tenants(crm_external_id);
CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);

-- 2. USERS (Usuários Administrativos por Empresa + Super-Admin CR Jornada)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('superadmin', 'owner', 'manager', 'operator')),
  is_active INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- 3. NEIGHBORHOODS (Bairros e Regiões Atendidas por Estabelecimento)
CREATE TABLE IF NOT EXISTS neighborhoods (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  delivery_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK (delivery_fee_cents >= 0),
  estimated_time TEXT DEFAULT '35-50 min',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE(tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_neighborhoods_tenant ON neighborhoods(tenant_id, is_active);

-- 4. CATEGORIES (Categorias da Vitrine por Estabelecimento)
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  icon TEXT DEFAULT '🥬',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE(tenant_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_categories_tenant ON categories(tenant_id, sort_order);

-- 5. STOCK POOLS (Origens de Estoque Físico Compartilhado — ex: Ovos em Unidades, Morangos em Gramas)
CREATE TABLE IF NOT EXISTS stock_pools (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sku_code TEXT,
  base_unit TEXT NOT NULL CHECK (base_unit IN ('g', 'un')),
  physical_qty INTEGER NOT NULL DEFAULT 0 CHECK (physical_qty >= 0),
  reserved_qty INTEGER NOT NULL DEFAULT 0 CHECK (reserved_qty >= 0 AND reserved_qty <= physical_qty),
  low_stock_threshold INTEGER NOT NULL DEFAULT 0 CHECK (low_stock_threshold >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stock_pools_tenant ON stock_pools(tenant_id);

-- 6. PRODUCTS (Produtos comercializados por Peso, Unidade ou Embalagens/Variações)
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  sku TEXT,
  name TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  sale_mode TEXT NOT NULL CHECK (sale_mode IN ('weight', 'unit', 'variants')),
  unit_label TEXT NOT NULL DEFAULT 'kg',
  pricing_unit_grams INTEGER NOT NULL DEFAULT 1000 CHECK (pricing_unit_grams > 0),
  min_qty INTEGER NOT NULL DEFAULT 100 CHECK (min_qty > 0),
  step_qty INTEGER NOT NULL DEFAULT 100 CHECK (step_qty > 0),
  preset_quantities_json TEXT,
  price_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  promo_price_cents INTEGER CHECK (promo_price_cents IS NULL OR promo_price_cents >= 0),
  is_featured INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  stock_pool_id TEXT REFERENCES stock_pools(id) ON DELETE SET NULL,
  pool_deduction_qty INTEGER NOT NULL DEFAULT 1 CHECK (pool_deduction_qty > 0),
  physical_qty INTEGER NOT NULL DEFAULT 0 CHECK (physical_qty >= 0),
  reserved_qty INTEGER NOT NULL DEFAULT 0 CHECK (reserved_qty >= 0 AND reserved_qty <= physical_qty),
  low_stock_threshold INTEGER NOT NULL DEFAULT 0 CHECK (low_stock_threshold >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_products_tenant ON products(tenant_id, is_deleted, is_active);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(tenant_id, category_id);
CREATE INDEX IF NOT EXISTS idx_products_pool ON products(tenant_id, stock_pool_id);

-- 7. PRODUCT VARIANTS (Variações e Embalagens — ex: Cartela 30 ovos, Dúzia 12 ovos, Meia Dúzia 6 ovos)
CREATE TABLE IF NOT EXISTS product_variants (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku TEXT,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  promo_price_cents INTEGER CHECK (promo_price_cents IS NULL OR promo_price_cents >= 0),
  stock_pool_id TEXT REFERENCES stock_pools(id) ON DELETE SET NULL,
  pool_deduction_qty INTEGER NOT NULL DEFAULT 1 CHECK (pool_deduction_qty > 0),
  physical_qty INTEGER NOT NULL DEFAULT 0 CHECK (physical_qty >= 0),
  reserved_qty INTEGER NOT NULL DEFAULT 0 CHECK (reserved_qty >= 0 AND reserved_qty <= physical_qty),
  low_stock_threshold INTEGER NOT NULL DEFAULT 0 CHECK (low_stock_threshold >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants(tenant_id, product_id, is_active);
CREATE INDEX IF NOT EXISTS idx_variants_pool ON product_variants(tenant_id, stock_pool_id);

-- 8. CUSTOMERS (Base de Clientes Isolada por Estabelecimento)
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  default_street TEXT,
  default_number TEXT,
  default_neighborhood TEXT,
  default_complement TEXT,
  default_reference TEXT,
  whatsapp_opt_in INTEGER NOT NULL DEFAULT 1,
  orders_count INTEGER NOT NULL DEFAULT 0,
  total_spent_cents INTEGER NOT NULL DEFAULT 0,
  last_order_at TEXT,
  lgpd_anonymized_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id, phone)
);

CREATE INDEX IF NOT EXISTS idx_customers_tenant ON customers(tenant_id, last_order_at DESC);

-- 9. ORDERS (Pedidos com Pagamento Exclusivamente na Entrega e Controle de Reserva)
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
  order_number INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('received', 'accepted', 'preparing', 'out_for_delivery', 'delivered', 'cancelled')),
  stock_state TEXT NOT NULL CHECK (stock_state IN ('reserved', 'committed', 'released')),
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  whatsapp_opt_in INTEGER NOT NULL DEFAULT 1,
  address_street TEXT NOT NULL,
  address_number TEXT NOT NULL,
  address_neighborhood TEXT NOT NULL,
  address_complement TEXT,
  address_reference TEXT,
  notes TEXT,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'pix_delivery', 'debit_card', 'credit_card')),
  needs_change INTEGER NOT NULL DEFAULT 0,
  change_for_cents INTEGER,
  change_amount_cents INTEGER,
  subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents >= 0),
  delivery_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK (delivery_fee_cents >= 0),
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
  cancel_reason TEXT,
  accepted_at TEXT,
  preparing_at TEXT,
  out_for_delivery_at TEXT,
  delivered_at TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id, order_number)
);

CREATE INDEX IF NOT EXISTS idx_orders_tenant_created ON orders(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_tenant_status ON orders(tenant_id, status);

-- 10. ORDER ITEMS (Itens do Pedido com Snapshot de Preços e Quantidade Fracionada Exata)
CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  variant_id TEXT REFERENCES product_variants(id),
  stock_pool_id TEXT REFERENCES stock_pools(id),
  product_name_snapshot TEXT NOT NULL,
  variant_name_snapshot TEXT,
  sku_snapshot TEXT,
  sale_mode TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  quantity_display TEXT NOT NULL,
  stock_deducted_qty INTEGER NOT NULL CHECK (stock_deducted_qty > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  pricing_unit_label TEXT NOT NULL,
  line_total_cents INTEGER NOT NULL CHECK (line_total_cents >= 0)
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(tenant_id, order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(tenant_id, product_id);

-- 11. STOCK MOVEMENTS (Histórico Auditável de Movimentações e Ajustes de Estoque)
CREATE TABLE IF NOT EXISTS stock_movements (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('product', 'variant', 'pool')),
  product_id TEXT,
  variant_id TEXT,
  stock_pool_id TEXT,
  target_name TEXT NOT NULL,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('initial', 'restock', 'manual_adjust', 'loss', 'reserve', 'commit_delivery', 'release_cancel', 'return_cancel')),
  delta_physical INTEGER NOT NULL DEFAULT 0,
  delta_reserved INTEGER NOT NULL DEFAULT 0,
  physical_after INTEGER NOT NULL,
  reserved_after INTEGER NOT NULL,
  unit TEXT NOT NULL,
  order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_tenant ON stock_movements(tenant_id, created_at DESC);

-- 12. WHATSAPP INSTANCES (Instância Isolada da Evolution API por Estabelecimento)
CREATE TABLE IF NOT EXISTS whatsapp_instances (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  instance_name TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('disconnected', 'qr_pending', 'connected')),
  connected_phone TEXT,
  profile_name TEXT,
  qr_code_base64 TEXT,
  qr_code_text TEXT,
  qr_updated_at TEXT,
  connected_at TEXT,
  last_checked_at TEXT,
  provider_mode TEXT NOT NULL DEFAULT 'homologation',
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 13. WHATSAPP TEMPLATES (Modelos Personalizáveis de Mensagens Transacionais por Empresa)
CREATE TABLE IF NOT EXISTS whatsapp_templates (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('order_received', 'order_accepted', 'order_preparing', 'order_out_for_delivery', 'order_delivered', 'order_cancelled')),
  title TEXT NOT NULL,
  message_template TEXT NOT NULL,
  is_enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id, event_type)
);

-- 14. WHATSAPP MESSAGE QUEUE (Fila Transacional com Idempotência, Tentativas e Histórico)
CREATE TABLE IF NOT EXISTS whatsapp_message_queue (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id TEXT REFERENCES orders(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  recipient_phone TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  rendered_message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'skipped_disabled', 'skipped_no_optin')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  next_retry_at TEXT,
  sent_at TEXT,
  provider_message_id TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_wa_queue_tenant ON whatsapp_message_queue(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_queue_pending ON whatsapp_message_queue(status, next_retry_at);

-- 15. AUDIT LOGS (Registro de Operações Relevantes, Segurança e LGPD)
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  actor_user_id TEXT,
  actor_role TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details_json TEXT,
  ip_address TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant ON audit_logs(tenant_id, created_at DESC);
