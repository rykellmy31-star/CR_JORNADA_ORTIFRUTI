/**
 * Motor determinístico de cálculos monetários (em centavos inteiros)
 * e quantidades fracionadas (em gramas ou unidades inteiras).
 * Evita 100% de erros de ponto flutuante IEEE-754.
 */

export type SaleMode = 'weight' | 'unit' | 'variants';
export type PaymentMethod = 'cash' | 'pix_delivery' | 'debit_card' | 'credit_card';
export type OrderStatus =
  | 'received'
  | 'accepted'
  | 'preparing'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled';

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Dinheiro na entrega',
  pix_delivery: 'Pix na entrega',
  debit_card: 'Cartão de Débito na entrega',
  credit_card: 'Cartão de Crédito na entrega',
};

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  received: 'Recebido',
  accepted: 'Aceito',
  preparing: 'Em preparação',
  out_for_delivery: 'Saiu para entrega',
  delivered: 'Entregue',
  cancelled: 'Cancelado',
};

export const ORDER_NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  received: 'accepted',
  accepted: 'preparing',
  preparing: 'out_for_delivery',
  out_for_delivery: 'delivered',
};

/**
 * Calcula o subtotal exato em centavos de um item.
 * Para produtos por peso ('weight'), `quantity` está em gramas inteiras (ex: 400 = 400g, 1500 = 1,5kg)
 * e `pricingUnitGrams` indica a base do preço (ex: 1000 para preço por kg, 500 para preço por 500g).
 * Utiliza arredondamento half-up determinístico em inteiros.
 */
export function calculateLineTotalCents(
  effectivePriceCents: number,
  quantity: number,
  saleMode: SaleMode,
  pricingUnitGrams: number = 1000
): number {
  if (!Number.isInteger(effectivePriceCents) || effectivePriceCents < 0) {
    throw new Error('Preço unitário inválido.');
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error('Quantidade deve ser um inteiro positivo.');
  }

  if (saleMode === 'weight') {
    if (!Number.isInteger(pricingUnitGrams) || pricingUnitGrams <= 0) {
      throw new Error('Unidade base de precificação por peso inválida.');
    }
    const numerator = effectivePriceCents * quantity;
    return Math.floor((numerator + Math.floor(pricingUnitGrams / 2)) / pricingUnitGrams);
  }

  return effectivePriceCents * quantity;
}

/**
 * Valida e calcula o troco em centavos para pagamentos em dinheiro.
 */
export function calculateChangeCents(
  totalCents: number,
  needsChange: boolean,
  changeForCents?: number | null
): { needsChange: boolean; changeForCents: number | null; changeAmountCents: number | null } {
  if (!needsChange) {
    return { needsChange: false, changeForCents: null, changeAmountCents: null };
  }

  if (
    changeForCents === undefined ||
    changeForCents === null ||
    !Number.isInteger(changeForCents)
  ) {
    throw new Error('Informe o valor em dinheiro que será entregue para cálculo do troco.');
  }

  if (changeForCents < totalCents) {
    throw new Error(
      `O valor entregue (${formatBRL(changeForCents)}) não pode ser inferior ao total da compra (${formatBRL(totalCents)}).`
    );
  }

  return {
    needsChange: true,
    changeForCents,
    changeAmountCents: changeForCents - totalCents,
  };
}

/**
 * Formata centavos inteiros para moeda Real brasileira (ex: 14000 -> "R$ 140,00")
 */
export function formatBRL(cents: number): string {
  const safeCents = Math.round(cents || 0);
  const negative = safeCents < 0;
  const abs = Math.abs(safeCents);
  const reais = Math.floor(abs / 100);
  const centavos = String(abs % 100).padStart(2, '0');
  const reaisFormatted = reais.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}R$ ${reaisFormatted},${centavos}`;
}

/**
 * Converte string monetária brasileira ("150,00", "R$ 9,50", "140") para centavos inteiros.
 */
export function parseBRLToCents(input: string | number): number {
  if (typeof input === 'number') {
    return Math.round(input * 100);
  }
  const cleaned = input
    .replace(/[R$\s]/g, '')
    .trim();
  if (!cleaned) return 0;

  if (cleaned.includes(',')) {
    const normalized = cleaned.replace(/\./g, '').replace(',', '.');
    const parsed = Number(normalized);
    if (Number.isNaN(parsed)) throw new Error('Valor monetário inválido.');
    return Math.round(parsed * 100);
  }

  const parsed = Number(cleaned);
  if (Number.isNaN(parsed)) throw new Error('Valor monetário inválido.');
  return Math.round(parsed * 100);
}

/**
 * Formata gramas de maneira amigável:
 * 400 -> "400 g"
 * 1000 -> "1 kg"
 * 1500 -> "1,5 kg"
 * 1250 -> "1,25 kg"
 */
export function formatWeightGrams(grams: number): string {
  const abs = Math.abs(grams);
  const sign = grams < 0 ? '-' : '';
  if (abs < 1000) {
    return `${sign}${abs} g`;
  }
  const kg = abs / 1000;
  const formatted = Number.isInteger(kg)
    ? String(kg)
    : kg.toFixed(3).replace(/\.?0+$/, '').replace('.', ',');
  return `${sign}${formatted} kg`;
}

/**
 * Formata quantidade de venda para vitrine, carrinho, pedidos e WhatsApp.
 */
export function formatQuantityDisplay(
  quantity: number,
  saleMode: SaleMode,
  unitLabel: string = 'un',
  variantName?: string | null
): string {
  if (saleMode === 'weight') {
    return formatWeightGrams(quantity);
  }
  if (saleMode === 'variants' && variantName) {
    return `${quantity}x ${variantName}`;
  }
  return `${quantity} ${unitLabel}`;
}

/**
 * Formata quantidade interna de estoque administrativo.
 */
export function formatStockQuantity(qty: number, baseUnit: 'g' | 'un', unitLabel?: string): string {
  if (baseUnit === 'g') {
    return formatWeightGrams(qty);
  }
  return `${qty} ${unitLabel || 'un'}`;
}

/**
 * Normaliza telefone brasileiro apenas para dígitos com DDI 55 quando aplicável.
 */
export function normalizePhoneBR(phone: string): string {
  const digits = (phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }
  return digits;
}

/**
 * Formata telefone para exibição amigável: (73) 99988-7766
 */
export function formatPhoneBR(phone: string): string {
  const digits = (phone || '').replace(/\D/g, '');
  const local = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
  if (local.length === 11) {
    return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  }
  if (local.length === 10) {
    return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  }
  return phone;
}

export function extractFirstName(fullName: string): string {
  const trimmed = (fullName || '').trim();
  if (!trimmed) return 'Cliente';
  return trimmed.split(/\s+/)[0];
}
