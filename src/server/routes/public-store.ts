import {dispatchLoyaltyNotifications} from '../services/loyalty-notifications';
import {readLoyalty} from '../../shared/loyalty';
import {getStoreStatus,readSchedule,formatScheduleHours} from '../../shared/store-hours';
import {customSelectionSchema,readCustomConfig,customConfigAvailable} from '../../shared/custom-product';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppHonoEnv } from '../context';
import { generateId } from '../security/crypto';
import { calculateChangeCents, normalizePhoneBR, parseBRLToCents } from '../../shared/pricing';
import { buildAtomicStockReservationSteps, validateAndPrepareOrderLines } from '../services/inventory';
import { enqueueAndDispatchOrderWhatsAppNotification, enqueueAndDispatchStaffOrderNotification } from '../services/evolution-whatsapp';
import { runConditionalTransaction } from '../db/adapter';
import {curatedProductImage} from '../services/product-images';

export const publicStoreRoutes = new Hono<AppHonoEnv>();

publicStoreRoutes.get('/:slug/status',async(c)=>{
 const tenant=await c.get('services').db.prepare("SELECT is_open,opening_schedule_json,business_hours FROM tenants WHERE slug=? AND status='active'").bind(c.req.param('slug')).first<{is_open:number;opening_schedule_json:string|null;business_hours:string|null}>();
 c.header('Cache-Control','no-store');
 return tenant?c.json(getStoreStatus(!!tenant.is_open,tenant.opening_schedule_json,new Date(),tenant.business_hours)):c.json({error:'Loja indisponível.'},404);
});

