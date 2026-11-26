import {describe,it,expect} from 'vitest';
import {customConfigSchema,resolveCustomSelection,customConfigAvailable,customSelectionKey,customUnitPrice,minimumCustomPrice} from '../src/shared/custom-product';
import {removeCartSelection} from '../src/shared/cart';
import {formatWhatsAppItems} from '../src/shared/order-presentation';
const config=customConfigSchema.parse({allowNotes:true,groups:[{id:'size',name:'Tamanho',min:1,max:1,options:[{id:'p',name:'P',priceCents:0,active:true},{id:'g',name:'G',priceCents:1000,active:true}]},{id:'protein',name:'Proteína',min:1,max:1,options:[{id:'fish',name:'Peixe',priceCents:300,active:true},{id:'beef',name:'Carne',priceCents:0,active:false}]}]});
describe('produto personalizável',()=>{
 it('configura pizza meio a meio e exige dois sabores escolhidos em etapas',()=>{
  const half=customConfigSchema.parse({allowNotes:true,groups:[
   {id:'size',name:'Tamanho',min:1,max:1,priceMode:'final',options:[{id:'m',name:'Média',priceCents:3590,active:true}]},
   {id:'flavors',name:'Sabores',min:2,max:2,selectionMode:'half-and-half',options:[
    {id:'cal',name:'Calabresa',priceCents:0,active:true},
    {id:'muzz',name:'Mussarela',priceCents:0,active:true},
    {id:'port',name:'Portuguesa',priceCents:0,active:true}]}
  ]});
  expect(resolveCustomSelection(half,{optionIds:['m','cal','muzz'],note:'',flavorMode:'half-and-half'}).details).toBe('Tamanho: Média\nSabores: Calabresa, Mussarela');
  expect(()=>resolveCustomSelection(half,{optionIds:['m','cal'],note:'',flavorMode:'half-and-half'} )).toThrow('Selecione 2 opção(ões) em Sabores.');
  expect(resolveCustomSelection(half,{optionIds:['m','cal'],note:'',flavorMode:'single'}).details).toBe('Tamanho: Média\nSabores: Calabresa');\n  expect(()=>resolveCustomSelection(half,{optionIds:['m','cal','muzz'],note:'',flavorMode:'single'})).toThrow();\n  expect(()=>customConfigSchema.parse({...half,groups:half.groups.map(g=>g.id==='flavors'?{...g,max:1}:g)})).toThrow();
 });
 it('valida escolhas e calcula apenas adicionais cadastrados',()=>{
  const r=resolveCustomSelection(config,{optionIds:['g','fish'],note:'Sem cebola'});
  expect(r.extrasCents).toBe(1300);
  expect(r.details).toBe('Tamanho: G\nProteína: Peixe\nObservação: Sem cebola');
  for(const optionIds of [[],['g'],['g','p','fish'],['g','beef'],['g','fish','foreign'],['g','fish','fish']])expect(()=>resolveCustomSelection(config,{optionIds,note:''})).toThrow();
  expect(customConfigAvailable(config)).toBe(true);
 });
 it('não soma duas vezes o preço integral do tamanho e preserva os adicionais',()=>{
  const full=customConfigSchema.parse({...config,groups:[{...config.groups[0],priceMode:'final',options:[{id:'p',name:'P',priceCents:2000,active:true},{id:'g',name:'G',priceCents:2200,active:true}]},{...config.groups[1],options:[{id:'fish',name:'Peixe',priceCents:0,active:true}]}]});
  expect(minimumCustomPrice(full,2200)).toBe(2000);
  expect(customUnitPrice(2200,resolveCustomSelection(full,{optionIds:['p','fish'],note:''}))).toBe(2000);
  expect(customUnitPrice(2200,resolveCustomSelection(full,{optionIds:['g','fish'],note:''}))).toBe(2200);
  expect(customUnitPrice(1800,resolveCustomSelection(config,{optionIds:['g','fish'],note:''}))).toBe(3100);
 });
 it('calcula borda recheada com adicional diferente para cada tamanho escolhido',()=>{
  const pizza=customConfigSchema.parse({allowNotes:true,groups:[
   {id:'size',name:'Tamanho',min:1,max:1,priceMode:'final',options:[{id:'m',name:'Média',priceCents:3590,active:true},{id:'g',name:'Grande',priceCents:4590,active:true},{id:'f',name:'Família',priceCents:5990,active:true}]},
   {id:'flavor',name:'Sabores',min:1,max:1,options:[{id:'cal',name:'Calabresa',priceCents:0,active:true}]},
   {id:'border',name:'Borda',min:1,max:1,options:[
    {id:'none',name:'Sem borda',priceCents:0,priceByOptionId:{m:0,g:0,f:0},active:true},
    {id:'cat',name:'Catupiry',priceCents:600,priceByOptionId:{m:600,g:800,f:1000},active:true}]}
  ]});
  const total=(size:string,border:string)=>customUnitPrice(0,resolveCustomSelection(pizza,{optionIds:[size,'cal',border],note:''}));
  expect(total('m','none')).toBe(3590);expect(total('m','cat')).toBe(4190);
  expect(total('g','cat')).toBe(5390);expect(total('f','cat')).toBe(6990);
  expect(minimumCustomPrice(pizza,0)).toBe(3590);
 });
 it('já inclui ingredientes de lanche, só registra os que o cliente deseja retirar e não altera preço',()=>{
  const ingredients=customConfigSchema.parse({allowNotes:true,groups:[
   {id:'included',name:'Ingredientes inclusos',kind:'included',min:0,max:3,options:[
    {id:'hamburguer',name:'Hambúrguer',priceCents:0,active:true},
    {id:'queijo',name:'Queijo',priceCents:0,active:true},
    {id:'presunto',name:'Presunto',priceCents:0,active:true}]},
   {id:'extra',name:'Adicionais',min:0,max:1,options:[{id:'bacon-extra',name:'Bacon extra',priceCents:300,active:true}]}
  ]});
  expect(minimumCustomPrice(ingredients,2200)).toBe(2200);
  expect(resolveCustomSelection(ingredients,{optionIds:[],note:''})).toMatchObject({
   extrasCents:0,details:'Ingredientes inclusos: Hambúrguer, Queijo, Presunto'});
  const removed=resolveCustomSelection(ingredients,{optionIds:['queijo','bacon-extra'],note:''});
  expect(removed.extrasCents).toBe(300);
  expect(removed.details).toBe(['Ingredientes inclusos: Hambúrguer, Presunto','RETIRAR: Queijo','Adicionais: Bacon extra'].join(String.fromCharCode(10)));
  expect(customUnitPrice(2200,removed)).toBe(2500);
  expect(customSelectionKey({optionIds:['queijo'],note:''})).not.toBe(customSelectionKey({optionIds:[],note:''}));
  expect(()=>resolveCustomSelection(ingredients,{optionIds:['invalid'],note:''})).toThrow();
  expect(customConfigSchema.safeParse({...ingredients,groups:[{...ingredients.groups[0],options:ingredients.groups[0].options.map((o,i)=>i===0?{...o,priceCents:100}:o)},ingredients.groups[1]]}).success).toBe(false);
  expect(formatWhatsAppItems([{product_name_snapshot:'X-Tudo',quantity_display:'1 un',line_total_cents:2500,customization_snapshot:removed.details}])).toContain('RETIRAR: Queijo');
 });
 it('mantém marmitas com escolhas diferentes separadas e apresenta detalhes no WhatsApp',()=>{
  const a={product:{id:'meal'},purchaseMode:'unit',customization:{optionIds:['p','fish'],note:''}};
  const b={...a,customization:{optionIds:['g','fish'],note:''}};
  expect(removeCartSelection([a,b],a)).toEqual([b]);
  expect(customSelectionKey({optionIds:['fish','p'],note:''})).toBe(customSelectionKey(a.customization));\n  expect(customSelectionKey({optionIds:['cal'],note:'',flavorMode:'single'})).not.toBe(customSelectionKey({optionIds:['cal'],note:'',flavorMode:'half-and-half'}));
  expect(formatWhatsAppItems([{product_name_snapshot:'Marmita',quantity_display:'1 un',line_total_cents:2100,customization_snapshot:'Tamanho: P\nProteína: Peixe'}])).toContain('Proteína: Peixe');
 });
});

