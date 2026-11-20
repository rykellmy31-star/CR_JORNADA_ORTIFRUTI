import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {SqliteD1Adapter} from '../src/server/db/sqlite-local';
import {seedDatabase} from '../src/server/seed';
import {createApp} from '../src/server/app';
import {signJwt} from '../src/server/security/crypto';

const jwtSecret='test-secret-'.repeat(4);
let db:SqliteD1Adapter,app:any,token:string,tenantId:string,orderId:string,orderNumber:number,customerId:string;
const url='http://local/api';
const req=(path:string,method='GET',body?:any,auth=token)=>
  app.fetch(new Request(url+path,{
    method,headers:{authorization:'Bearer '+auth,'content-type':'application/json'},
    ...(body?{body:JSON.stringify(body)}:{})
  }));

beforeEach(async()=>{
  db=new SqliteD1Adapter(':memory:');
  db.execMigrations('./migrations');
  await seedDatabase(db,{});
  const media:any={async putObject(){throw Error('unused')},async getObject(){return null}};
  app=createApp({db,media,jwtSecret,crmApiKey:'test',appEnv:'test',evolution:{}});
  const login=await app.fetch(new Request(url+'/auth/login',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({email:'dono@verdevivo.local',password:'CRJornada!Local2026'})
  }));
  expect(login.status).toBe(200);
  token=(await login.json() as any).token;
  tenantId=(await db.prepare("SELECT id FROM tenants WHERE slug='verde-vivo'").first<any>()).id;
  const order=await db.prepare("SELECT id,order_number,customer_id FROM orders WHERE tenant_id=? LIMIT 1")
    .bind(tenantId).first<any>();
  orderId=order.id;orderNumber=order.order_number;customerId=order.customer_id;
});
afterEach(()=>db?.close());

describe('lixeira de pedidos de teste cancelados',()=>{
 it('exige primeiro cancelamento e estorno; não pode excluir pedido ativo',async()=>{
   const res=await req('/admin/orders/'+orderId,'DELETE');
   expect(res.status).toBe(409);
   const order=await db.prepare('SELECT deleted_at,stock_state FROM orders WHERE id=?')
     .bind(orderId).first<any>();
   expect(order.deleted_at).toBeNull();
   expect(order.stock_state).toBe('reserved');
 });
 it('oculta pedido cancelado de listas, relatórios e acompanhamento sem apagar o cliente',async()=>{
   const before=(await db.prepare('SELECT * FROM customers WHERE id=?').bind(customerId).first<any>());
   const cancel=await req('/admin/orders/'+orderId+'/status','PATCH',{status:'cancelled',reason:'Pedido de teste'});
   expect(cancel.status).toBe(200);
   expect((await db.prepare('SELECT stock_state FROM orders WHERE id=?').bind(orderId).first<any>()).stock_state).toBe('released');
   const visible=await req('/admin/orders');
   expect((await visible.json() as any).orders.some((o:any)=>o.id===orderId)).toBe(true);
   const res=await req('/admin/orders/'+orderId,'DELETE');
   expect(res.status).toBe(200);
   expect((await res.json() as any).message).toMatch(/Cliente preservado/);
   const order=await db.prepare('SELECT deleted_at,deleted_by_user_id,status,stock_state FROM orders WHERE id=?')
     .bind(orderId).first<any>();
   expect(order.deleted_at).toBeTruthy();
   expect(order.deleted_by_user_id).toBeTruthy();
   expect(order.status).toBe('cancelled');
   expect(order.stock_state).toBe('released');
   const client=await db.prepare('SELECT id,name,phone,orders_count FROM customers WHERE id=?')
     .bind(customerId).first<any>();
   expect(client.id).toBe(before.id);
   expect(client.name).toBe(before.name);
   expect(client.phone).toBe(before.phone);
   expect(client.orders_count).toBe(0);
   const list:any=await (await req('/admin/orders')).json();
   expect(list.orders.some((o:any)=>o.id===orderId)).toBe(false);
   const dash:any=await (await req('/admin/dashboard')).json();
   expect(dash.recentOrders.some((o:any)=>o.id===orderId)).toBe(false);
   const reports:any=await (await req('/admin/reports')).json();
   expect(reports.summary.orders_count).toBe(0);
   const track=await app.fetch(new Request(url+'/store/verde-vivo/orders/'+orderNumber+'?phone='+before.phone));
   expect(track.status).toBe(404);
   expect((await req('/admin/orders/'+orderId,'DELETE')).status).toBe(404);
   const audit=await db.prepare("SELECT action FROM audit_logs WHERE entity_id=? AND action='order.hidden_test'")
      .bind(orderId).first<any>();
   expect(audit.action).toBe('order.hidden_test');
 });
 it('respeita isolamento por estabelecimento e só proprietário/gerente podem remover',async()=>{
   const otherTenant=await db.prepare("SELECT id FROM tenants WHERE slug='sabor-da-terra'").first<any>();
   const owner=await db.prepare('SELECT id,name,email FROM users WHERE tenant_id=? AND role=? LIMIT 1')
     .bind(otherTenant.id,'owner').first<any>();
   const otherToken=await signJwt({sub:owner.id,name:owner.name,email:owner.email,
     role:'owner',tenantId:otherTenant.id},jwtSecret);
   expect((await req('/admin/orders/'+orderId,'DELETE',undefined,otherToken)).status).toBe(404);
   await req('/admin/orders/'+orderId+'/status','PATCH',{status:'cancelled'});
   const operatorToken=await signJwt({sub:owner.id,name:owner.name,email:owner.email,
     role:'operator',tenantId},jwtSecret);
   const denied=await req('/admin/orders/'+orderId,'DELETE',undefined,operatorToken);
   expect([401,403]).toContain(denied.status);
   expect((await db.prepare('SELECT deleted_at FROM orders WHERE id=?').bind(orderId).first<any>()).deleted_at).toBeNull();
 });
});
