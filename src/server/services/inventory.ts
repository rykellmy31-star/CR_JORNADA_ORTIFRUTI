import {readCustomConfig,resolveCustomSelection,customUnitPrice,completePizzaPair,type CustomSelection} from '../../shared/custom-product';
import {
  type DbClient,
  type DbPreparedStatement,
  StockConflictError,
  runConditionalTransaction,
} from '../db/adapter';
import { generateId } from '../security/crypto';
import {
  calculateLineTotalCents,
  formatQuantityDisplay,
  type SaleMode,
} from '../../shared/pricing';

export interface CheckoutItemInput {
  product_id: string;
  variant_id?: string | null;
  purchase_mode?: 'weight' | 'unit';
  customization?:CustomSelection;
  quantity: number;
}

export interface PreparedOrderLine {
  id: string;
  product_id: string;
  variant_id: string | null;
  stock_pool_id: string | null;
  target_type: 'product' | 'variant' | 'pool';
  target_id: string;
  target_name: string;
  unit: 'g' | 'un';
  product_name_snapshot: string;
  variant_name_snapshot: string | null;
  sku_snapshot: string | null;
  sale_mode: SaleMode;
  quantity: number;
  quantity_display: string;
  stock_deducted_qty: number;
  unit_price_cents: number;
  pricing_unit_label: string;
  line_total_cents: number;
  original_line_total_cents?: number|null;
  customization_snapshot?:string|null;
}

interface ProductRow {
  custom_config_json:string|null;
  id: string;
  tenant_id: string;
  name: string;
  sku: string | null;
  sale_mode: SaleMode;
  unit_label: string;
  pricing_unit_grams: number;
  min_qty: number;
  step_qty: number;
  price_cents: number;
  promo_price_cents: number | null;
  unit_price_cents: number | null;
  unit_weight_grams: number | null;
  is_active: number;
  is_deleted: number;
  stock_pool_id: string | null;
  pool_deduction_qty: number;
  physical_qty: number;
  reserved_qty: number;
}

interface VariantRow {
  id: string;
  tenant_id: string;
  product_id: string;
  sku: string | null;
  name: string;
  price_cents: number;
  promo_price_cents: number | null;
  stock_pool_id: string | null;
  pool_deduction_qty: number;
  physical_qty: number;
  reserved_qty: number;
  is_active: number;
}

interface StockPoolRow {
  id: string;
  tenant_id: string;
  name: string;
  base_unit: 'g' | 'un';
  physical_qty: number;
  reserved_qty: number;
}

/**
 * Valida cada item do carrinho contra o catálogo isolado da empresa (`tenantId`),
 * verifica incrementos fracionados, preços promocionais vigentes e prepara as demandas de estoque.
 */
