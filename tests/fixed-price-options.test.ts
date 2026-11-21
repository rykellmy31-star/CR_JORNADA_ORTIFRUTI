import {afterEach,describe,expect,it} from 'vitest';
import {SqliteD1Adapter} from '../src/server/db/sqlite-local';
import {seedDatabase} from '../src/server/seed';
import {createApp} from '../src/server/app';
import {signJwt} from '../src/server/security/crypto';
import {validateAndPrepareOrderLines} from '../src/server/services/inventory';

let db:SqliteD1Adapter;
const media:any={async putObject(){throw Error('unused')},async getObject(){return null}};
async function setup(){
 db=new SqliteD1Adapter(':memory:');db.execMigrations('./migrations');await seedDatabase(db,{});
 const tenant=await db.prepare("SELECT id FROM tenants WHERE slug='verde-vivo'").first<{id:string}>();
 const other=await db.prepare("SELECT id FROM tenants WHERE slug='sabor-da-terra'").first<{id:string}>();
 const owner=await db.prepare("SELECT id,name,email,role FROM users WHERE tenant_id=? AND role='owner' LIMIT 1").bind(tenant!.id).first<any>();
 const otherOwner=await db.prepare("SELECT id,name,email,role FROM users WHERE tenant_id=? AND role='owner' LIMIT 1").bind(other!.id).first<any>();
 const secret='test-secret'.repeat(4);
 const token=await signJwt({sub:owner.id,name:owner.name,email:owner.email,role:'owner',tenantId:tenant!.id},secret);
 const otherToken=await signJwt({sub:otherOwner.id,name:otherOwner.name,email:otherOwner.email,role:'owner',tenantId:other!.id},secret);
 const app=createApp({db,media,jwtSecret:secret,crmApiKey:'test',appEnv:'test',evolution:{}});
 const post=(path:string,method:string,payload:unknown,auth?:string)=>app.fetch(new Request('http://local/api/'+path,{
  method,headers:{'content-type':'application/json',...(auth?{authorization:'Bearer '+auth}:{})},
  body:JSON.stringify(payload)
 }));
 const create=(input:any)=>post('admin/products/with-variants','POST',{
  name:'Mexerica',categoryId:null,description:'Doce e suculenta',
  fixedOptionsEnabled:true,sharedPool:true,poolPhysicalQty:20000,
  variants:[
   {name:'Meio Kg',priceCents:500,deductionQty:500},
   {name:'1 Kg',priceCents:999,deductionQty:1000},
   {name:'1,5 Kg',priceCents:1500,deductionQty:1500},
   {name:'2 Kg',priceCents:2000,deductionQty:2000}
  ],...input
 },token);
 return {tenant:tenant!.id,other:other!.id,token,otherToken,app,post,create};
}
afterEach(()=>{try{db?.close()}catch{}});

