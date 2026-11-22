import type { DbClient } from './db/adapter';
import { generateId, hashPassword } from './security/crypto';
import { ensureTenantWhatsAppSetup, type EvolutionEnvConfig } from './services/evolution-whatsapp';

const now = () => new Date().toISOString();

export async function seedDatabase(db: DbClient, env: Record<string, string | undefined> = {}) {
  const superEmail = (env.SEED_SUPERADMIN_EMAIL || 'admin@crjornada.com.br').toLowerCase();
  const demoPassword = env.SEED_DEMO_PASSWORD || 'CRJornada!Local2026';
  const time = now();
  // Testes automatizados precisam de lojas de demonstração abertas para validar checkout/estoque
  // independentemente do dia da semana em que a CI é executada. Em produção preserva o horário real.
  const demoHours=(typeof process!=='undefined'&&process.env.VITEST==='true')?'Seg a Dom: 00h às 23h59':'Seg a Sáb: 07h às 19h • Dom: 07h às 12h';

  const superExisting = await db.prepare('SELECT id FROM users WHERE email = ?').bind(superEmail).first<{ id: string }>();
  if (!superExisting) {
    await db.prepare(`INSERT INTO users (id, tenant_id, name, email, password_hash, role, is_active, created_at, updated_at)
      VALUES (?, NULL, ?, ?, ?, 'superadmin', 1, ?, ?)`)
      .bind(generateId(), 'CR Jornada Super Admin', superEmail, await hashPassword(demoPassword), time, time).run();
  }

  const tenantSeeds = [
    { id: 'tenant-hortifruti-verde-vivo', slug: 'verde-vivo', name: 'Hortifruti Verde Vivo', color: '#16834b', banner: '/images/banners/hero-hortifruti.jpg', delivery: 600 },
    { id: 'tenant-verdurão-sabor-da-terra', slug: 'sabor-da-terra', name: 'Verdurão Sabor da Terra', color: '#287a45', banner: '/images/banners/hero-verdurao.jpg', delivery: 800 },
  ];
  const evolutionConfig: EvolutionEnvConfig = {
    evolutionApiUrl: env.EVOLUTION_API_URL,
    evolutionApiKey: env.EVOLUTION_API_KEY,
    publicWebhookUrl: env.PUBLIC_APP_URL,
    evolutionWebhookToken: env.EVOLUTION_WEBHOOK_TOKEN,
  };

  for (let ti = 0; ti < tenantSeeds.length; ti++) {
    const t = tenantSeeds[ti];
    const exists = await db.prepare('SELECT id FROM tenants WHERE id = ?').bind(t.id).first<{ id: string }>();
    if (exists) continue;
    await db.prepare(`INSERT INTO tenants (
      id, slug, name, status, plan, banner_url, banner_title, banner_subtitle, primary_color,
      whatsapp_public, instagram_url, address_text, business_hours, delivery_info,
      default_delivery_fee_cents, free_delivery_min_cents, min_order_cents, is_open,
      accepts_cash, accepts_pix_delivery, accepts_debit_delivery, accepts_credit_delivery,
      next_order_seq, created_at, updated_at
    ) VALUES (?, ?, ?, 'active', 'profissional', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, 1, 1, 1, 1, 1001, ?, ?)`)
      .bind(t.id, t.slug, t.name, t.banner, ti === 0 ? 'Fresquinho todo dia' : 'Da nossa terra para sua mesa', 'Frutas, verduras e legumes selecionados com carinho.', t.color,
        ti === 0 ? '(73) 99988-7766' : '(73) 99977-6655', 'https://instagram.com/', ti === 0 ? 'Centro, Itanhém - BA' : 'Centro, Medeiros Neto - BA', demoHours, 'Entregas no mesmo dia em bairros selecionados.', t.delivery, 12000, time, time).run();

    const ownerId = generateId();
    await db.prepare(`INSERT INTO users (id, tenant_id, name, email, phone, password_hash, role, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'owner', 1, ?, ?)`)
      .bind(ownerId, t.id, `Proprietário ${t.name}`, ti === 0 ? 'dono@verdevivo.local' : 'dono@sabordaterra.local', '73999990000', await hashPassword(demoPassword), time, time).run();

    const neighborhoods = ['Centro', 'São João', 'Bela Vista', 'Alto do Cruzeiro'];
    for (let i = 0; i < neighborhoods.length; i++) {
      await db.prepare(`INSERT INTO neighborhoods (id, tenant_id, name, delivery_fee_cents, estimated_time, is_active, created_at)
        VALUES (?, ?, ?, ?, '35-50 min', 1, ?)`)
        .bind(generateId(), t.id, neighborhoods[i], i === 0 ? t.delivery : t.delivery + 200, time).run();
    }

    const catIds = new Map<string, string>();
    const categorySeeds: Array<[string, string, string]> = [['Frutas', 'frutas', '🍌'], ['Verduras', 'verduras', '🥬'], ['Legumes', 'legumes', '🥕'], ['Ovos', 'ovos', '🥚']];
    for (const [i, [name, slug, icon]] of categorySeeds.entries()) {
      const id = generateId(); catIds.set(slug, id);
      await db.prepare(`INSERT INTO categories (id, tenant_id, name, slug, icon, sort_order, is_active, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?)`)
        .bind(id, t.id, name, slug, icon, i, time).run();
    }

    const poolId = generateId();
    await db.prepare(`INSERT INTO stock_pools (id, tenant_id, name, sku_code, base_unit, physical_qty, reserved_qty, low_stock_threshold, created_at, updated_at)
      VALUES (?, ?, 'Estoque físico de ovos (unidades)', 'OVOS-POOL', 'un', 360, 0, 60, ?, ?)`)
      .bind(poolId, t.id, time, time).run();

    const products = [
      { name: 'Banana prata', category: 'frutas', mode: 'weight', label: 'kg', price: 699, qty: 18000, image: 'banana.jpg', feat: 1, min: 100, step: 50 },
      { name: 'Morango selecionado', category: 'frutas', mode: 'weight', label: 'kg', price: 1690, qty: 8000, image: 'morango.jpg', feat: 1, min: 100, step: 50 },
      { name: 'Laranja pera', category: 'frutas', mode: 'weight', label: 'kg', price: 499, qty: 20000, image: 'laranja.jpg', feat: 0, min: 100, step: 50 },
      { name: 'Abacate', category: 'frutas', mode: 'weight', label: 'kg', price: 799, qty: 10000, image: 'abacate.jpg', feat: 0, min: 100, step: 50 },
      { name: 'Tomate italiano', category: 'legumes', mode: 'weight', label: 'kg', price: 899, qty: 12000, image: 'tomate.jpg', feat: 1, min: 100, step: 50 },
      { name: 'Beterraba', category: 'legumes', mode: 'weight', label: 'kg', price: 599, qty: 8000, image: 'beterraba.jpg', feat: 0, min: 100, step: 50 },
      { name: 'Batata inglesa', category: 'legumes', mode: 'weight', label: 'kg', price: 649, qty: 22000, image: 'batata-inglesa.jpg', feat: 0, min: 100, step: 50 },
      { name: 'Batata-doce', category: 'legumes', mode: 'weight', label: 'kg', price: 699, qty: 12000, image: 'batata-doce.jpg', feat: 0, min: 100, step: 50 },
      { name: 'Cenoura', category: 'legumes', mode: 'weight', label: 'kg', price: 549, qty: 14000, image: 'cenoura.jpg', feat: 0, min: 100, step: 50 },
      { name: 'Alface crespa', category: 'verduras', mode: 'unit', label: 'un', price: 350, qty: 35, image: 'alface.jpg', feat: 0, min: 1, step: 1 },
      { name: 'Cheiro-verde', category: 'verduras', mode: 'unit', label: 'maço', price: 250, qty: 45, image: 'cheiro-verde.jpg', feat: 0, min: 1, step: 1 },
    ];
    for (const p of products) {
      const id = generateId();
      await db.prepare(`INSERT INTO products (id, tenant_id, category_id, sku, name, description, image_url, sale_mode, unit_label, pricing_unit_grams, min_qty, step_qty, price_cents, is_featured, is_active, physical_qty, reserved_qty, low_stock_threshold, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1000, ?, ?, ?, ?, 1, ?, 0, ?, ?, ?)`)
        .bind(id, t.id, catIds.get(p.category), `${t.slug.toUpperCase()}-${p.name.slice(0, 3).toUpperCase()}`, p.name, 'Produto fresco selecionado diariamente.', `/images/products/${p.image}`, p.mode, p.label, p.min, p.step, p.price, p.feat, p.qty, p.mode === 'weight' ? 1500 : 5, time, time).run();
    }

    const eggProductId = generateId();
    await db.prepare(`INSERT INTO products (id, tenant_id, category_id, sku, name, description, image_url, sale_mode, unit_label, pricing_unit_grams, min_qty, step_qty, price_cents, is_featured, is_active, physical_qty, reserved_qty, low_stock_threshold, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'Ovos caipiras', 'Ovos frescos de galinhas criadas soltas.', '/images/products/ovos.jpg', 'variants', 'cartela', 1000, 1, 1, 0, 1, 1, 0, 0, 0, ?, ?)`)
      .bind(eggProductId, t.id, catIds.get('ovos'), `${t.slug.toUpperCase()}-OVOS`, time, time).run();
    for (const [name, eggs, price] of [['Cartela com 30 ovos', 30, 2390], ['Dúzia (12 ovos)', 12, 1090], ['Meia dúzia (6 ovos)', 6, 590]] as Array<[string, number, number]>) {
      await db.prepare(`INSERT INTO product_variants (id, tenant_id, product_id, sku, name, price_cents, stock_pool_id, pool_deduction_qty, physical_qty, reserved_qty, low_stock_threshold, sort_order, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, 1, ?, ?)`)
        .bind(generateId(), t.id, eggProductId, `${t.slug}-OVO-${eggs}`, name, price, poolId, eggs, eggs, time, time).run();
    }

    // Pedidos de exemplo com dados anonimizados/claramente demonstrativos; não são transações reais.
    const customerId = generateId();
    await db.prepare(`INSERT INTO customers (id, tenant_id, name, phone, default_street, default_number, default_neighborhood, whatsapp_opt_in, orders_count, total_spent_cents, last_order_at, created_at, updated_at)
      VALUES (?, ?, 'Ana Cliente Demo', '5573999000111', 'Rua das Flores', '25', 'Centro', 1, 1, 2098, ?, ?, ?)`)
      .bind(customerId, t.id, time, time, time).run();
    const orderId = generateId();
    const orderNumber = 1000 + ti;
    await db.prepare(`INSERT INTO orders (id, tenant_id, customer_id, order_number, status, stock_state, customer_name, customer_phone, whatsapp_opt_in, address_street, address_number, address_neighborhood, payment_method, needs_change, subtotal_cents, delivery_fee_cents, total_cents, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'received', 'reserved', 'Ana Cliente Demo', '5573999000111', 1, 'Rua das Flores', '25', 'Centro', 'pix_delivery', 0, 1498, ?, ?, ?, ?)`)
      .bind(orderId, t.id, customerId, orderNumber, t.delivery, 1498 + t.delivery, time, time).run();

    await ensureTenantWhatsAppSetup(db, t.id, t.slug, evolutionConfig);
  }
  return { seeded: true, demoPassword, superadminEmail: superEmail };
}
