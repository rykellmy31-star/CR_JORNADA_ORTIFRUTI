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