export async function validateAndPrepareOrderLines(
  db: DbClient,
  tenantId: string,
  items: CheckoutItemInput[]
): Promise<{ lines: PreparedOrderLine[]; subtotalCents: number }> {
  if (!items || items.length === 0) {
    throw new Error('O carrinho está vazio. Adicione pelo menos um produto.');
  }

  const lines: PreparedOrderLine[] = [];
  let subtotalCents = 0;

  for (const rawItem of items) {
    if (!Number.isInteger(rawItem.quantity) || rawItem.quantity <= 0) {
      throw new Error('Quantidade inválida informada para um dos itens do pedido.');
    }

    const product = await db
      .prepare(
        `SELECT id, tenant_id, name, sku, sale_mode, unit_label, pricing_unit_grams,
                min_qty, step_qty, price_cents, promo_price_cents, unit_price_cents, unit_weight_grams, is_active, is_deleted,custom_config_json,
                stock_pool_id, pool_deduction_qty, physical_qty, reserved_qty
         FROM products
         WHERE id = ? AND tenant_id = ? AND is_deleted = 0`
      )
      .bind(rawItem.product_id, tenantId)
      .first<ProductRow>();

    if (!product || !product.is_active) {
      throw new StockConflictError(
        'Um dos produtos selecionados não está mais disponível para venda.'
      );
    }

    const config=readCustomConfig(product.custom_config_json);
    if(config&&(product.sale_mode!=='unit'||rawItem.variant_id||rawItem.purchase_mode==='weight'))throw Error('Modalidade inválida para produto personalizável.');
    if(!config&&rawItem.customization)throw Error('Este produto não possui complementos.');
    let selection=rawItem.customization;
    if(config&&selection?.flavorMode==='half-and-half'){
      if(!selection.pairedProductId)throw Error('Finalize a escolha do segundo sabor antes de concluir o pedido.');
      const second=await db.prepare(`SELECT id,name,custom_config_json,price_cents,promo_price_cents,sale_mode,is_active,physical_qty,reserved_qty FROM products WHERE id=? AND tenant_id=? AND is_deleted=0`)
       .bind(selection.pairedProductId,tenantId).first<ProductRow>();
      if(!second||!second.is_active||second.sale_mode!=='unit'||second.physical_qty-second.reserved_qty<=0)
       throw new StockConflictError('O segundo sabor não está mais disponível.');
      selection=completePizzaPair(product,selection,second,selection.pairedRemovalIds||[]);
    }else if(selection&&(selection.pairedProductId||selection.pairedFlavorName||selection.pairedFlavorPriceCents!==undefined||selection.pairedRemovalIds?.length||selection.pairedRemovedNames?.length||selection.pairedRemainingNames?.length)){
      throw Error('Segundo sabor inválido para este pedido.');
    }
    const custom=config?resolveCustomSelection(config,selection):null;
    if (product.sale_mode === 'variants') {
      if (!rawItem.variant_id) {
        throw new Error(`Selecione uma opção/embalagem para o produto "${product.name}".`);
      }

      const variant = await db
        .prepare(
          `SELECT id, tenant_id, product_id, sku, name, price_cents, promo_price_cents,
                  stock_pool_id, pool_deduction_qty, physical_qty, reserved_qty, is_active
           FROM product_variants
           WHERE id = ? AND product_id = ? AND tenant_id = ?`
        )
        .bind(rawItem.variant_id, product.id, tenantId)
        .first<VariantRow>();

      if (!variant || !variant.is_active) {
        throw new StockConflictError(
          `A embalagem selecionada para "${product.name}" não está disponível.`
        );
      }

      const effectivePrice =
        variant.promo_price_cents !== null && variant.promo_price_cents < variant.price_cents
          ? variant.promo_price_cents
          : variant.price_cents;

      const lineTotal = calculateLineTotalCents(effectivePrice, rawItem.quantity, 'variants', 1);

      let targetType: 'variant' | 'pool' = 'variant';
      let targetId = variant.id;
      let targetName = `${product.name} — ${variant.name}`;
      let unit: 'g' | 'un' = 'un';
      let deductedQty = rawItem.quantity;

      if (variant.stock_pool_id) {
        const pool = await db
          .prepare(`SELECT id, tenant_id, name, base_unit, physical_qty, reserved_qty FROM stock_pools WHERE id = ? AND tenant_id = ?`)
          .bind(variant.stock_pool_id, tenantId)
          .first<StockPoolRow>();
        if (!pool) {
          throw new Error(`Origem de estoque compartilhado não encontrada para "${variant.name}".`);
        }
        targetType = 'pool';
        targetId = pool.id;
        targetName = pool.name;
        unit = pool.base_unit;
        deductedQty = rawItem.quantity * variant.pool_deduction_qty;
      }

      lines.push({
        id: generateId(),
        product_id: product.id,
        variant_id: variant.id,
        stock_pool_id: variant.stock_pool_id,
        target_type: targetType,
        target_id: targetId,
        target_name: targetName,
        unit,
        product_name_snapshot: product.name,
        variant_name_snapshot: variant.name,
        sku_snapshot: variant.sku || product.sku,
        sale_mode: 'variants',
        quantity: rawItem.quantity,
        quantity_display: formatQuantityDisplay(
          rawItem.quantity,
          'variants',
          product.unit_label,
          variant.name
        ),
        stock_deducted_qty: deductedQty,
        unit_price_cents: effectivePrice,
        pricing_unit_label: variant.name,
        line_total_cents: lineTotal,
        original_line_total_cents: effectivePrice<variant.price_cents?calculateLineTotalCents(variant.price_cents,rawItem.quantity,'variants',1):null,
      });

      subtotalCents += lineTotal;
    } else {
      // Produto comum ou venda mista por peso/unidade com o mesmo estoque físico.
      const isDual = product.sale_mode === 'weight' &&
        product.unit_price_cents !== null && product.unit_weight_grams !== null;
      const purchaseMode = rawItem.purchase_mode || product.sale_mode;
      if (purchaseMode !== product.sale_mode && !(isDual && purchaseMode === 'unit')) {
        throw new Error(`A forma de venda selecionada não está disponível para "${product.name}".`);
      }
      const isUnitFromWeight = isDual && purchaseMode === 'unit';
      const minimum = isUnitFromWeight ? 1 : product.min_qty;
      const increment = isUnitFromWeight ? 1 : product.step_qty;
      const label = isUnitFromWeight ? 'un' : product.unit_label;
      if (rawItem.quantity < minimum) {
        throw new Error(`A quantidade mínima para "${product.name}" é ${formatQuantityDisplay(minimum, purchaseMode, label)}.`);
      }
      if (increment > 1 && rawItem.quantity % increment !== 0) {
        throw new Error(`A quantidade de "${product.name}" deve respeitar incrementos de ${formatQuantityDisplay(increment, purchaseMode, label)}.`);
      }
      const effectivePrice = isUnitFromWeight
        ? product.unit_price_cents!
        : product.promo_price_cents !== null && product.promo_price_cents < product.price_cents
          ? product.promo_price_cents : product.price_cents;
      const finalUnitPrice=custom?customUnitPrice(effectivePrice,custom):effectivePrice;
      const lineTotal = calculateLineTotalCents(
        finalUnitPrice, rawItem.quantity, purchaseMode, product.pricing_unit_grams
      );

      let targetType: 'product' | 'pool' = 'product';
      let targetId = product.id;
      let targetName = product.name;
      let unit: 'g' | 'un' = product.sale_mode === 'weight' ? 'g' : 'un';
      // Cada unidade escolhida consome seu peso médio configurado em gramas.
      let deductedQty = isUnitFromWeight
        ? rawItem.quantity * product.unit_weight_grams! : rawItem.quantity;
      if (!Number.isSafeInteger(deductedQty) || deductedQty <= 0) {
        throw new Error('Quantidade não suportada para esta forma de venda.');
      }

      if (product.stock_pool_id) {
        const pool = await db
          .prepare(`SELECT id, tenant_id, name, base_unit, physical_qty, reserved_qty FROM stock_pools WHERE id = ? AND tenant_id = ?`)
          .bind(product.stock_pool_id, tenantId)
          .first<StockPoolRow>();
        if (!pool) throw new Error(`Origem de estoque compartilhado inválida para "${product.name}".`);
        if (isUnitFromWeight && pool.base_unit !== 'g') {
          throw new Error('Estoque compartilhado incompatível com venda por unidade e kg.');
        }
        targetType = 'pool';
        targetId = pool.id;
        targetName = pool.name;
        unit = pool.base_unit;
        deductedQty *= product.pool_deduction_qty;
      }

      lines.push({
        id: generateId(),
        product_id: product.id,
        variant_id: null,
        stock_pool_id: product.stock_pool_id,
        target_type: targetType,
        target_id: targetId,
        target_name: targetName,
        unit,
        product_name_snapshot: product.name,
        variant_name_snapshot: null,
        sku_snapshot: product.sku,
        sale_mode: purchaseMode,
        quantity: rawItem.quantity,
        quantity_display: formatQuantityDisplay(rawItem.quantity, purchaseMode, label),
        stock_deducted_qty: deductedQty,
        unit_price_cents: finalUnitPrice,
        customization_snapshot:custom?.details||null,
        pricing_unit_label: label,
        line_total_cents: lineTotal,
        original_line_total_cents: !isUnitFromWeight&&effectivePrice<product.price_cents&&custom?.selectedBaseCents==null?calculateLineTotalCents(product.price_cents+(custom?.extrasCents||0),rawItem.quantity,purchaseMode,product.pricing_unit_grams):null,
      });

      subtotalCents += lineTotal;
    }
  }

  return { lines, subtotalCents };
}

