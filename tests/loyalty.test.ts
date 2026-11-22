import {describe,it,expect} from 'vitest';
import {SqliteD1Adapter} from '../src/server/db/sqlite-local';
import {seedDatabase} from '../src/server/seed';
import {createApp} from '../src/server/app';
import {defaultLoyalty,loyaltyGap} from '../src/shared/loyalty';
describe('fidelidade',()=>{
 it('avisa o valor que falta e não mostra aviso quando desativado',()=>{
  const cfg={...defaultLoyalty(),enabled:true};
  expect(loyaltyGap(cfg,3600)).toBe(400);
  expect(loyaltyGap(cfg,8000)).toBe(0);
  expect(loyaltyGap(defaultLoyalty(),3600)).toBeNull();
 });
 it('pontua no checkout, estorna cancelamento e libera prêmio após entrega',async()=>{
 const db=new SqliteD1Adapter(':memory:');
 try{
  db.execMigrations('./migrations');await seedDatabase(db,{});
  const app=createApp({db,media:{async putObject(){throw Error('unused')},async getObject(){return null}} as any,jwtSecret:'test-secret-'.repeat(4),crmApiKey:'test',appEnv:'test',evolution:{}});
  const login=await app.fetch(new Request('http://local/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'dono@verdevivo.local',password:'CRJornada!Local2026'})}));
  expect(login.status).toBe(200);const token=(await login.json() as any).token;
  const admin=(route:string,method='GET',body?:unknown)=>app.fetch(new Request('http://local/api/admin/'+route,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}));
  expect((await admin('loyalty','PUT',{enabled:true,minimumCents:4000,goal:2,reward:'Marmita grátis'})).status).toBe(200);
  const tenant=await db.prepare("SELECT id FROM tenants WHERE slug='verde-vivo'").first<any>();
  const prod=await admin('products','POST',{name:'Produto fidelidade teste',saleMode:'unit',priceCents:4000,stockQty:20,imageUrl:'/images/products/placeholder.svg'});
  expect(prod.status).toBe(201);const productId=(await prod.json() as any).id;
  const checkout=async(qty=1)=>{const x=await app.fetch(new Request('http://local/api/store/verde-vivo/orders',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({customerName:'Cliente Teste',phone:'73999990001',street:'Rua A',number:'1',neighborhood:'Centro',paymentMethod:'pix_delivery',whatsappOptIn:true,items:[{productId,quantity:qty}]})}));expect(x.status).toBe(201);return (await x.json() as any).order.id;};
  const deliver=async(id:string)=>{for(const status of ['accepted','preparing','out_for_delivery','delivered'])expect((await admin('orders/'+id+'/status','PATCH',{status})).status).toBe(200);};
  const first=await checkout(2);
  let now=await (await admin('loyalty')).json() as any;
  expect(now.accounts[0]).toMatchObject({progress:1,total_points:1,pending_points:1});
  expect((await db.prepare("SELECT rendered_message FROM whatsapp_message_queue WHERE order_id=? AND event_type='loyalty_earned'").bind(first).first<any>()).rendered_message).toContain('1 de 2 pontos');
  const cancelled=await checkout();
  now=await (await admin('loyalty')).json() as any;expect(now.accounts[0].progress).toBe(2);expect(now.rewards).toHaveLength(0);
  expect((await admin('orders/'+cancelled+'/status','PATCH',{status:'cancelled'})).status).toBe(200);
  now=await (await admin('loyalty')).json() as any;expect(now.accounts[0]).toMatchObject({progress:1,total_points:1});
  const reversal=await db.prepare("SELECT rendered_message FROM whatsapp_message_queue WHERE order_id=? AND event_type='loyalty_recalculated'").bind(cancelled).first<any>();expect(reversal.rendered_message).toContain('1 de 2 pontos');expect(reversal.rendered_message).toContain('foi cancelado');
  const second=await checkout();
  await deliver(first);await deliver(second);
  expect((await admin('orders/'+second+'/status','PATCH',{status:'delivered'})).status).toBe(409);
  const state=await (await admin('loyalty')).json() as any;
  expect(state.accounts[0]).toMatchObject({progress:0,total_points:2});
  expect(state.rewards).toHaveLength(1);expect(state.rewards[0].reward_name).toBe('Marmita grátis');
  const msg=await db.prepare("SELECT rendered_message FROM whatsapp_message_queue WHERE order_id=? AND event_type='loyalty_reward'").bind(second).first<any>();expect(msg.rendered_message).toContain('Parabéns!');
  expect((await admin('loyalty/rewards/'+state.rewards[0].id+'/redeem','POST',{})).status).toBe(200);
  expect((await admin('loyalty/rewards/'+state.rewards[0].id+'/redeem','POST',{})).status).toBe(409);
  expect((await admin('loyalty','PUT',{enabled:false,minimumCents:4000,goal:2,reward:'Marmita grátis'})).status).toBe(200);
  await deliver(await checkout());
  expect((await db.prepare("SELECT COUNT(*) n FROM loyalty_earnings WHERE tenant_id=? AND state!='revoked'").bind(tenant.id).first<any>()).n).toBe(2);
 }finally{db.close();}
 });
});
