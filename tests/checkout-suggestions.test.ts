import {describe,it,expect} from 'vitest';
import {readSuggestionConfig,suggestedProducts,validSuggestionConfig} from '../src/shared/checkout-suggestions';
const categories=[{id:'pizza',name:'Pizzas'},{id:'snack',name:'Lanches'},{id:'drink',name:'Bebidas'},{id:'other',name:'Outros'}];
const pizza={id:'p',category_id:'pizza'};
const drink={id:'d',category_id:'drink',sale_mode:'unit',price_cents:1000,min_qty:1,step_qty:1};
describe('venda sugestiva',()=>{
 it('ativa sugestões padrão para pizza ou lanche, mas não insiste se já há bebida',()=>{
  const config=readSuggestionConfig(null,categories);
  expect(config).toEqual({enabled:true,triggerCategoryIds:['pizza','snack'],suggestedCategoryId:'drink',limit:3});
  expect(suggestedProducts(config,categories,[drink],[{product:pizza,quantity:1}])).toEqual([drink]);
  expect(suggestedProducts(config,categories,[drink],[{product:pizza,quantity:1},{product:drink,quantity:1}])).toEqual([]);
  expect(suggestedProducts(config,categories,[drink],[{product:{id:'x',category_id:'other'},quantity:1}])).toEqual([]);
 });
 it('respeita configuração, limite, disponibilidade e evita opções que exigem personalização',()=>{
  const config={...readSuggestionConfig(null,categories),limit:1};
  const products=[{...drink,id:'inactive',is_active:0},{...drink,id:'empty',available:0},{...drink,id:'custom',custom_config_json:'{}'},{...drink,id:'variant',sale_mode:'variants'},drink,{...drink,id:'d2'}];
  expect(suggestedProducts(config,categories,products,[{product:pizza,quantity:1}])).toEqual([drink]);
  expect(suggestedProducts({...config,enabled:false},categories,products,[{product:pizza,quantity:1}])).toEqual([]);
  expect(validSuggestionConfig({...config,limit:0})).toBe(false);
  expect(readSuggestionConfig(null,[{id:'x',name:'Frutas'}]).enabled).toBe(false);
 });
});
