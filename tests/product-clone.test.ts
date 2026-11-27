import {describe,it,expect} from 'vitest';
import {cloneProductDraft} from '../src/web/product-clone';
import {readCustomConfig} from '../src/shared/custom-product';

describe('clonagem de produtos do catálogo',()=>{
 it('mantém tamanhos, adicionais por tamanho, ingredientes e foto sem editar o original',()=>{
  const customConfig=readCustomConfig({allowNotes:true,groups:[
   {id:'sizes',name:'Tamanhos',min:1,max:1,priceMode:'final',options:[{id:'p',name:'Pequena',priceCents:3500,active:true}]},
   {id:'extras',name:'Bordas',min:0,max:1,options:[{id:'b',name:'Catupiry',priceCents:500,priceByOptionId:{p:700},active:true}]},
   {id:'ingredients',name:'Ingredientes',kind:'included',min:0,max:1,options:[{id:'i',name:'Queijo',priceCents:0,active:true}]}
  ]})!;
  const original={name:'MUSSARELA',saleMode:'custom',categoryId:'pizzas',price:'35,00',stock:50,imageUrl:'/pizza.png',description:'Pizza',featured:true,customConfig,variants:[]};
  const copy=cloneProductDraft(original);
  expect(copy).toMatchObject({...original,name:'MUSSARELA (cópia)',ean:'',sku:''});
  expect(readCustomConfig(copy.customConfig)).toEqual(customConfig);
  copy.customConfig.groups[0].options[0].priceCents=4000;
  expect(original.customConfig.groups[0].options[0].priceCents).toBe(3500);
 });
 it('preserva configurações de peso, unidade e estoque inicial, sem duplicar EAN',()=>{
  const draft={name:'Produto',saleMode:'dual',ean:'7891234567890',sku:'ABC',stock:2.5,unitPrice:'2,50',unitWeightGrams:100,price:'25,00',variants:[]};
  expect(cloneProductDraft(draft)).toMatchObject({...draft,name:'Produto (cópia)',ean:'',sku:''});
 });
 it('prepara novas variações sem IDs do produto original ou vínculos com o estoque anterior',()=>{
  const draft={name:'Ovos',saleMode:'variants',sharedPool:true,poolStock:360,variants:[{id:'original',stock_pool_id:'pool-antigo',product_id:'original-product',sku:'ABC',name:'Dúzia',price:'10,00',promoPrice:'9,00',deductionQty:12,stockQty:0,reserved_qty:4}]};
  const copy=cloneProductDraft(draft);
  expect(copy.sharedPool).toBe(true);
  expect(copy.poolStock).toBe(360);
  expect(copy.variants).toEqual([{name:'Dúzia',sku:'',price:'10,00',promoPrice:'9,00',deductionQty:12,stockQty:0}]);
  expect(draft.variants[0].id).toBe('original');
 });
});