/**
 * Monta os statements SQL atômicos de reserva de estoque agregando múltiplos itens que
 * compartilham o mesmo produto, variação ou pool físico (evitando venda duplicada do mesmo estoque!).
 */
export function buildAtomicStockReservationSteps(
  db: DbClient,
  tenantId: string,
  orderId: string,
  orderNumber: number,
  lines: PreparedOrderLine[],
  nowIso: string
): Array<{
  stmt: DbPreparedStatement;
  requireChanges?: number;
  failErrorMessage?: string;
}> {
  // Agrega demandas por bucket único (`target_type:target_id`)
  const aggregated = new Map<
    string,
    {
      target_type: 'product' | 'variant' | 'pool';
      target_id: string;
      target_name: string;
      product_id: string | null;
      variant_id: string | null;
      stock_pool_id: string | null;
      unit: 'g' | 'un';
      total_deducted_qty: number;
    }
  >();

  for (const line of lines) {
    const key = `${line.target_type}:${line.target_id}`;
    const existing = aggregated.get(key);
    if (existing) {
      existing.total_deducted_qty += line.stock_deducted_qty;
    } else {
      aggregated.set(key, {
        target_type: line.target_type,
        target_id: line.target_id,
        target_name: line.target_name,
        product_id: line.target_type === 'product' ? line.product_id : null,
        variant_id: line.target_type === 'variant' ? line.variant_id : null,
        stock_pool_id: line.target_type === 'pool' ? line.stock_pool_id : null,
        unit: line.unit,
        total_deducted_qty: line.stock_deducted_qty,
      });
    }
  }

  const steps: Array<{
    stmt: DbPreparedStatement;
    requireChanges?: number;
    failErrorMessage?: string;
  }> = [];

  for (const bucket of aggregated.values()) {
    const qty = bucket.total_deducted_qty;

    if (bucket.target_type === 'product') {
      steps.push({
        stmt: db
          .prepare(
            `UPDATE products
             SET reserved_qty = reserved_qty + ?, updated_at = ?
             WHERE id = ? AND tenant_id = ? AND is_active = 1 AND is_deleted = 0
               AND (physical_qty - reserved_qty) >= ?`
          )
          .bind(qty, nowIso, bucket.target_id, tenantId, qty),
        requireChanges: 1,
        failErrorMessage: `Estoque insuficiente para "${bucket.target_name}". Outro cliente pode ter acabado de reservar as últimas unidades.`,
      });

      steps.push({
        stmt: db
          .prepare(
            `INSERT INTO stock_movements (
               id, tenant_id, target_type, product_id, variant_id, stock_pool_id,
               target_name, movement_type, delta_physical, delta_reserved,
               physical_after, reserved_after, unit, order_id, actor_user_id, reason, created_at
             )
             SELECT ?, ?, 'product', id, NULL, NULL,
                    ?, 'reserve', 0, ?,
                    physical_qty, reserved_qty, ?, ?, NULL, ?, ?
             FROM products WHERE id = ? AND tenant_id = ?`
          )
          .bind(
            generateId(),
            tenantId,
            bucket.target_name,
            qty,
            bucket.unit,
            orderId,
            `Reserva automática — Pedido #${orderNumber}`,
            nowIso,
            bucket.target_id,
            tenantId
          ),
      });
    } else if (bucket.target_type === 'variant') {
      steps.push({
        stmt: db
          .prepare(
            `UPDATE product_variants
             SET reserved_qty = reserved_qty + ?, updated_at = ?
             WHERE id = ? AND tenant_id = ? AND is_active = 1
               AND (physical_qty - reserved_qty) >= ?`
          )
          .bind(qty, nowIso, bucket.target_id, tenantId, qty),
        requireChanges: 1,
        failErrorMessage: `Estoque insuficiente para "${bucket.target_name}".`,
      });

      steps.push({
        stmt: db
          .prepare(
            `INSERT INTO stock_movements (
               id, tenant_id, target_type, product_id, variant_id, stock_pool_id,
               target_name, movement_type, delta_physical, delta_reserved,
               physical_after, reserved_after, unit, order_id, actor_user_id, reason, created_at
             )
             SELECT ?, ?, 'variant', product_id, id, NULL,
                    ?, 'reserve', 0, ?,
                    physical_qty, reserved_qty, ?, ?, NULL, ?, ?
             FROM product_variants WHERE id = ? AND tenant_id = ?`
          )
          .bind(
            generateId(),
            tenantId,
            bucket.target_name,
            qty,
            bucket.unit,
            orderId,
            `Reserva automática — Pedido #${orderNumber}`,
            nowIso,
            bucket.target_id,
            tenantId
          ),
      });
    } else {
      // Shared Stock Pool
      steps.push({
        stmt: db
          .prepare(
            `UPDATE stock_pools
             SET reserved_qty = reserved_qty + ?, updated_at = ?
             WHERE id = ? AND tenant_id = ?
               AND (physical_qty - reserved_qty) >= ?`
          )
          .bind(qty, nowIso, bucket.target_id, tenantId, qty),
        requireChanges: 1,
        failErrorMessage: `Estoque compartilhado insuficiente em "${bucket.target_name}" para atender a combinação de embalagens selecionada.`,
      });

      steps.push({
        stmt: db
          .prepare(
            `INSERT INTO stock_movements (
               id, tenant_id, target_type, product_id, variant_id, stock_pool_id,
               target_name, movement_type, delta_physical, delta_reserved,
               physical_after, reserved_after, unit, order_id, actor_user_id, reason, created_at
             )
             SELECT ?, ?, 'pool', NULL, NULL, id,
                    ?, 'reserve', 0, ?,
                    physical_qty, reserved_qty, ?, ?, NULL, ?, ?
             FROM stock_pools WHERE id = ? AND tenant_id = ?`
          )
          .bind(
            generateId(),
            tenantId,
            bucket.target_name,
            qty,
            bucket.unit,
            orderId,
            `Reserva automática compartilhada — Pedido #${orderNumber}`,
            nowIso,
            bucket.target_id,
            tenantId
          ),
      });
    }
  }

  return steps;
}

