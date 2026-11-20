import {afterEach,describe,expect,it} from 'vitest';
import {SqliteD1Adapter} from '../src/server/db/sqlite-local';
import {seedDatabase} from '../src/server/seed';
import {validateAndPrepareOrderLines,buildAtomicStockReservationSteps} from '../src/server/services/inventory';
import {runConditionalTransaction} from '../src/server/db/adapter';

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
  await runConditionalTransaction(db,buildAtomicStockReservationSteps(db,tenantId,'order-test',1010,prepared.lines,new Date().toISOString()));
  const state=await db.prepare('SELECT physical_qty,reserved_qty FROM products WHERE id=?').bind(productId).first<any>();
  expect(state).toEqual({physical_qty:2000,reserved_qty:820});
 });
 it('não permite modalidade não habilitada',async()=>{
  const {tenantId,productId}=await setup();
  await db.prepare('UPDATE products SET unit_price_cents=NULL,unit_weight_grams=NULL WHERE id=?').bind(productId).run();
  await expect(validateAndPrepareOrderLines(db,tenantId,[{product_id:productId,purchase_mode:'unit',quantity:1}])).rejects.toThrow(/forma de venda/);
 });
});
