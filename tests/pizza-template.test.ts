import {describe,it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {newPizzaConfig,CustomConfigEditor} from '../src/web/CustomProduct';
import {readCustomConfig,simplifyPizzaConfig,supportsHalfAndHalf,resolveCustomSelection,customUnitPrice} from '../src/shared/custom-product';

describe('modelo simplificado de pizza',()=>{
 it('não cria grupo de sabores nem exibe preços de adicionais por tamanho',()=>{
  const config=readCustomConfig(newPizzaConfig())!;
  expect(config.groups.some(g=>g.name==='Sabores')).toBe(false);
  expect(supportsHalfAndHalf(config)).toBe(false);
  const html=renderToStaticMarkup(createElement(CustomConfigEditor,{value:config,onChange:()=>{}}));
  expect(html).not.toContain('Preço adicional por tamanho');
  expect(html).toContain('Preço da borda por tamanho');
  expect(html).toContain('Preço de Catupiry para Média');
  expect(html).not.toContain('Preço de Bacon para');
  expect(html).not.toContain('Preço de Sem borda para');
  expect(html).not.toContain('value="Sabores"');
  expect(html).toContain('Preço adicional em reais');
 });
 it('mantém meio a meio independente e cobra o mesmo adicional em cada tamanho',()=>{
  const original=newPizzaConfig();
  const sizes=original.groups.find(g=>g.priceMode==='final')!.options;
  const extras=original.groups.find(g=>g.name==='Adicionais')!;
  const bacon=extras.options[0];
  bacon.priceByOptionId={[sizes[0].id]:999};
  const config=readCustomConfig(simplifyPizzaConfig(original,true))!;
  expect(supportsHalfAndHalf(config)).toBe(true);
  expect(supportsHalfAndHalf(simplifyPizzaConfig(config,false))).toBe(false);
  expect(original.groups.find(g=>g.name==='Adicionais')!.options[0].priceByOptionId).toBeDefined();
  for(const size of sizes){
   const selected=resolveCustomSelection(config,{optionIds:[size.id,bacon.id],note:'',flavorMode:'single',firstFlavorName:'Mussarela'});
   expect(customUnitPrice(0,selected)).toBe(size.priceCents+bacon.priceCents);
  }
  const pair=resolveCustomSelection(config,{optionIds:[sizes[0].id,bacon.id],note:'',flavorMode:'half-and-half',firstFlavorName:'Mussarela',pairedFlavorName:'Calabresa',pairedFlavorPriceCents:5000});
  expect(customUnitPrice(0,pair)).toBe(5000+bacon.priceCents);
 });
 it('preserva preços de borda M, G e GG, mantém bacon com preço único e sem borda gratuito',()=>{
  const original=newPizzaConfig();
  const sizes=original.groups.find(g=>g.priceMode==='final')!.options;
  sizes[0].name='M';sizes[1].name='G';sizes[2].name='GG';
  const borders=original.groups.find(g=>g.name==='Borda recheada')!;
  const free=borders.options[0],catupiry=borders.options[1];
  free.priceCents=99;free.priceByOptionId={[sizes[0].id]:900};
  catupiry.priceByOptionId={[sizes[0].id]:500,[sizes[1].id]:800,[sizes[2].id]:1000};
  const bacon=original.groups.find(g=>g.name==='Adicionais')!.options[0];
  bacon.priceByOptionId={[sizes[0].id]:999};
  const config=readCustomConfig(simplifyPizzaConfig(original))!;
  for(const [i,extra] of [500,800,1000].entries()){
   const size=sizes[i];
   const total=(border:string)=>customUnitPrice(0,resolveCustomSelection(config,{optionIds:[size.id,border,bacon.id],note:''}));
   expect(total(catupiry.id)).toBe(size.priceCents+extra+bacon.priceCents);
   expect(total(free.id)).toBe(size.priceCents+bacon.priceCents);
  }
  expect(config.groups.find(g=>g.name==='Borda recheada')!.options[1].priceByOptionId).toEqual(catupiry.priceByOptionId);
  expect(config.groups.find(g=>g.name==='Adicionais')!.options[0].priceByOptionId).toBeUndefined();
 });
 it('reconhece cadastro antigo e converte o grupo de sabores sem perder o meio a meio',()=>{
  const {pizzaModel,halfAndHalf,...base}=newPizzaConfig();
  const legacy=readCustomConfig({...base,groups:[...base.groups,{id:'legacy',name:'Sabores',min:1,max:2,selectionMode:'half-and-half',options:[{id:'a',name:'A',priceCents:0,active:true},{id:'b',name:'B',priceCents:0,active:true}]}]})!;
  expect(supportsHalfAndHalf(legacy)).toBe(true);
  const simplified=readCustomConfig(simplifyPizzaConfig(legacy))!;
  expect(supportsHalfAndHalf(simplified)).toBe(true);
  expect(simplified.groups.some(g=>g.name==='Sabores')).toBe(false);
 });
});