publicStoreRoutes.get('/:slug', async (c) => {
  const db = c.get('services').db;
  const tenant = await db.prepare(`SELECT id, slug, name, logo_url, banner_url, banner_title, banner_subtitle,
    primary_color, accent_color, button_color, page_background_color, surface_color, text_color, use_logo_colors, logo_palette_json, whatsapp_public, instagram_url, address_text, business_hours, delivery_info,
    default_delivery_fee_cents, free_delivery_min_cents, min_order_cents, is_open,opening_schedule_json,loyalty_config_json,
    accepts_cash, accepts_pix_delivery, accepts_debit_delivery, accepts_credit_delivery,
    signup_popup_enabled, signup_popup_emojis, signup_popup_eyebrow, signup_popup_title, signup_popup_description, signup_popup_button, signup_popup_name_label, signup_popup_email_label, signup_popup_phone_label, signup_popup_privacy_consent, signup_popup_marketing_consent, signup_popup_privacy_note
    FROM tenants WHERE slug = ? AND status = 'active'`).bind(c.req.param('slug')).first<Record<string, any>>();
  if (!tenant) return c.json({ error: 'Loja não encontrada ou temporariamente indisponível.' }, 404);
  const { results: categories } = await db.prepare(`SELECT id, name, slug, icon, sort_order FROM categories WHERE tenant_id = ? AND is_active = 1 ORDER BY sort_order, name`).bind(tenant.id).all();
  const { results: products } = await db.prepare(`SELECT p.id, p.category_id, p.name, p.description, p.image_url, p.sale_mode, p.fixed_options_enabled, p.custom_config_json, p.unit_label, p.pricing_unit_grams, p.min_qty, p.step_qty, p.preset_quantities_json, p.price_cents, p.promo_price_cents, p.unit_price_cents, p.unit_weight_grams, p.is_featured, lib.source_page_url AS photo_source_url, lib.license_name AS photo_license, lib.author AS photo_author,
    CASE WHEN p.sale_mode='weight' AND p.unit_price_cents IS NOT NULL AND p.unit_weight_grams IS NOT NULL
      AND (CASE WHEN p.stock_pool_id IS NOT NULL THEN (sp.physical_qty-sp.reserved_qty) ELSE (p.physical_qty-p.reserved_qty) END)>=p.unit_weight_grams
      THEN 1 ELSE 0 END AS unit_available,
    CASE WHEN p.sale_mode = 'variants' THEN EXISTS (SELECT 1 FROM product_variants av LEFT JOIN stock_pools asp ON asp.id=av.stock_pool_id WHERE av.tenant_id=p.tenant_id AND av.product_id=p.id AND av.is_active=1 AND CASE WHEN av.stock_pool_id IS NOT NULL THEN (asp.physical_qty-asp.reserved_qty)>=av.pool_deduction_qty ELSE (av.physical_qty-av.reserved_qty)>0 END) WHEN p.stock_pool_id IS NOT NULL THEN (sp.physical_qty - sp.reserved_qty) > 0 ELSE (p.physical_qty - p.reserved_qty) > 0 END AS available
    FROM products p LEFT JOIN stock_pools sp ON sp.id = p.stock_pool_id
    LEFT JOIN product_image_library lib ON lib.image_url=p.image_url
    WHERE p.tenant_id = ? AND p.is_active = 1 AND p.is_deleted = 0
      AND CASE WHEN p.sale_mode = 'variants' THEN EXISTS (SELECT 1 FROM product_variants av LEFT JOIN stock_pools asp ON asp.id=av.stock_pool_id WHERE av.tenant_id=p.tenant_id AND av.product_id=p.id AND av.is_active=1 AND CASE WHEN av.stock_pool_id IS NOT NULL THEN (asp.physical_qty-asp.reserved_qty)>=av.pool_deduction_qty ELSE (av.physical_qty-av.reserved_qty)>0 END) WHEN p.stock_pool_id IS NOT NULL THEN (sp.physical_qty - sp.reserved_qty) > 0 ELSE (p.physical_qty - p.reserved_qty) > 0 END = 1
    ORDER BY p.is_featured DESC, p.name`).bind(tenant.id).all<Record<string, any>>();
  // Crédito de imagem licenciada mesmo quando o arquivo está servido pelo
  // repositório original enquanto aguarda a importação ao R2.
  for(const product of products){
   if(product.photo_source_url||!product.image_url)continue;
   const curated=curatedProductImage(String(product.name));
   if(curated&&curated.imageUrl===product.image_url){
    product.photo_source_url=curated.sourcePageUrl;
    product.photo_license=curated.licenseName;
    product.photo_author=curated.author;
   }
  }
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
  const publicProducts = products.filter((p:any)=>{if(!p.custom_config_json)return true;try{return customConfigAvailable(readCustomConfig(p.custom_config_json)!);}catch{return false;}}).filter((p: any) => p.sale_mode !== 'variants' || (variantMap.get(p.id)?.length || 0) > 0)
    .map(({ available, ...p }: any) => ({ ...p, variants: (variantMap.get(p.id) || []).map(({ available: _variantAvailable, ...v }: any) => v) }));
  const { results: neighborhoods } = await db.prepare(`SELECT name, delivery_fee_cents, estimated_time FROM neighborhoods WHERE tenant_id = ? AND is_active = 1 ORDER BY name`).bind(tenant.id).all();
  const {results:banners}=await db.prepare(
    'SELECT id,image_url,mobile_image_url,sort_order FROM store_banners WHERE tenant_id=? AND is_active=1 ORDER BY sort_order,created_at LIMIT 10'
  ).bind(tenant.id).all();
  const storeStatus=getStoreStatus(!!tenant.is_open,tenant.opening_schedule_json,new Date(),tenant.business_hours);
  let visibleHours=tenant.business_hours;
  try{const detailed=readSchedule(tenant.opening_schedule_json);if(detailed.enabled)visibleHours=formatScheduleHours(detailed);}catch{}
  const {opening_schedule_json,loyalty_config_json,...publicTenant}=tenant;
  const loyalty=readLoyalty(loyalty_config_json);
  return c.json({ store: {...publicTenant,is_open:storeStatus.open?1:0,store_status:storeStatus,business_hours:visibleHours,loyalty:loyalty.enabled?{...loyalty,reward:loyalty.showReward?loyalty.reward:''}:null}, categories, products: publicProducts, neighborhoods, banners });
});

