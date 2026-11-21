import {afterEach,describe,expect,it} from 'vitest';
import {SqliteD1Adapter} from '../src/server/db/sqlite-local';
import {seedDatabase} from '../src/server/seed';
import {createApp} from '../src/server/app';

let db:SqliteD1Adapter;
const media:any={async putObject(){throw Error('unused')},async getObject(){return null}};
async function setup(){
 db=new SqliteD1Adapter(':memory:');
 db.execMigrations('./migrations');
 await seedDatabase(db,{});
 const app=createApp({db,media,jwtSecret:'test-secret-'.repeat(4),crmApiKey:'test',appEnv:'test',evolution:{}});
 const login=async(email:string)=>{
  const response=await app.fetch(new Request('http://local/api/auth/login',{
   method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({email,password:'CRJornada!Local2026'})
  }));
  expect(response.status).toBe(200);
  return ((await response.json()) as any).token as string;
 };
 const tokenA=await login('dono@verdevivo.local');
 const tokenB=await login('dono@sabordaterra.local');
 const admin=(token:string,path:string,method='GET',body?:unknown)=>app.fetch(new Request('http://local/api/admin/'+path,{
  method,headers:{authorization:'Bearer '+token,...(body===undefined?{}:{'content-type':'application/json'})},
  body:body===undefined?undefined:JSON.stringify(body)
 }));
 const checkout=async(slug:string,phone:string,paymentMethod='cash')=>{
  const t=await db.prepare('SELECT id FROM tenants WHERE slug=?').bind(slug).first<{id:string}>();
  const product=await db.prepare("SELECT id FROM products WHERE tenant_id=? AND name='Alface crespa'")
   .bind(t!.id).first<{id:string}>();
  return app.fetch(new Request('http://local/api/store/'+slug+'/orders',{
   method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({customerName:'Pedido Impresso',phone,street:'Rua A',number:'12',
    neighborhood:'Centro',paymentMethod,whatsappOptIn:false,items:[{productId:product!.id,quantity:1}]})
  }));
 };
 return {app,admin,checkout,tokenA,tokenB};
}
afterEach(()=>{try{db?.close()}catch{}});

describe('fila de impressão automática por estabelecimento',()=>{
 it('fica desativada por padrão e não gera comanda para lojas antigas sem ativação',async()=>{
  const {admin,checkout,tokenA}=await setup();
  const config=await admin(tokenA,'printing');
  expect(config.status).toBe(200);
  expect((await config.json() as any)).toEqual({enabled:false,jobs:[]});
  const created=await checkout('verde-vivo','73999999991');
  expect(created.status).toBe(201);
  const rows=await db.prepare('SELECT id FROM print_jobs').all();
  expect(rows.results).toHaveLength(0);
 });
 it('gera exatamente uma comanda no checkout, sem precisar de aceite, isolada por loja',async()=>{
  const {admin,checkout,tokenA,tokenB}=await setup();
  expect((await admin(tokenA,'printing/settings','PATCH',{enabled:true})).status).toBe(200);
  expect((await admin(tokenA,'printing/settings','PATCH',{enabled:'sim'})).status).toBe(400);
  const created=await checkout('verde-vivo','73999999992');
  expect(created.status).toBe(201);
  const {order}=await created.json() as any;
  expect(order.status).toBe('received');
  const a:any=await (await admin(tokenA,'printing')).json();
  expect(a.enabled).toBe(true);
  expect(a.jobs).toHaveLength(1);
  expect(a.jobs[0]).toMatchObject({
   order_id:order.id,order_number:order.number,job_type:'new_order',
   status:'queued',attempts:0,printed_at:null
  });
  expect(a.jobs[0]).not.toHaveProperty('customer_phone');
  const b:any=await (await admin(tokenB,'printing')).json();
  expect(b.enabled).toBe(false);
  expect(b.jobs).toHaveLength(0);
  const second=await checkout('sabor-da-terra','73999999993');
  expect(second.status).toBe(201);
  const all=await db.prepare('SELECT * FROM print_jobs').all();
  expect(all.results).toHaveLength(1);
  const denied=await admin('invalid','printing');
  expect(denied.status).toBe(401);
 });
 it('não enfileira pedido rejeitado; desativar impede novas comandas',async()=>{
  const {admin,checkout,tokenA}=await setup();
  expect((await admin(tokenA,'printing/settings','PATCH',{enabled:true})).status).toBe(200);
  const failed=await checkout('verde-vivo','73999999994','forma-invalida');
  expect(failed.status).toBe(400);
  expect((await db.prepare('SELECT id FROM print_jobs').all()).results).toHaveLength(0);
  expect((await admin(tokenA,'printing/settings','PATCH',{enabled:false})).status).toBe(200);
  expect((await checkout('verde-vivo','73999999995')).status).toBe(201);
  expect((await db.prepare('SELECT id FROM print_jobs').all()).results).toHaveLength(0);
 });
});
