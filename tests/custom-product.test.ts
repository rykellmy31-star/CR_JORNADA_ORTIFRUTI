import {describe,it,expect} from 'vitest';
import {customConfigSchema,resolveCustomSelection,customConfigAvailable,customSelectionKey} from '../src/shared/custom-product';
import {removeCartSelection} from '../src/shared/cart';
import {formatWhatsAppItems} from '../src/shared/order-presentation';
const config=customConfigSchema.parse({allowNotes:true,groups:[{id:'size',name:'Tamanho',min:1,max:1,options:[{id:'p',name:'P',priceCents:0,active:true},{id:'g',name:'G',priceCents:1000,active:true}]},{id:'protein',name:'Proteína',min:1,max:1,options:[{id:'fish',name:'Peixe',priceCents:300,active:true},{id:'beef',name:'Carne',priceCents:0,active:false}]}]});
describe('produto personalizável',()=>{
 it('valida escolhas e calcula apenas adicionais cadastrados',()=>{
  const r=resolveCustomSelection(config,{optionIds:['g','fish'],note:'Sem cebola'});
  expect(r.extrasCents).toBe(1300);
  expect(r.details).toBe('Tamanho: G\nProteína: Peixe\nObservação: Sem cebola');
  for(const optionIds of [[],['g'],['g','p','fish'],['g','beef'],['g','fish','foreign'],['g','fish','fish']])expect(()=>resolveCustomSelection(config,{optionIds,note:''})).toThrow();
  expect(customConfigAvailable(config)).toBe(true);
 });
 it('mantém marmitas com escolhas diferentes separadas e apresenta detalhes no WhatsApp',()=>{
  const a={product:{id:'meal'},purchaseMode:'unit',customization:{optionIds:['p','fish'],note:''}};
  const b={...a,customization:{optionIds:['g','fish'],note:''}};
  expect(removeCartSelection([a,b],a)).toEqual([b]);
  expect(customSelectionKey({optionIds:['fish','p'],note:''})).toBe(customSelectionKey(a.customization));
  expect(formatWhatsAppItems([{product_name_snapshot:'Marmita',quantity_display:'1 un',line_total_cents:2100,customization_snapshot:'Tamanho: P\nProteína: Peixe'}])).toContain('Proteína: Peixe');
 });
});
