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
 }finally{db.close();}
});