import {SqliteD1Adapter} from '../src/server/db/sqlite-local';
import {seedDatabase} from '../src/server/seed';
import {createApp} from '../src/server/app';
it('cadastra marmita, valida os complementos no checkout real e salva preço e escolhas por item',async()=>{
 const db=new SqliteD1Adapter(':memory:');
 try{
  db.execMigrations('./migrations');await seedDatabase(db,{});
  const app=createApp({db,media:{async putObject(){throw Error('unused')},async getObject(){return null}} as any,jwtSecret:'test-secret-'.repeat(4),crmApiKey:'test',appEnv:'test',evolution:{}});
  const login=await app.fetch(new Request('http://local/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'dono@verdevivo.local',password:'CRJornada!Local2026'})}));
  expect(login.status).toBe(200);
  const token=(await login.json() as any).token;
  const admin=(route:string,method='GET',body?:unknown)=>app.fetch(new Request('http://local/api/admin/'+route,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}));
  const created=await admin('products','POST',{name:'Marmita teste',saleMode:'custom',priceCents:1800,promoPriceCents:1500,stockQty:10,customConfig:config,imageUrl:'/images/products/placeholder.svg'});
  expect(created.status).toBe(201);const productId=(await created.json() as any).id;
  const checkout=(items:any[])=>app.fetch(new Request('http://local/api/store/verde-vivo/orders',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({customerName:'Cliente Teste',phone:'73999990001',street:'Rua A',number:'1',neighborhood:'Centro',paymentMethod:'pix_delivery',whatsappOptIn:true,items})}));
  const bad=await checkout([{productId,quantity:1,purchaseMode:'unit'}]);expect(bad.status).toBe(400);
  const invalid=await checkout([{productId,quantity:1,customization:{optionIds:['p','beef'],note:''}}]);expect(invalid.status).toBe(400);
  const success=await checkout([{productId,quantity:1,customization:{optionIds:['p','fish'],note:''}},{productId,quantity:2,customization:{optionIds:['g','fish'],note:'Sem cebola'}}]);
  expect(success.status).toBe(201);
  const order=(await success.json() as any).order;
  const rows=(await db.prepare('SELECT line_total_cents,original_line_total_cents,customization_snapshot FROM order_items WHERE order_id=? ORDER BY rowid').bind(order.id).all<any>()).results;
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({line_total_cents:1800,original_line_total_cents:2100,customization_snapshot:'Tamanho: P\nProteína: Peixe'});
  expect(rows[1]).toMatchObject({line_total_cents:5600,original_line_total_cents:6200,customization_snapshot:'Tamanho: G\nProteína: Peixe\nObservação: Sem cebola'});
  expect((await db.prepare('SELECT reserved_qty FROM products WHERE id=?').bind(productId).first<any>()).reserved_qty).toBe(3);
  const message=await db.prepare("SELECT rendered_message FROM whatsapp_message_queue WHERE order_id=? AND event_type='order_received'").bind(order.id).first<any>();
  expect(message.rendered_message).toContain('Sem cebola');
  const view=await admin('orders');expect(view.status).toBe(200);
  expect((await view.json() as any).orders.find((o:any)=>o.id===order.id).items[1].customization_snapshot).toContain('Sem cebola');
  const updated=await admin('products/'+productId,'PATCH',{customConfig:{...config,allowNotes:false}});expect(updated.status).toBe(200);
  const finalConfig={...config,groups:[{...config.groups[0],priceMode:'final',options:[{id:'p',name:'P',priceCents:2000,active:true},{id:'g',name:'G',priceCents:2200,active:true}]},config.groups[1]]};
  expect((await admin('products/'+productId,'PATCH',{priceCents:2200,customConfig:finalConfig})).status).toBe(200);
  const fullPriceOrder=await checkout([{productId,quantity:1,customization:{optionIds:['p','fish'],note:''}}]);expect(fullPriceOrder.status).toBe(201);
  const fullId=(await fullPriceOrder.json() as any).order.id;
  expect(await db.prepare('SELECT line_total_cents,original_line_total_cents FROM order_items WHERE order_id=?').bind(fullId).first()).toMatchObject({line_total_cents:2300,original_line_total_cents:null});
  expect((await admin('products/'+productId,'DELETE')).status).toBe(409);
  expect((await admin('products/'+productId,'PATCH',{active:false})).status).toBe(200);
  expect((await admin('products/'+productId,'DELETE')).status).toBe(200);
  expect((await db.prepare('SELECT is_deleted FROM products WHERE id=?').bind(productId).first<any>()).is_deleted).toBe(1);
  expect((await db.prepare('SELECT COUNT(*) AS total FROM order_items WHERE product_id=?').bind(productId).first<any>()).total).toBe(3);
  expect((await admin('products/'+productId,'PATCH',{active:true})).status).toBe(404);

  // Integração real: ingredientes vêm automaticamente no lanche; o cliente marca apenas os que retira.
  const xTudoConfig=customConfigSchema.parse({allowNotes:true,groups:[
   {id:'ingredientes',name:'Ingredientes inclusos',kind:'included',min:0,max:3,options:[
    {id:'hamb',name:'Hambúrguer',priceCents:0,active:true},
    {id:'queijo',name:'Queijo',priceCents:0,active:true},
    {id:'bacon',name:'Bacon',priceCents:0,active:true}]},
   {id:'adicionais',name:'Adicionais',min:0,max:1,options:[
    {id:'ovo-extra',name:'Ovo extra',priceCents:300,active:true}]}]});
  const lancheResponse=await admin('products','POST',{name:'X-Tudo',saleMode:'custom',priceCents:2200,stockQty:10,customConfig:xTudoConfig,imageUrl:'/images/products/placeholder.svg'});
  expect(lancheResponse.status).toBe(201);
  const lancheId=(await lancheResponse.json() as any).id;
  const lancheOrder=await checkout([
   {productId:lancheId,quantity:1,customization:{optionIds:[],note:''}},
   {productId:lancheId,quantity:1,customization:{optionIds:['queijo','ovo-extra'],note:''}}
  ]);
  expect(lancheOrder.status).toBe(201);
  const lancheOrderId=(await lancheOrder.json() as any).order.id;
  const lancheRows=(await db.prepare('SELECT line_total_cents,customization_snapshot FROM order_items WHERE order_id=? ORDER BY rowid').bind(lancheOrderId).all<any>()).results;
  expect(lancheRows).toHaveLength(2);
  expect(lancheRows[0]).toMatchObject({line_total_cents:2200,customization_snapshot:'Ingredientes inclusos: Hambúrguer, Queijo, Bacon'});
  expect(lancheRows[1]).toMatchObject({line_total_cents:2500,customization_snapshot:['Ingredientes inclusos: Hambúrguer, Bacon','RETIRAR: Queijo','Adicionais: Ovo extra'].join(String.fromCharCode(10))});
  expect((await db.prepare("SELECT rendered_message FROM whatsapp_message_queue WHERE order_id=? AND event_type='order_received'").bind(lancheOrderId).first<any>()).rendered_message).toContain('RETIRAR: Queijo');

 }finally{db.close();}
});