interface OrderItemStockRecord {
  product_id: string;
  variant_id: string | null;
  stock_pool_id: string | null;
  product_name_snapshot: string;
  variant_name_snapshot: string | null;
  sale_mode: SaleMode;
  stock_deducted_qty: number;
}

/**
 * Baixa definitiva do estoque reservado ao concluir a entrega (`reserved` -> `committed`).
 * Garante matematicamente que NUNCA ocorra desconto duplicado!
 */
export async function commitOrderStockOnDelivery(
  db: DbClient,
  tenantId: string,
  orderId: string,
  orderNumber: number,
  actorUserId: string | null
): Promise<void> {
  const { results: items } = await db
    .prepare(
      `SELECT product_id, variant_id, stock_pool_id, product_name_snapshot,
              variant_name_snapshot, sale_mode, stock_deducted_qty
       FROM order_items
       WHERE order_id = ? AND tenant_id = ?`
    )
    .bind(orderId, tenantId)
    .all<OrderItemStockRecord>();

  const nowIso = new Date().toISOString();
  const steps: Array<{
    stmt: DbPreparedStatement;
    requireChanges?: number;
    failErrorMessage?: string;
  }> = [
    {
      stmt: db
        .prepare(
          `UPDATE orders
           SET status = 'delivered', stock_state = 'committed', delivered_at = ?, updated_at = ?
           WHERE id = ? AND tenant_id = ? AND stock_state = 'reserved' AND status != 'cancelled'`
        )
        .bind(nowIso, nowIso, orderId, tenantId),
      requireChanges: 1,
      failErrorMessage: 'Este pedido já teve seu estoque baixado ou foi cancelado anteriormente.',
    },
  ];

  // Agrega por bucket
  const buckets = aggregateOrderItemBuckets(items);

  for (const b of buckets) {
    if (b.type === 'pool') {
      steps.push({
        stmt: db
          .prepare(
            `UPDATE stock_pools
             SET physical_qty = physical_qty - ?, reserved_qty = reserved_qty - ?, updated_at = ?
             WHERE id = ? AND tenant_id = ? AND reserved_qty >= ? AND physical_qty >= ?`
          )
          .bind(b.qty, b.qty, nowIso, b.id, tenantId, b.qty, b.qty),
        requireChanges: 1,
        failErrorMessage: 'Inconsistência ao baixar reserva de estoque compartilhado.',
      });
      steps.push({
        stmt: db
          .prepare(
            `INSERT INTO stock_movements (
               id, tenant_id, target_type, product_id, variant_id, stock_pool_id,
               target_name, movement_type, delta_physical, delta_reserved,
               physical_after, reserved_after, unit, order_id, actor_user_id, reason, created_at
             )
             SELECT ?, ?, 'pool', NULL, NULL, id, name, 'commit_delivery', ?, ?,
                    physical_qty, reserved_qty, base_unit, ?, ?, ?, ?
             FROM stock_pools WHERE id = ? AND tenant_id = ?`
          )
          .bind(
            generateId(),
            tenantId,
            -b.qty,
            -b.qty,
            orderId,
            actorUserId,
            `Baixa definitiva na entrega — Pedido #${orderNumber}`,
            nowIso,
            b.id,
            tenantId
          ),
      });
    } else if (b.type === 'variant') {
      steps.push({
        stmt: db
          .prepare(
            `UPDATE product_variants
             SET physical_qty = physical_qty - ?, reserved_qty = reserved_qty - ?, updated_at = ?
             WHERE id = ? AND tenant_id = ? AND reserved_qty >= ? AND physical_qty >= ?`
          )
          .bind(b.qty, b.qty, nowIso, b.id, tenantId, b.qty, b.qty),
        requireChanges: 1,
        failErrorMessage: 'Inconsistência ao baixar reserva da variação.',
      });
      steps.push({
        stmt: db
          .prepare(
            `INSERT INTO stock_movements (
               id, tenant_id, target_type, product_id, variant_id, stock_pool_id,
               target_name, movement_type, delta_physical, delta_reserved,
               physical_after, reserved_after, unit, order_id, actor_user_id, reason, created_at
             )
             SELECT ?, ?, 'variant', product_id, id, NULL, ?, 'commit_delivery', ?, ?,
                    physical_qty, reserved_qty, 'un', ?, ?, ?, ?
             FROM product_variants WHERE id = ? AND tenant_id = ?`
          )
          .bind(
            generateId(),
            tenantId,
            b.label,
            -b.qty,
            -b.qty,
            orderId,
            actorUserId,
            `Baixa definitiva na entrega — Pedido #${orderNumber}`,
            nowIso,
            b.id,
            tenantId
          ),
      });
    } else {
      steps.push({
        stmt: db
          .prepare(
            `UPDATE products
             SET physical_qty = physical_qty - ?, reserved_qty = reserved_qty - ?, updated_at = ?
             WHERE id = ? AND tenant_id = ? AND reserved_qty >= ? AND physical_qty >= ?`
          )
          .bind(b.qty, b.qty, nowIso, b.id, tenantId, b.qty, b.qty),
        requireChanges: 1,
        failErrorMessage: 'Inconsistência ao baixar reserva do produto.',
      });
      steps.push({
        stmt: db
          .prepare(
            `INSERT INTO stock_movements (
               id, tenant_id, target_type, product_id, variant_id, stock_pool_id,
               target_name, movement_type, delta_physical, delta_reserved,
               physical_after, reserved_after, unit, order_id, actor_user_id, reason, created_at
             )
             SELECT ?, ?, 'product', id, NULL, NULL, name, 'commit_delivery', ?, ?,
                    physical_qty, reserved_qty, CASE WHEN sale_mode = 'weight' THEN 'g' ELSE 'un' END,
                    ?, ?, ?, ?
             FROM products WHERE id = ? AND tenant_id = ?`
          )
          .bind(
            generateId(),
            tenantId,
            -b.qty,
            -b.qty,
            orderId,
            actorUserId,
            `Baixa definitiva na entrega — Pedido #${orderNumber}`,
            nowIso,
            b.id,
            tenantId
          ),
      });
    }
  }

  await runConditionalTransaction(db, steps);
}

