import { Hono } from 'hono';
import { z } from 'zod';
import type { AppHonoEnv } from '../context';
import { generateId } from '../security/crypto';
import { calculateChangeCents, normalizePhoneBR, parseBRLToCents } from '../../shared/pricing';
import { buildAtomicStockReservationSteps, validateAndPrepareOrderLines } from '../services/inventory';
import { enqueueAndDispatchOrderWhatsAppNotification } from '../services/evolution-whatsapp';
import { runConditionalTransaction } from '../db/adapter';

export const publicStoreRoutes = new Hono<AppHonoEnv>();

publicStoreRoutes.get('/:slug', async (c) => {
  const db = c.get('services').db;
  const tenant = await db.prepare(`SELECT id, slug, name, logo_url, banner_url, banner_title, banner_subtitle,
    primary_color, accent_color, whatsapp_public, instagram_url, address_text, business_hours, delivery_info,
    default_delivery_fee_cents, free_delivery_min_cents, min_order_cents, is_open,
    accepts_cash, accepts_pix_delivery, accepts_debit_delivery, accepts_credit_delivery
    FROM tenants WHERE slug = ? AND status = 'active'`).bind(c.req.param('slug')).first<Record<string, any>>();
  if (!tenant) return c.json({ error: 'Loja não encontrada ou temporariamente indisponível.' }, 404);
  const { results: categories } = await db.prepare(`SELECT id, name, slug, icon, sort_order FROM categories WHERE tenant_id = ? AND is_active = 1 ORDER BY sort_order, name`).bind(tenant.id).all();
  const { results: products } = await db.prepare(`SELECT p.id, p.category_id, p.name, p.description, p.image_url, p.sale_mode, p.unit_label, p.pricing_unit_grams, p.min_qty, p.step_qty, p.preset_quantities_json, p.price_cents, p.promo_price_cents, p.is_featured,
    CASE WHEN p.sale_mode = 'variants' THEN EXISTS (SELECT 1 FROM product_variants av LEFT JOIN stock_pools asp ON asp.id=av.stock_pool_id WHERE av.tenant_id=p.tenant_id AND av.product_id=p.id AND av.is_active=1 AND CASE WHEN av.stock_pool_id IS NOT NULL THEN (asp.physical_qty-asp.reserved_qty)>=av.pool_deduction_qty ELSE (av.physical_qty-av.reserved_qty)>0 END) WHEN p.stock_pool_id IS NOT NULL THEN (sp.physical_qty - sp.reserved_qty) > 0 ELSE (p.physical_qty - p.reserved_qty) > 0 END AS available
    FROM products p LEFT JOIN stock_pools sp ON sp.id = p.stock_pool_id
    WHERE p.tenant_id = ? AND p.is_active = 1 AND p.is_deleted = 0
      AND CASE WHEN p.sale_mode = 'variants' THEN EXISTS (SELECT 1 FROM product_variants av LEFT JOIN stock_pools asp ON asp.id=av.stock_pool_id WHERE av.tenant_id=p.tenant_id AND av.product_id=p.id AND av.is_active=1 AND CASE WHEN av.stock_pool_id IS NOT NULL THEN (asp.physical_qty-asp.reserved_qty)>=av.pool_deduction_qty ELSE (av.physical_qty-av.reserved_qty)>0 END) WHEN p.stock_pool_id IS NOT NULL THEN (sp.physical_qty - sp.reserved_qty) > 0 ELSE (p.physical_qty - p.reserved_qty) > 0 END = 1
    ORDER BY p.is_featured DESC, p.name`).bind(tenant.id).all<Record<string, any>>();
  const variantsResult = await db.prepare(`SELECT v.id, v.product_id, v.name, v.sku, v.price_cents, v.promo_price_cents, v.sort_order,
    CASE WHEN v.stock_pool_id IS NOT NULL THEN (sp.physical_qty - sp.reserved_qty) >= v.pool_deduction_qty ELSE (v.physical_qty - v.reserved_qty) > 0 END AS available
    FROM product_variants v LEFT JOIN stock_pools sp ON sp.id = v.stock_pool_id
    WHERE v.tenant_id = ? AND v.is_active = 1 ORDER BY v.sort_order, v.name`).bind(tenant.id).all<Record<string, any>>();
  const variantMap = new Map<string, any[]>();
  for (const variant of variantsResult.results) {
    if (!variant.available) continue;
    const arr = variantMap.get(variant.product_id) || [];
    arr.push(variant); variantMap.set(variant.product_id, arr);
  }
  const publicProducts = products.filter((p: any) => p.sale_mode !== 'variants' || (variantMap.get(p.id)?.length || 0) > 0)
    .map(({ available, ...p }: any) => ({ ...p, variants: (variantMap.get(p.id) || []).map(({ available: _variantAvailable, ...v }: any) => v) }));
  const { results: neighborhoods } = await db.prepare(`SELECT name, delivery_fee_cents, estimated_time FROM neighborhoods WHERE tenant_id = ? AND is_active = 1 ORDER BY name`).bind(tenant.id).all();
  return c.json({ store: tenant, categories, products: publicProducts, neighborhoods });
});

