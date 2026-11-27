/** Prepara uma cópia editável, sem reutilizar identificadores de estoque ou cadastro.
 * Os IDs internos das opções personalizáveis permanecem no JSON, pois seus
 * preços por tamanho referenciam esses IDs e são locais a cada produto.
 */
export function cloneProductDraft(draft:any){
 const copy=structuredClone(draft);
 return {
  ...copy,
  name:String(copy.name||'').trim().slice(0,132)+' (cópia)',
  ean:'',
  sku:'',
  variants:(copy.variants||[]).map((v:any)=>({
   name:v.name,sku:'',price:v.price,promoPrice:v.promoPrice,
   deductionQty:v.deductionQty,stockQty:v.stockQty
  }))
 };
}