/**
 * Reposição automática e integral do estoque quando um pedido é cancelado,
 * funcionando tanto para pedidos ainda reservados ('reserved') quanto já baixados ('committed'),
 * impedindo estorno duplicado ('released').
 */
export async function cancelOrderAndRestoreStock(
  db: DbClient,
  tenantId: string,
  orderId: string,
  orderNumber: number,
  currentStockState: 'reserved' | 'committed' | 'released',
  cancelReason: string,
  actorUserId: string | null
): Promise<void> {
  if (currentStockState === 'released') {
    throw new StockConflictError('Este pedido já foi cancelado e seu estoque já foi recomposto.');
  }

  const { results: items } = await db
    .prepare(
      `SELECT product_id, variant_id, stock_pool_id, product_name_snapshot,
              variant_name_snapshot, sale_mode, stock_deducted_qty
       FROM order_items
       WHERE order_id = ? AND tenant_id = ?`
    )
    .bind(orderId, tenantId)
    .all<OrderItemStockRecord>();

  const nowIso = new Date().toISOString();
  const steps: Array<{
    stmt: DbPreparedStatement;
    requireChanges?: number;
    failErrorMessage?: string;
  }> = [
    {
      stmt: db
        .prepare(
          `UPDATE orders
           SET status = 'cancelled', stock_state = 'released', cancel_reason = ?, cancelled_at = ?, updated_at = ?
           WHERE id = ? AND tenant_id = ? AND stock_state = ?`
        )
        .bind(cancelReason, nowIso, nowIso, orderId, tenantId, currentStockState),
      requireChanges: 1,
      failErrorMessage: 'O status do pedido foi alterado concorrentemente. Atualize a página.',
    },
  ];

  const buckets = aggregateOrderItemBuckets(items);
  const wasReserved = currentStockState === 'reserved';
  const movementType = wasReserved ? 'release_cancel' : 'return_cancel';

  for (const b of buckets) {
    if (b.type === 'pool') {
      steps.push({
        stmt: wasReserved
          ? db
              .prepare(
                `UPDATE stock_pools
                 SET reserved_qty = reserved_qty - ?, updated_at = ?
                 WHERE id = ? AND tenant_id = ? AND reserved_qty >= ?`
              )
              .bind(b.qty, nowIso, b.id, tenantId, b.qty)
          : db
              .prepare(
                `UPDATE stock_pools
                 SET physical_qty = physical_qty + ?, updated_at = ?
                 WHERE id = ? AND tenant_id = ?`
              )
              .bind(b.qty, nowIso, b.id, tenantId),
        requireChanges: 1,
      });
      steps.push({
        stmt: db
          .prepare(
            `INSERT INTO stock_movements (
               id, tenant_id, target_type, product_id, variant_id, stock_pool_id,
               target_name, movement_type, delta_physical, delta_reserved,
               physical_after, reserved_after, unit, order_id, actor_user_id, reason, created_at
             )
             SELECT ?, ?, 'pool', NULL, NULL, id, name, ?, ?, ?,
                    physical_qty, reserved_qty, base_unit, ?, ?, ?, ?
             FROM stock_pools WHERE id = ? AND tenant_id = ?`
          )
          .bind(
            generateId(),
            tenantId,
            movementType,
            wasReserved ? 0 : b.qty,
            wasReserved ? -b.qty : 0,
            orderId,
            actorUserId,
            `Estorno por cancelamento Pedido #${orderNumber}: ${cancelReason}`,
            nowIso,
            b.id,
            tenantId
          ),
      });
    } else if (b.type === 'variant') {
      steps.push({
        stmt: wasReserved
          ? db
              .prepare(
                `UPDATE product_variants
                 SET reserved_qty = reserved_qty - ?, updated_at = ?
                 WHERE id = ? AND tenant_id = ? AND reserved_qty >= ?`
              )
              .bind(b.qty, nowIso, b.id, tenantId, b.qty)
          : db
              .prepare(
                `UPDATE product_variants
                 SET physical_qty = physical_qty + ?, updated_at = ?
                 WHERE id = ? AND tenant_id = ?`
              )
              .bind(b.qty, nowIso, b.id, tenantId),
        requireChanges: 1,
      });
      steps.push({
        stmt: db
          .prepare(
            `INSERT INTO stock_movements (
               id, tenant_id, target_type, product_id, variant_id, stock_pool_id,
               target_name, movement_type, delta_physical, delta_reserved,
               physical_after, reserved_after, unit, order_id, actor_user_id, reason, created_at
             )
             SELECT ?, ?, 'variant', product_id, id, NULL, ?, ?, ?, ?,
                    physical_qty, reserved_qty, 'un', ?, ?, ?, ?
             FROM product_variants WHERE id = ? AND tenant_id = ?`
          )
          .bind(
            generateId(),
            tenantId,
            b.label,
            movementType,
            wasReserved ? 0 : b.qty,
            wasReserved ? -b.qty : 0,
            orderId,
            actorUserId,
            `Estorno por cancelamento Pedido #${orderNumber}: ${cancelReason}`,
            nowIso,
            b.id,
            tenantId
          ),
      });
    } else {
      steps.push({
        stmt: wasReserved
          ? db
              .prepare(
                `UPDATE products
                 SET reserved_qty = reserved_qty - ?, updated_at = ?
                 WHERE id = ? AND tenant_id = ? AND reserved_qty >= ?`
              )
              .bind(b.qty, nowIso, b.id, tenantId, b.qty)
          : db
              .prepare(
                `UPDATE products
                 SET physical_qty = physical_qty + ?, updated_at = ?
                 WHERE id = ? AND tenant_id = ?`
              )
              .bind(b.qty, nowIso, b.id, tenantId),
        requireChanges: 1,
      });
      steps.push({
        stmt: db
          .prepare(
            `INSERT INTO stock_movements (
               id, tenant_id, target_type, product_id, variant_id, stock_pool_id,
               target_name, movement_type, delta_physical, delta_reserved,
               physical_after, reserved_after, unit, order_id, actor_user_id, reason, created_at
             )
             SELECT ?, ?, 'product', id, NULL, NULL, name, ?, ?, ?,
                    physical_qty, reserved_qty, CASE WHEN sale_mode = 'weight' THEN 'g' ELSE 'un' END,
                    ?, ?, ?, ?
             FROM products WHERE id = ? AND tenant_id = ?`
          )
          .bind(
            generateId(),
            tenantId,
            movementType,
            wasReserved ? 0 : b.qty,
            wasReserved ? -b.qty : 0,
            orderId,
            actorUserId,
            `Estorno por cancelamento Pedido #${orderNumber}: ${cancelReason}`,
            nowIso,
            b.id,
            tenantId
          ),
      });
    }
  }

  await runConditionalTransaction(db, steps);
}

function aggregateOrderItemBuckets(items: OrderItemStockRecord[]) {
  const map = new Map<
    string,
    { type: 'pool' | 'variant' | 'product'; id: string; qty: number; label: string }
  >();
  for (const item of items) {
    let type: 'pool' | 'variant' | 'product' = 'product';
    let id = item.product_id;
    let label = item.product_name_snapshot;

    if (item.stock_pool_id) {
      type = 'pool';
      id = item.stock_pool_id;
    } else if (item.variant_id) {
      type = 'variant';
      id = item.variant_id;
      label = `${item.product_name_snapshot} — ${item.variant_name_snapshot || ''}`;
    }

    const key = `${type}:${id}`;
    const existing = map.get(key);
    if (existing) {
      existing.qty += item.stock_deducted_qty;
    } else {
      map.set(key, { type, id, qty: item.stock_deducted_qty, label });
    }
  }
  return Array.from(map.values());
}
