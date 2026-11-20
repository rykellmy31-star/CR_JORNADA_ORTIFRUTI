import {afterEach,describe,expect,it} from 'vitest';
import {SqliteD1Adapter} from '../src/server/db/sqlite-local';
import {seedDatabase} from '../src/server/seed';
import {createApp} from '../src/server/app';

let db:SqliteD1Adapter;
afterEach(()=>{try{db?.close()}catch{}});
async function setup(optin=true,payment:'cash'|'pix_delivery'='cash'){
  db=new SqliteD1Adapter(':memory:');
  db.execMigrations('./migrations');
  await seedDatabase(db,{});
  const media:any={async putObject(){throw Error('unused')},async getObject(){return null}};
  const app=createApp({db,media,jwtSecret:'test-secret'.repeat(4),crmApiKey:'test',
    appEnv:'test',evolution:{}});
  const login=await app.fetch(new Request('http://local/api/auth/login',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({email:'dono@verdevivo.local',password:'CRJornada!Local2026'})
  }));
  expect(login.status).toBe(200);
  const {token}=await login.json() as any;
  const tenant=(await db.prepare("SELECT id FROM tenants WHERE slug='verde-vivo'").first<any>()).id;
  const {results}=await db.prepare(`SELECT id,name,sale_mode,physical_qty FROM products
    WHERE tenant_id=? AND sale_mode='weight' AND is_active=1 AND is_deleted=0 AND stock_pool_id IS NULL
    AND physical_qty>=2000 LIMIT 2`).bind(tenant).all<any>();
  expect(results.length).toBeGreaterThanOrEqual(2);
  const orderRequest:any={
    customerName:'Maria Teste',phone:'(73) 99999-3311',street:'Rua A',number:'10',
    neighborhood:'Centro',paymentMethod:payment,whatsappOptIn:optin,
    items:[{productId:results[0].id,purchaseMode:'weight',quantity:1000},
      {productId:results[1].id,purchaseMode:'weight',quantity:500}]
  };
  if(payment==='cash'){orderRequest.needsChange=true;orderRequest.changeFor='100,00';}
  const create=await app.fetch(new Request('http://local/api/store/verde-vivo/orders',{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(orderRequest)
  }));
  expect(create.status).toBe(201);
  const created:any=await create.json();
  const id=created.order.id;
  const before=(await db.prepare('SELECT * FROM orders WHERE id=?').bind(id).first<any>());
  const {results:items}=await db.prepare('SELECT * FROM order_items WHERE order_id=? ORDER BY rowid')
    .bind(id).all<any>();
  expect(items).toHaveLength(2);
  const patch=async(body:any,orderId=id,auth=token)=>app.fetch(
    new Request('http://local/api/admin/orders/'+orderId+'/items',{
      method:'PATCH',headers:{'content-type':'application/json',authorization:'Bearer '+auth},
      body:JSON.stringify(body)
    })
  );
  return {app,token,tenant,id,before,items,patch,products:results};
}
describe('ajuste dos pedidos antes da entrega',()=>{
 it('retira produto, reduz gramas, devolve reserva, recalcula total e troco e registra histórico',async()=>{
   const {app,id,tenant,before,items,patch,products}=await setup(true);
   const originalStock=await db.prepare('SELECT reserved_qty FROM products WHERE id=?')
     .bind(products[1].id).first<any>();
   const resp=await patch({expectedVersion:0,reason:'Produto em falta na loja',
     updates:[{itemId:items[0].id,quantity:0},{itemId:items[1].id,quantity:250}]});
   expect(resp.status).toBe(200);
   const result:any=await resp.json();
   expect(result.version).toBe(1);
   expect(result.changes).toHaveLength(2);
   expect(result.notificationStatus).toBe('pending');
   const order=await db.prepare('SELECT * FROM orders WHERE id=?').bind(id).first<any>();
   expect(order.adjustment_version).toBe(1);
   expect(order.total_cents).toBeLessThan(before.total_cents);
   expect(order.total_cents).toBe(order.subtotal_cents+order.delivery_fee_cents);
   expect(order.change_amount_cents).toBe(order.change_for_cents-order.total_cents);
   const saved=(await db.prepare('SELECT * FROM order_items WHERE order_id=?').bind(id).all<any>()).results;
   expect(saved).toHaveLength(1);
   expect(saved[0].quantity).toBe(250);
   expect(saved[0].line_total_cents).toBe(Math.round(items[1].line_total_cents/2));
   const adjustedStock=await db.prepare('SELECT reserved_qty FROM products WHERE id=?')
     .bind(products[1].id).first<any>();
   expect(adjustedStock.reserved_qty).toBe(originalStock.reserved_qty-250);
   const firstStock=await db.prepare('SELECT reserved_qty FROM products WHERE id=?')
     .bind(products[0].id).first<any>();
   expect(firstStock.reserved_qty).toBe(0);
   const adjustment=await db.prepare('SELECT * FROM order_adjustments WHERE order_id=?').bind(id).first<any>();
   expect(adjustment).toMatchObject({reason:'Produto em falta na loja',version:1});
   const q=await db.prepare("SELECT status,event_type,rendered_message FROM whatsapp_message_queue WHERE order_id=? AND event_type='order_adjusted'").bind(id).first<any>();
   expect(q.status).toBe('pending');
   expect(q.rendered_message).toContain('Produto em falta na loja');
   expect(q.rendered_message).toContain('Novo total');
   const privateView=await app.fetch(new Request(
     'http://local/api/store/verde-vivo/orders/'+before.order_number+'?phone=73999993311'));
   expect(privateView.status).toBe(200);
   const view:any=await privateView.json();
   expect(view.items).toHaveLength(1);
   expect(view.order.total_cents).toBe(order.total_cents);
   expect(view.adjustments).toHaveLength(1);
   const privateWrong=await app.fetch(new Request(
     'http://local/api/store/sabor-da-terra/orders/'+before.order_number+'?phone=73999993311'));
   expect(privateWrong.status).toBe(404);
 });
 it('não altera reserva duas vezes na mesma versão, nem permite aumentar a quantidade',async()=>{
   const {id,items,patch}=await setup(false);
   const first=await patch({expectedVersion:0,reason:'Quantidade ajustada pelo estoque',updates:[{itemId:items[0].id,quantity:500}]});
   expect(first.status).toBe(200);
   const other=await patch({expectedVersion:0,reason:'Tentativa duplicada de ajuste',updates:[{itemId:items[1].id,quantity:250}]});
   expect(other.status).toBe(409);
   const invalid=await patch({expectedVersion:1,reason:'Tentativa de incluir produto',updates:[{itemId:items[1].id,quantity:1000}]});
   expect(invalid.status).toBe(400);
   const q=await db.prepare("SELECT status FROM whatsapp_message_queue WHERE order_id=? AND event_type='order_adjusted'").bind(id).first<any>();
   expect(q.status).toBe('skipped_no_optin');
   const count=await db.prepare('SELECT COUNT(*) total FROM order_adjustments WHERE order_id=?').bind(id).first<any>();
   expect(count.total).toBe(1);
 });
 it('bloqueia alteração após saída para entrega e para outras lojas',async()=>{
   const {id,items,patch}=await setup();
   const cross=await patch({expectedVersion:0,reason:'Alteração em outro estabelecimento',updates:[{itemId:items[0].id,quantity:500}]},'id-de-outro-tenant');
   expect(cross.status).toBe(409);
   await db.prepare("UPDATE orders SET status='out_for_delivery' WHERE id=?").bind(id).run();
   const res=await patch({expectedVersion:0,reason:'Alteração após a saída para entrega',updates:[{itemId:items[0].id,quantity:500}]});
   expect(res.status).toBe(409);
   const count=await db.prepare('SELECT COUNT(*) total FROM order_adjustments WHERE order_id=?').bind(id).first<any>();
   expect(count.total).toBe(0);
 });
 it('marca produto removido como esgotado sem afetar reservas de outros pedidos',async()=>{
   const {id,items,patch,tenant}=await setup();
   const old=await db.prepare('SELECT physical_qty,reserved_qty FROM products WHERE id=? AND tenant_id=?')
     .bind(items[0].product_id,tenant).first<any>();
   expect(old.physical_qty).toBeGreaterThan(old.reserved_qty);
   const res=await patch({
     expectedVersion:0,reason:'Mercadoria esgotada para novas vendas',
     updates:[{itemId:items[0].id,quantity:0,markOutOfStock:true}]
   });
   expect(res.status).toBe(200);
   const updated=await db.prepare('SELECT physical_qty,reserved_qty FROM products WHERE id=? AND tenant_id=?')
     .bind(items[0].product_id,tenant).first<any>();
   expect(updated.physical_qty).toBe(updated.reserved_qty);
   expect(updated.physical_qty).toBe(0);
   const moves=(await db.prepare("SELECT movement_type,delta_physical,delta_reserved,reason FROM stock_movements WHERE tenant_id=? AND order_id=? AND reason LIKE '%Esgotado na vitrine%'")
     .bind(tenant,id).all<any>()).results;
   expect(moves).toHaveLength(1);
   expect(moves[0].delta_physical).toBeLessThan(0);
   const catalog:any=await (await (await setupCatalog()).json());
   // A disponibilidade do produto deve ser zero na API da vitrine, sem excluir seu histórico.
   expect(catalog.products.some((p:any)=>p.id===items[0].product_id)).toBe(false);
   async function setupCatalog(){
     const media:any={async putObject(){throw Error('unused')},async getObject(){return null}};
     const app=createApp({db,media,jwtSecret:'test-secret'.repeat(4),crmApiKey:'test',appEnv:'test',evolution:{}});
     return app.fetch(new Request('http://local/api/store/verde-vivo'));
   }
 });
 it('não permite marcar como esgotado sem retirar o item',async()=>{
   const {items,patch}=await setup();
   const res=await patch({expectedVersion:0,reason:'Tentativa inválida de estoque',
     updates:[{itemId:items[0].id,quantity:500,markOutOfStock:true}]});
   expect(res.status).toBe(400);
 });
 it('reverte toda a edição quando a reserva física mudou',async()=>{
   const {id,items,patch,before,tenant}=await setup();
   await db.prepare('UPDATE products SET reserved_qty=0 WHERE id=? AND tenant_id=?').bind(items[0].product_id,tenant).run();
   const res=await patch({expectedVersion:0,reason:'Falta parcial do produto',
     updates:[{itemId:items[0].id,quantity:500}]});
   expect(res.status).toBe(409);
   const order=await db.prepare('SELECT adjustment_version,total_cents FROM orders WHERE id=?').bind(id).first<any>();
   expect(order.adjustment_version).toBe(0);
   expect(order.total_cents).toBe(before.total_cents);
   expect((await db.prepare('SELECT quantity FROM order_items WHERE id=?').bind(items[0].id).first<any>()).quantity).toBe(1000);
   const hist=await db.prepare('SELECT COUNT(*) total FROM order_adjustments WHERE order_id=?').bind(id).first<any>();
   expect(hist.total).toBe(0);
 });
});
