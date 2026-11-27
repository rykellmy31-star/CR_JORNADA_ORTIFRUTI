import {describe,it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {SecondFlavorIngredients} from '../src/web/CustomProduct';
import {readCustomConfig,completePizzaPair,pizzaPairSize,resolveCustomSelection,customUnitPrice,customSelectionKey,type CustomSelection} from '../src/shared/custom-product';
const pizza=(id:string,name:string,price:number,ingredient:string)=>({
 id,name,price_cents:price,custom_config_json:JSON.stringify({pizzaModel:true,halfAndHalf:true,allowNotes:true,groups:[
 {id:id+'size',name:'Tamanho',priceMode:'final',min:1,max:1,options:[{id:id+'g',name:'G',priceCents:price,active:true}]},
 {id:id+'ingredients',name:'Ingredientes',kind:'included',min:0,max:1,options:[{id:id+'ingredient',name:ingredient,priceCents:0,active:true}]},
 {id:id+'extras',name:'Adicionais',min:0,max:1,options:[{id:id+'bacon',name:'Bacon',priceCents:500,active:true}]},
 {id:id+'border',name:'Borda',min:0,max:1,options:[{id:id+'cat',name:'Catupiry',priceCents:800,active:true}]}
 ]})
});
describe('personalização da segunda metade',()=>{
 const first=pizza('a','Mussarela',3500,'Tomate'),second=pizza('b','Calabresa',4000,'Cebola');
 const choice:CustomSelection={optionIds:['ag','aingredient','abacon','acat'],note:'',flavorMode:'half-and-half',firstFlavorName:first.name};
 it('mostra apenas ingredientes removíveis do segundo sabor',()=>{
  const html=renderToStaticMarkup(createElement(SecondFlavorIngredients,{config:readCustomConfig(second.custom_config_json)!,removed:[],onToggle:()=>{}}));
  expect(html).toContain('Retirar Cebola');
  expect(html).not.toContain('Bacon');
  expect(html).not.toContain('Catupiry');
  expect(html).not.toContain('Meio a meio');
 });
 it('mantém adicionais e borda uma única vez e separa as retiradas de cada metade',()=>{
  const pair=completePizzaPair(first,choice,second,['bingredient']);
  const resolved=resolveCustomSelection(readCustomConfig(first.custom_config_json)!,pair);
  expect(customUnitPrice(3500,resolved)).toBe(5300);
  expect(resolved.details).toContain('½ Mussarela — RETIRAR: Tomate');
  expect(resolved.details).toContain('½ Calabresa — RETIRAR: Cebola');
  expect(customSelectionKey(pair)).not.toBe(customSelectionKey(completePizzaPair(first,choice,second,[])));
  expect(()=>completePizzaPair(first,choice,second,['bbacon'])).toThrow();
  expect(pizzaPairSize(first,choice,first)).toBeNull();
 });
});
