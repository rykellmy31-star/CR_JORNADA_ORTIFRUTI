import {customSelectionKey,type CustomSelection} from './custom-product';
/**
 * Conta quantos produtos diferentes há na cesta, não a soma das quantidades.
 * Um produto de 400 g conta como 1 item; duas unidades da mesma beterraba
 * continuam sendo 1 item. A mesma mercadoria escolhida por kg e unidade
 * também conta apenas uma vez para o indicador da cesta.
 */
export function countCartItems<T extends { product: { id: string } }>(
  cart: readonly T[],
): number {
  return new Set(cart.map((line) => line.product.id)).size;
}

/**
 * Remove apenas a modalidade/embalagem selecionada no carrinho, sem
 * interferir no mesmo produto adicionado em outra forma de venda.
 */
export function removeCartSelection<
  T extends { product: { id: string }; variant?: { id: string } | null; purchaseMode: string; customization?:CustomSelection }
>(cart: readonly T[], target: T): T[] {
  return cart.filter(line =>
    line.product.id !== target.product.id ||
    (line.variant?.id ?? '') !== (target.variant?.id ?? '') ||
    line.purchaseMode !== target.purchaseMode || customSelectionKey(line.customization)!==customSelectionKey(target.customization)
  );
}
