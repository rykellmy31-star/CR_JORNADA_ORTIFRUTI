import type { OrderStatus, PaymentMethod, SaleMode } from './pricing';

export type TenantStatus = 'active' | 'blocked' | 'suspended' | 'onboarding';
export type UserRole = 'superadmin' | 'owner' | 'manager' | 'operator';

export interface PublicStoreInfo {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  banner_url: string | null;
  banner_title: string | null;
  banner_subtitle: string | null;
  primary_color: string;
  accent_color: string;
  whatsapp_public: string | null;
  instagram_url: string | null;
  address_text: string | null;
  business_hours: string | null;
  delivery_info: string | null;
  default_delivery_fee_cents: number;
  free_delivery_min_cents: number | null;
  min_order_cents: number;
  is_open: boolean;
  payment_methods: {
    cash: boolean;
    pix_delivery: boolean;
    debit_card: boolean;
    credit_card: boolean;
  };
  pix_instructions_note: string | null;
  neighborhoods: Array<{
    id: string;
    name: string;
    delivery_fee_cents: number;
    estimated_time: string;
  }>;
}

export interface PublicCategory {
  id: string;
  name: string;
  slug: string;
  icon: string;
  sort_order: number;
}

export interface PublicProductVariant {
  id: string;
  sku: string | null;
  name: string;
  price_cents: number;
  promo_price_cents: number | null;
  effective_price_cents: number;
  available: boolean;
}

/**
 * Produto público na vitrine — NUNCA expõe quantidades internas de estoque!
 */
export interface PublicProduct {
  id: string;
  category_id: string | null;
  category_name: string | null;
  sku: string | null;
  name: string;
  description: string | null;
  image_url: string | null;
  sale_mode: SaleMode;
  unit_label: string;
  pricing_unit_grams: number;
  min_qty: number;
  step_qty: number;
  preset_quantities: number[];
  price_cents: number;
  promo_price_cents: number | null;
  effective_price_cents: number;
  is_featured: boolean;
  has_promo: boolean;
  available: boolean;
  variants: PublicProductVariant[];
}

export interface CartItem {
  key: string; // `${productId}:${variantId || 'base'}`
  productId: string;
  variantId: string | null;
  name: string;
  variantName: string | null;
  imageUrl: string | null;
  saleMode: SaleMode;
  unitLabel: string;
  pricingUnitGrams: number;
  minQty: number;
  stepQty: number;
  unitPriceCents: number;
  quantity: number;
}

export interface OrderSummaryDTO {
  id: string;
  order_number: number;
  status: OrderStatus;
  stock_state: 'reserved' | 'committed' | 'released';
  customer_name: string;
  customer_phone: string;
  whatsapp_opt_in: boolean;
  address_street: string;
  address_number: string;
  address_neighborhood: string;
  address_complement: string | null;
  address_reference: string | null;
  notes: string | null;
  payment_method: PaymentMethod;
  needs_change: boolean;
  change_for_cents: number | null;
  change_amount_cents: number | null;
  subtotal_cents: number;
  delivery_fee_cents: number;
  total_cents: number;
  cancel_reason: string | null;
  created_at: string;
  updated_at: string;
  items: Array<{
    id: string;
    product_id: string;
    variant_id: string | null;
    product_name_snapshot: string;
    variant_name_snapshot: string | null;
    sku_snapshot: string | null;
    sale_mode: SaleMode;
    quantity: number;
    quantity_display: string;
    unit_price_cents: number;
    pricing_unit_label: string;
    line_total_cents: number;
  }>;
}