const checkoutSchema = z.object({
  customerName: z.string().trim().min(2).max(140),
  phone: z.string().trim().min(8).max(32),
  street: z.string().trim().min(2).max(180),
  number: z.string().trim().min(1).max(30),
  neighborhood: z.string().trim().min(1).max(100),
  complement: z.string().trim().max(180).optional().default(''),
  reference: z.string().trim().max(220).optional().default(''),
  paymentMethod: z.enum(['cash', 'pix_delivery', 'debit_card', 'credit_card']),
  needsChange: z.boolean().default(false),
  changeFor: z.union([z.string(), z.number()]).optional(),
  whatsappOptIn: z.boolean().default(false),
  items: z.array(z.object({ productId: z.string().min(1), variantId: z.string().optional().nullable(), quantity: z.number().int().positive() })).min(1).max(40),
});

publicStoreRoutes.post('/:slug/orders', async (c) => {
  const services = c.get('services');
  const db = services.db;
  const parsed = checkoutSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message || 'Confira os dados do pedido.' }, 400);
  const body = parsed.data;
  const tenant = await db.prepare(`SELECT * FROM tenants WHERE slug = ? AND status = 'active'`).bind(c.req.param('slug')).first<Record<string, any>>();
  if (!tenant) return c.json({ error: 'Loja indisponível.' }, 404);
  if (!tenant.is_open) return c.json({ error: 'A loja está fechada no momento e não está aceitando pedidos.' }, 409);
  const payAllowed = { cash: tenant.accepts_cash, pix_delivery: tenant.accepts_pix_delivery, debit_card: tenant.accepts_debit_delivery, credit_card: tenant.accepts_credit_delivery } as Record<string, number>;
  if (!payAllowed[body.paymentMethod]) return c.json({ error: 'Esta forma de pagamento não está disponível nesta loja.' }, 400);

  try {
    const prepared = await validateAndPrepareOrderLines(db, tenant.id, body.items.map((i) => ({ product_id: i.productId, variant_id: i.variantId, quantity: i.quantity })));
    const neighborhood = await db.prepare(`SELECT name, delivery_fee_cents FROM neighborhoods WHERE tenant_id = ? AND lower(name) = lower(?) AND is_active = 1`).bind(tenant.id, body.neighborhood).first<{name:string;delivery_fee_cents:number}>();
    if (!neighborhood) return c.json({ error: 'Este bairro não está cadastrado para entrega.' }, 400);
    const fee = tenant.free_delivery_min_cents !== null && prepared.subtotalCents >= tenant.free_delivery_min_cents ? 0 : neighborhood.delivery_fee_cents;
    const total = prepared.subtotalCents + fee;
    if (total < tenant.min_order_cents) return c.json({ error: `O pedido mínimo é R$ ${(tenant.min_order_cents / 100).toFixed(2).replace('.', ',')}.` }, 400);
    if (body.paymentMethod !== 'cash' && body.needsChange) return c.json({ error: 'Troco somente é aplicável para pagamento em dinheiro.' }, 400);
    let change;
    try { change = calculateChangeCents(total, body.paymentMethod === 'cash' && body.needsChange, body.changeFor === undefined ? null : parseBRLToCents(body.changeFor)); }
    catch (e: any) { return c.json({ error: e.message }, 400); }

    const phone = normalizePhoneBR(body.phone);
    let customer = await db.prepare(`SELECT id FROM customers WHERE tenant_id = ? AND phone = ?`).bind(tenant.id, phone).first<{id:string}>();
    const customerId = customer?.id || generateId();
    const timestamp = new Date().toISOString();
    const orderId = generateId();
    const seq = await db.prepare(`UPDATE tenants SET next_order_seq = next_order_seq + 1, updated_at = ? WHERE id = ? RETURNING next_order_seq - 1 AS order_number`).bind(timestamp, tenant.id).first<{order_number:number}>();
    const orderNumber = seq?.order_number || 1001;
    const statements = [] as any[];
    if (customer) {
      statements.push(db.prepare(`UPDATE customers SET name = ?, default_street = ?, default_number = ?, default_neighborhood = ?, default_complement = ?, default_reference = ?, whatsapp_opt_in = ?, orders_count = orders_count + 1, last_order_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`).bind(body.customerName, body.street, body.number, neighborhood.name, body.complement, body.reference, body.whatsappOptIn ? 1 : 0, timestamp, timestamp, customerId, tenant.id));
    } else {
      statements.push(db.prepare(`INSERT INTO customers (id, tenant_id, name, phone, default_street, default_number, default_neighborhood, default_complement, default_reference, whatsapp_opt_in, orders_count, total_spent_cents, last_order_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?)`).bind(customerId, tenant.id, body.customerName, phone, body.street, body.number, neighborhood.name, body.complement, body.reference, body.whatsappOptIn ? 1 : 0, timestamp, timestamp, timestamp));
    }
    statements.push(db.prepare(`INSERT INTO orders (id, tenant_id, customer_id, order_number, status, stock_state, customer_name, customer_phone, whatsapp_opt_in, address_street, address_number, address_neighborhood, address_complement, address_reference, payment_method, needs_change, change_for_cents, change_amount_cents, subtotal_cents, delivery_fee_cents, total_cents, created_at, updated_at) VALUES (?, ?, ?, ?, 'received', 'reserved', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(orderId, tenant.id, customerId, orderNumber, body.customerName, phone, body.whatsappOptIn ? 1 : 0, body.street, body.number, neighborhood.name, body.complement, body.reference, body.paymentMethod, change.needsChange ? 1 : 0, change.changeForCents, change.changeAmountCents, prepared.subtotalCents, fee, total, timestamp, timestamp));
    for (const line of prepared.lines) {
      statements.push(db.prepare(`INSERT INTO order_items (id, tenant_id, order_id, product_id, variant_id, stock_pool_id, product_name_snapshot, variant_name_snapshot, sku_snapshot, sale_mode, quantity, quantity_display, stock_deducted_qty, unit_price_cents, pricing_unit_label, line_total_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(line.id, tenant.id, orderId, line.product_id, line.variant_id, line.stock_pool_id, line.product_name_snapshot, line.variant_name_snapshot, line.sku_snapshot, line.sale_mode, line.quantity, line.quantity_display, line.stock_deducted_qty, line.unit_price_cents, line.pricing_unit_label, line.line_total_cents));
    }
    const stockSteps = buildAtomicStockReservationSteps(db, tenant.id, orderId, orderNumber, prepared.lines, timestamp);
    await runConditionalTransaction(db, [...statements.map((stmt) => ({ stmt })), ...stockSteps]);
    await db.prepare(`UPDATE customers SET total_spent_cents = total_spent_cents + ? WHERE id = ? AND tenant_id = ?`).bind(total, customerId, tenant.id).run();
    await enqueueAndDispatchOrderWhatsAppNotification(db, tenant.id, orderId, 'order_received', services.evolution).catch(() => undefined);
    return c.json({ success: true, order: { id: orderId, number: orderNumber, status: 'received', subtotalCents: prepared.subtotalCents, deliveryFeeCents: fee, totalCents: total, changeForCents: change.changeForCents, changeAmountCents: change.changeAmountCents } }, 201);
  } catch (e: any) {
    const status = e?.statusCode || 400;
    return c.json({ error: e?.message || 'Não foi possível registrar o pedido.' }, status);
  }
});

publicStoreRoutes.get('/:slug/orders/:orderNumber', async (c) => {
  const db = c.get('services').db;
  const t = await db.prepare('SELECT id FROM tenants WHERE slug = ?').bind(c.req.param('slug')).first<{id:string}>();
  if (!t) return c.json({ error: 'Loja não encontrada.' }, 404);
  const phoneInput = c.req.query('phone') || '';
  const phone = normalizePhoneBR(phoneInput);
  if (phone.length < 12) return c.json({ error: 'Informe o telefone usado na compra para consultar o pedido.' }, 400);
  const order = await db.prepare(`SELECT id, order_number, status, subtotal_cents, delivery_fee_cents, total_cents, created_at, updated_at FROM orders WHERE tenant_id = ? AND order_number = ? AND customer_phone = ?`).bind(t.id, Number(c.req.param('orderNumber')), phone).first();
  if (!order) return c.json({ error: 'Pedido não encontrado para este telefone.' }, 404);
  const { results: items } = await db.prepare(`SELECT product_name_snapshot, variant_name_snapshot, quantity_display, line_total_cents FROM order_items WHERE tenant_id = ? AND order_id = ?`).bind(t.id, (order as any).id).all();
  return c.json({ order, items });
});