describe('preço fixo por quantidade no CR Jornada Express',()=>{
 it('cadastra opções independentes, com estoque físico compartilhado em gramas, sem afetar outras lojas',async()=>{
  const {tenant,other,app,create}=await setup();
  const response=await create({});
  expect(response.status).toBe(201);
  const {id,stockPoolId}=await response.json() as any;
  const p=await db.prepare('SELECT sale_mode,fixed_options_enabled FROM products WHERE id=? AND tenant_id=?')
   .bind(id,tenant).first<any>();
  expect(p).toEqual({sale_mode:'variants',fixed_options_enabled:1});
  const pool=await db.prepare('SELECT base_unit,physical_qty,reserved_qty FROM stock_pools WHERE id=?')
   .bind(stockPoolId).first<any>();
  expect(pool).toEqual({base_unit:'g',physical_qty:20000,reserved_qty:0});
  const store=await app.fetch(new Request('http://local/api/store/verde-vivo'));
  expect(store.status).toBe(200);
  const products=(await store.json() as any).products;
  const mex=products.find((product:any)=>product.id===id);
  expect(mex.fixed_options_enabled).toBe(1);
  expect(mex.variants.map((v:any)=>[v.name,v.price_cents])).toEqual([
   ['Meio Kg',500],['1 Kg',999],['1,5 Kg',1500],['2 Kg',2000]
  ]);
  const otherStore=await app.fetch(new Request('http://local/api/store/sabor-da-terra'));
  expect((await otherStore.json() as any).products.some((v:any)=>v.id===id)).toBe(false);
  expect((await db.prepare('SELECT id FROM products WHERE tenant_id=? AND fixed_options_enabled=1').bind(other).all()).results).toHaveLength(0);
 });
 it('calcula valores fechados sem multiplicar preço por kg e desconta peso de todas as opções no mesmo estoque',async()=>{
  const {tenant,create,post}=await setup();
  const created=await create({});expect(created.status).toBe(201);
  const {id,stockPoolId}=await created.json() as any;
  const v=await db.prepare('SELECT id,name FROM product_variants WHERE tenant_id=? AND product_id=? ORDER BY sort_order')
   .bind(tenant,id).all<{id:string;name:string}>();
  const lines=await validateAndPrepareOrderLines(db,tenant,[
   {product_id:id,variant_id:v.results[0].id,quantity:2},
   {product_id:id,variant_id:v.results[2].id,quantity:1}
  ]);
  expect(lines.subtotalCents).toBe(2500);
  expect(lines.lines.map(x=>[x.sale_mode,x.quantity_display,x.stock_deducted_qty,x.unit])).toEqual([
   ['variants','2x Meio Kg',1000,'g'],['variants','1x 1,5 Kg',1500,'g']
  ]);
  const order=await post('store/verde-vivo/orders','POST',{
   customerName:'Compra com preço fixo',phone:'73999998872',street:'Rua das Flores',
   number:'1',neighborhood:'Centro',paymentMethod:'cash',whatsappOptIn:false,
   items:[{productId:id,variantId:v.results[0].id,quantity:2},
    {productId:id,variantId:v.results[2].id,quantity:1}]
  });
  expect(order.status).toBe(201);
  expect((await order.json() as any).order.subtotalCents).toBe(2500);
  const pool=await db.prepare('SELECT reserved_qty FROM stock_pools WHERE id=?').bind(stockPoolId).first<any>();
  expect(pool.reserved_qty).toBe(2500);
 });
 it('não cria produto incompleto e impede misturar estoque de outra loja',async()=>{
  const {create,app,post,otherToken}=await setup();
  const invalid=await create({variants:[{name:'Meio Kg',priceCents:0,deductionQty:500}]});
  expect(invalid.status).toBe(400);
  const duplicate=await create({variants:[
   {name:'1 Kg',priceCents:1000,deductionQty:1000},
   {name:'1 kg',priceCents:2000,deductionQty:2000}
  ]});
  expect(duplicate.status).toBe(400);
  const none=await db.prepare("SELECT id FROM products WHERE name='Mexerica'").all();
  expect(none.results).toHaveLength(0);
  const created=await create({});
  const {id}=await created.json() as any;
  const unauthorized=await post('admin/products/'+id+'/fixed-stock','PATCH',{physicalQtyGrams:1000},otherToken);
  expect(unauthorized.status).toBe(404);
  const list=await app.fetch(new Request('http://local/api/admin/products',{headers:{authorization:'Bearer '+otherToken}}));
  expect((await list.json() as any).products.some((p:any)=>p.id===id)).toBe(false);
 });
 it('altera estoque em kg sem diminuir o volume reservado por pedidos',async()=>{
  const {create,post,token}=await setup();
  const created=await create({});const {id,stockPoolId}=await created.json() as any;
  await db.prepare('UPDATE stock_pools SET reserved_qty=1500 WHERE id=?').bind(stockPoolId).run();
  const low=await post('admin/products/'+id+'/fixed-stock','PATCH',{physicalQtyGrams:1000},token);
  expect(low.status).toBe(409);
  const valid=await post('admin/products/'+id+'/fixed-stock','PATCH',{physicalQtyGrams:18000},token);
  expect(valid.status).toBe(200);
  const row=await db.prepare('SELECT physical_qty,reserved_qty FROM stock_pools WHERE id=?').bind(stockPoolId).first<any>();
  expect(row).toEqual({physical_qty:18000,reserved_qty:1500});
 });
});