// Cadastro voluntário — não cria pedidos, cupons ou envios automáticos.
// A loja é resolvida pelo slug e o telefone é único apenas dentro desse tenant.
const signupSchema = z.object({
  name: z.string().trim().min(3, 'Informe seu nome completo.').max(140)
    .refine(v => v.split(/\s+/).length >= 2, 'Informe nome e sobrenome.'),
  email: z.email('Informe um e-mail válido.').max(200),
  phone: z.string().trim().min(10).max(32),
  privacyAccepted: z.literal(true),
  marketingOptIn: z.boolean().default(false),
  website: z.string().max(200).optional().default(''),
});
publicStoreRoutes.post('/:slug/signup', async(c) => {
  const parsed=signupSchema.safeParse(await c.req.json().catch(()=>null));
  if(!parsed.success) return c.json({error:parsed.error.issues[0]?.message||'Dados inválidos.'},400);
  const input=parsed.data;
  if(input.website) return c.json({ok:true}); // honeypot de formulário
  const db=c.get('services').db;
  const tenant=await db.prepare("SELECT id, signup_popup_enabled FROM tenants WHERE slug=? AND status='active'")
    .bind(c.req.param('slug')).first<{id:string;signup_popup_enabled:number}>();
  if(!tenant) return c.json({error:'Estabelecimento não encontrado.'},404);
  if(!tenant.signup_popup_enabled) return c.json({error:'Cadastro indisponível nesta loja.'},403);
  const phone=normalizePhoneBR(input.phone);
  if(!/^55\d{10,11}$/.test(phone)) return c.json({error:'Informe um celular com DDD válido.'},400);
  const name=input.name.replace(/\s+/g,' ').trim();
  const email=input.email.trim().toLowerCase();
  const now=new Date().toISOString();
  try {
    await db.prepare(`INSERT INTO customers(
      id,tenant_id,name,phone,email,whatsapp_opt_in,marketing_opt_in,
      marketing_consented_at,signup_consented_at,signup_source,
      orders_count,total_spent_cents,created_at,updated_at
    ) VALUES(?,?,?,?,?,0,?,?,?,?,0,0,?,?)
    ON CONFLICT(tenant_id,phone) DO UPDATE SET
      name=excluded.name,email=excluded.email,marketing_opt_in=excluded.marketing_opt_in,
      marketing_consented_at=excluded.marketing_consented_at,
      signup_consented_at=excluded.signup_consented_at,updated_at=excluded.updated_at`)
      .bind(generateId(),tenant.id,name,phone,email,input.marketingOptIn?1:0,
        input.marketingOptIn?now:null,now,'popup',now,now).run();
    return c.json({ok:true,message:'Cadastro realizado com sucesso!'});
  }catch{
    return c.json({error:'Não conseguimos concluir seu cadastro. Tente novamente.'},500);
  }
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
  items: z.array(z.object({ productId: z.string().min(1), variantId: z.string().optional().nullable(), purchaseMode: z.enum(['weight','unit']).optional(), customization:customSelectionSchema.optional(), quantity: z.number().int().positive() })).min(1).max(40),
});

