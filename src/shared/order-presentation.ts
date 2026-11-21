import {formatWeightGrams,formatBRL} from './pricing';
export type ReceiptQuantityItem={quantity_display:string;variant_name_snapshot?:string|null};
/** Resume pesos das opções de preço fechado, sem alterar o pedido ou seus valores.
 * Embalagens e opções sem um peso inequívoco mantêm a quantidade e o nome originais. */
export function formatReceiptQuantity(item:ReceiptQuantityItem):string{
 const display=item.quantity_display.trim();
 const variant=item.variant_name_snapshot?.trim();
 if(!variant)return display;
 const counted=display.match(/^(\d+)\s*[x×]\s*(.+)$/i);
 if(!counted||counted[2].trim()!==variant)return display;
 const count=Number(counted[1]);
 if(!Number.isSafeInteger(count)||count<=0)return display;
 const label=variant.toLowerCase().replace(/\s+/g,' ');
 let grams=0;
 if(/^(?:meio|meia)\s*(?:kg|quilo|quilograma)$/.test(label))grams=500;
 else{
  const weight=label.match(/^(\d+(?:[,.]\d+)?)\s*(kg|quilo(?:s)?|quilograma(?:s)?|g|grama(?:s)?)$/);
  if(weight){
   const amount=Number(weight[1].replace(',','.'));
   grams=amount*(/^(?:kg|quilo)/.test(weight[2])?1000:1);
  }
 }
 const total=Math.round(grams*count);
 if(grams>0&&Math.abs(grams-Math.round(grams))<1e-8&&Number.isSafeInteger(total)&&total>0){
  return formatWeightGrams(total);
 }
 return display;
}


export type PricingSnapshot={line_total_cents:number;original_line_total_cents?:number|null};
export function originalPromotionTotal(item:PricingSnapshot):number|null{
 const value=item.original_line_total_cents;
 return typeof value==='number'&&Number.isSafeInteger(value)&&value>item.line_total_cents?value:null;
}
export function orderSavings(items:PricingSnapshot[]):number{
 return items.reduce((sum,item)=>sum+((originalPromotionTotal(item)??item.line_total_cents)-item.line_total_cents),0);
}
export function formatWhatsAppItems(items:(ReceiptQuantityItem&PricingSnapshot&{product_name_snapshot:string;customization_snapshot?:string|null})[]):string{
 return items.map(item=>{
  const name=item.product_name_snapshot.replace(/[\r\n]+/g,' ').trim().toUpperCase();
  const qty=formatReceiptQuantity(item);
  const original=originalPromotionTotal(item);
  const title='➡️ *'+name+' — '+qty+'*'+(item.customization_snapshot?'\n'+item.customization_snapshot.split('\n').map(s=>'   • '+s).join('\n'):'');
  return original===null?title+'\nValor: *'+formatBRL(item.line_total_cents)+'*':
    title+'\nDe: ~'+formatBRL(original)+'~\n🔥 Por: *'+formatBRL(item.line_total_cents)+'*';
 }).join('\n\n');
}
