import {afterEach,describe,expect,it} from 'vitest';
import {SqliteD1Adapter} from '../src/server/db/sqlite-local';
import {seedDatabase} from '../src/server/seed';
import {validateAndPrepareOrderLines} from '../src/server/services/inventory';
import {createApp} from '../src/server/app';

let db:SqliteD1Adapter;
afterEach(()=>{try{db?.close()}catch{}});
async function setup(){
 db=new SqliteD1Adapter(':memory:');
 db.execMigrations('./migrations');
 await seedDatabase(db,{});
 const t=await db.prepare("SELECT id FROM tenants WHERE slug='verde-vivo'").first<any>();
 const p=await db.prepare("SELECT id FROM products WHERE tenant_id=? AND name='Tomate italiano'").bind(t.id).first<any>();
 await db.prepare("UPDATE products SET price_cents=980,unit_price_cents=230,unit_weight_grams=160,physical_qty=2000,reserved_qty=0 WHERE id=? AND tenant_id=?").bind(p.id,t.id).run();
 return {tenantId:t.id,productId:p.id};
}

describe('venda por kg e unidade',()=>{
 it('usa dois preços e desconta unidades em gramas do mesmo estoque',async()=>{
  const {tenantId,productId}=await setup();
  const prepared=await validateAndPrepareOrderLines(db,tenantId,[
   {product_id:productId,purchase_mode:'unit',quantity:2},
   {product_id:productId,purchase_mode:'weight',quantity:500},
  ]);
  expect(prepared.subtotalCents).toBe(950);
  expect(prepared.lines.map(x=>[x.sale_mode,x.stock_deducted_qty,x.quantity_display])).toEqual([
   ['unit',320,'2 un'],['weight',500,'500 g']
  ]);
  const media:any={async putObject(){throw Error('unused')},async getObject(){return null}};
  const app=createApp({db,media,jwtSecret:'test-secret'.repeat(4),crmApiKey:'test',appEnv:'test',evolution:{}});
  const response=await app.fetch(new Request('http://local/api/store/verde-vivo/orders',{
   method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({customerName:'Compra mista',phone:'73999990178',street:'Rua A',number:'4',
     neighborhood:'Centro',paymentMethod:'cash',whatsappOptIn:false,
     items:[{productId,purchaseMode:'unit',quantity:2},{productId,purchaseMode:'weight',quantity:500}]})
  }));
  expect(response.status).toBe(201);
  expect((await response.json() as any).order.subtotalCents).toBe(950);
  const state=await db.prepare('SELECT physical_qty,reserved_qty FROM products WHERE id=?').bind(productId).first<any>();
  expect(state).toEqual({physical_qty:2000,reserved_qty:820});
 });
 it('não permite modalidade não habilitada',async()=>{
  const {tenantId,productId}=await setup();
  await db.prepare('UPDATE products SET unit_price_cents=NULL,unit_weight_grams=NULL WHERE id=?').bind(productId).run();
  await expect(validateAndPrepareOrderLines(db,tenantId,[{product_id:productId,purchase_mode:'unit',quantity:1}])).rejects.toThrow(/forma de venda/);
 });
});