publicStoreRoutes.post('/:slug/orders', async (c) => {
  const services = c.get('services');
  const db = services.db;
  const parsed = checkoutSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message || 'Confira os dados do pedido.' }, 400);
  const body = parsed.data;
  const tenant = await db.prepare(`SELECT * FROM tenants WHERE slug = ? AND status = 'active'`).bind(c.req.param('slug')).first<Record<string, any>>();
  if (!tenant) return c.json({ error: 'Loja indisponível.' }, 404);
  if (!getStoreStatus(!!tenant.is_open,tenant.opening_schedule_json,new Date(),tenant.business_hours).open) return c.json({ error: 'A loja está fechada no momento e não está aceitando pedidos.' }, 409);
  const payAllowed = { cash: tenant.accepts_cash, pix_delivery: tenant.accepts_pix_delivery, debit_card: tenant.accepts_debit_delivery, credit_card: tenant.accepts_credit_delivery } as Record<string, number>;
  if (!payAllowed[body.paymentMethod]) return c.json({ error: 'Esta forma de pagamento não está disponível nesta loja.' }, 400);

  try {
    const prepared = await validateAndPrepareOrderLines(db, tenant.id, body.items.map((i) => ({ product_id: i.productId, variant_id: i.variantId, purchase_mode: i.purchaseMode, customization:i.customization, quantity: i.quantity })));
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
    const loyalty=readLoyalty(tenant.loyalty_config_json);
    statements.push(db.prepare(`INSERT INTO orders (id, tenant_id, customer_id, order_number, status, stock_state, customer_name, customer_phone, whatsapp_opt_in, address_street, address_number, address_neighborhood, address_complement, address_reference, payment_method, needs_change, change_for_cents, change_amount_cents, subtotal_cents, delivery_fee_cents, total_cents, created_at, updated_at, loyalty_minimum_cents, loyalty_goal, loyalty_reward_name) VALUES (?, ?, ?, ?, 'received', 'reserved', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(orderId, tenant.id, customerId, orderNumber, body.customerName, phone, body.whatsappOptIn ? 1 : 0, body.street, body.number, neighborhood.name, body.complement, body.reference, body.paymentMethod, change.needsChange ? 1 : 0, change.changeForCents, change.changeAmountCents, prepared.subtotalCents, fee, total, timestamp, timestamp,loyalty.enabled?loyalty.minimumCents:null,loyalty.enabled?loyalty.goal:null,loyalty.enabled?loyalty.reward:null));
    for (const line of prepared.lines) {
      statements.push(db.prepare(`INSERT INTO order_items (id, tenant_id, order_id, product_id, variant_id, stock_pool_id, product_name_snapshot, variant_name_snapshot, sku_snapshot, sale_mode, quantity, quantity_display, stock_deducted_qty, unit_price_cents, pricing_unit_label, line_total_cents, original_line_total_cents, customization_snapshot) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(line.id, tenant.id, orderId, line.product_id, line.variant_id, line.stock_pool_id, line.product_name_snapshot, line.variant_name_snapshot, line.sku_snapshot, line.sale_mode, line.quantity, line.quantity_display, line.stock_deducted_qty, line.unit_price_cents, line.pricing_unit_label, line.line_total_cents,line.original_line_total_cents??null,line.customization_snapshot??null));
    }
    // Gera a comanda na MESMA transação do pedido: falha no checkout não cria
    // impressão órfã; cada pedido tem uma única comanda inicial por loja.
    // Sem Android pareado, a fila só guarda o trabalho — não imprime sozinha.
    statements.push(db.prepare(`INSERT INTO print_jobs
      (id,tenant_id,order_id,order_number,idempotency_key,created_at,updated_at)
      SELECT ?,t.id,?,?,?,?,? FROM tenants t
      WHERE t.id=? AND t.auto_print_enabled=1`)
      .bind(generateId(),orderId,orderNumber,`new-order:${orderId}`,timestamp,timestamp,tenant.id));
    const stockSteps = buildAtomicStockReservationSteps(db, tenant.id, orderId, orderNumber, prepared.lines, timestamp);
    await runConditionalTransaction(db, [...statements.map((stmt) => ({ stmt })), ...stockSteps]);
    await db.prepare(`UPDATE customers SET total_spent_cents = total_spent_cents + ? WHERE id = ? AND tenant_id = ?`).bind(total, customerId, tenant.id).run();
    await enqueueAndDispatchOrderWhatsAppNotification(db, tenant.id, orderId, 'order_received', services.evolution).catch(() => undefined);
    await enqueueAndDispatchStaffOrderNotification(db,tenant.id,orderId,services.evolution).catch(()=>undefined);
    await dispatchLoyaltyNotifications(db,tenant.id,orderId,services.evolution).catch(()=>undefined);
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
  const order = await db.prepare(`SELECT id, order_number, status, subtotal_cents, delivery_fee_cents, total_cents, created_at, updated_at FROM orders WHERE tenant_id = ? AND order_number = ? AND customer_phone = ? AND deleted_at IS NULL`).bind(t.id, Number(c.req.param('orderNumber')), phone).first();
  if (!order) return c.json({ error: 'Pedido não encontrado para este telefone.' }, 404);
  const { results: items } = await db.prepare(`SELECT product_name_snapshot, variant_name_snapshot, quantity_display, line_total_cents, customization_snapshot FROM order_items WHERE tenant_id = ? AND order_id = ?`).bind(t.id, (order as any).id).all();
  const {results:adjustments}=await db.prepare(`SELECT id,version,reason,old_total_cents,new_total_cents,
    changes_json,created_at FROM order_adjustments
    WHERE tenant_id=? AND order_id=? ORDER BY version DESC LIMIT 25`)
    .bind(t.id,(order as any).id).all<Record<string,any>>();
  return c.json({ order, items, adjustments:adjustments.map(x=>({
    id:x.id,version:x.version,reason:x.reason,old_total_cents:x.old_total_cents,
    new_total_cents:x.new_total_cents,created_at:x.created_at,
    changes:JSON.parse(x.changes_json||'[]')
  })) });
});
