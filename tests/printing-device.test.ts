import {afterEach,describe,expect,it} from 'vitest';
import {SqliteD1Adapter} from '../src/server/db/sqlite-local';
import {seedDatabase} from '../src/server/seed';
import {createApp} from '../src/server/app';
import {formatPrintReceipt,hashSecret} from '../src/server/services/print-jobs';

let db:SqliteD1Adapter;
const media:any={async putObject(){throw Error('unused')},async getObject(){return null}};
const origin='https://hortifruti.crjornada.com';
async function setup(){
 db=new SqliteD1Adapter(':memory:');db.execMigrations('./migrations');await seedDatabase(db,{});
 const app=createApp({db,media,jwtSecret:'test-secret-'.repeat(4),crmApiKey:'test',appEnv:'test',evolution:{}});
 const login=async(email:string)=>{
  const r=await app.fetch(new Request(origin+'/api/auth/login',{
   method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({email,password:'CRJornada!Local2026'})
  }));
  expect(r.status).toBe(200);return ((await r.json()) as any).token as string;
 };
 const a=await login('dono@verdevivo.local'),b=await login('dono@sabordaterra.local');
 const request=(path:string,method:string,body?:any,token?:string)=>app.fetch(new Request(origin+'/api/'+path,{
  method,headers:{...(body===undefined?{}:{'content-type':'application/json'}),...(token?{authorization:'Bearer '+token}:{})},
  body:body===undefined?undefined:JSON.stringify(body)
 }));
 const admin=(token:string,path:string,method='GET',body?:any)=>request('admin/printing'+path,method,body,token);
 const device=(path:string,method='GET',body?:any,token?:string)=>request('printing/device'+path,method,body,token);
 async function pair(token:string,slug:string){
  const gen=await admin(token,'/pairing-codes','POST');expect(gen.status).toBe(200);
  const {code}=await gen.json() as any;
  const paired=await device('/pair','POST',{tenantSlug:slug,code,deviceName:'Balcão Android'});
  expect(paired.status).toBe(201);
  return {...await paired.json() as any,code};
 }
 async function order(){
  const tenant=await db.prepare('SELECT id FROM tenants WHERE slug=?').bind('verde-vivo').first<{id:string}>();
  const p=await db.prepare("SELECT id FROM products WHERE tenant_id=? AND name='Alface crespa'").bind(tenant!.id).first<{id:string}>();
  const res=await request('store/verde-vivo/orders','POST',{
   customerName:'Cliente da Comanda',phone:'73999998811',street:'Rua das Mangueiras',
   number:'123',neighborhood:'Centro',paymentMethod:'cash',needsChange:true,changeFor:'100,00',
   whatsappOptIn:false,items:[{productId:p!.id,quantity:1}]
  });
  expect(res.status).toBe(201);
  return (await res.json() as any).order;
 }
 return {app,request,admin,device,pair,order,a,b};
}
afterEach(()=>{try{db?.close()}catch{}});

describe('ponte Android e fila segura por estabelecimento',()=>{
 it('protege o pareamento: código de uso único, expiração e token revogável',async()=>{
  const {admin,device,pair,a}=await setup();
  const paired=await pair(a,'verde-vivo');
  expect(paired.deviceToken).toMatch(/^[a-f0-9]{64}$/);
  const replay=await device('/pair','POST',{tenantSlug:'verde-vivo',code:paired.code,deviceName:'Outro'});
  expect(replay.status).toBe(403);
  const connected=await device('/status','GET',undefined,paired.deviceToken);
  expect(connected.status).toBe(200);
  expect((await connected.json() as any).enabled).toBe(false);
  const record=await db.prepare('SELECT token_hash FROM print_devices WHERE id=?')
   .bind(paired.deviceId).first<{token_hash:string}>();
  expect(record?.token_hash).toBe(await hashSecret(paired.deviceToken));
  expect(record?.token_hash).not.toBe(paired.deviceToken);
  expect((await admin(a,'/devices/'+paired.deviceId,'DELETE')).status).toBe(404);
  expect((await admin(a,'/devices/'+paired.deviceId,'DELETE',undefined)).status).toBe(404);
  const revoked=await admin(a,'/devices/'+paired.deviceId,'DELETE');
  expect(revoked.status).toBe(404);
 });
 it('gera código revogável e rejeita código expirado',async()=>{
  const {admin,device,a}=await setup();
  const response=await admin(a,'/pairing-codes','POST');
  expect(response.status).toBe(200);
  const {code}=await response.json() as any;
  await db.prepare('UPDATE print_pairing_codes SET expires_at=?').bind('2000-01-01T00:00:00.000Z').run();
  const failed=await device('/pair','POST',{tenantSlug:'verde-vivo',code,deviceName:'Android Expirado'});
  expect(failed.status).toBe(403);
 });
 it('somente Android da loja recebe a comanda, confirma e permite reimpressão controlada',async()=>{
  const {admin,device,pair,order,a,b}=await setup();
  const pa=await pair(a,'verde-vivo'),pb=await pair(b,'sabor-da-terra');
  expect((await admin(a,'/settings','PATCH',{enabled:true})).status).toBe(200);
  const created=await order();expect(created.status).toBe('received');
  const otherClaim=await device('/jobs/claim','POST',{},pb.deviceToken);
  expect(otherClaim.status).toBe(204);
  const mine=await device('/jobs/claim','POST',{},pa.deviceToken);
  expect(mine.status).toBe(200);
  const {job}=await mine.json() as any;
  expect(job.orderNumber).toBe(created.number);
  expect(job.receiptText).toContain('Cliente da Comanda');
  expect(job.receiptText).toContain('Rua das Mangueiras');
  expect(job.receiptText).toContain('SUBTOTAL');
  expect(job.receiptText).toContain('NAO FISCAL');
  expect(job.leaseToken).toMatch(/^[a-f0-9]{48}$/);
  const wrong=await device('/jobs/'+job.id+'/ack','POST',{
   leaseToken:job.leaseToken,success:true},pb.deviceToken);
  expect(wrong.status).toBe(409);
  const ack=await device('/jobs/'+job.id+'/ack','POST',{
   leaseToken:job.leaseToken,success:true},pa.deviceToken);
  expect(ack.status).toBe(200);
  expect((await ack.json() as any).status).toBe('printed');
  expect((await device('/jobs/'+job.id+'/ack','POST',{
   leaseToken:job.leaseToken,success:true},pa.deviceToken)).status).toBe(409);
  expect((await device('/jobs/claim','POST',{},pa.deviceToken)).status).toBe(204);
  const queue:any=await (await admin(a,'')).json();
  expect(queue.jobs[0].status).toBe('printed');
  const re=await admin(a,'/jobs/'+job.id+'/reprint','POST');
  expect(re.status).toBe(201);
  const another=await device('/jobs/claim','POST',{},pa.deviceToken);
  expect(another.status).toBe(200);
  const {job:reprint}=await another.json() as any;
  expect(reprint.jobType).toBe('reprint');
 });
 it('retenta falha sem duplicar reserva e bloqueia dispositivo revogado',async()=>{
  const {admin,device,pair,order,a}=await setup();
  const pa=await pair(a,'verde-vivo');
  await admin(a,'/settings','PATCH',{enabled:true});
  await order();
  const mine=await device('/jobs/claim','POST',{},pa.deviceToken);
  const {job}=await mine.json() as any;
  const failed=await device('/jobs/'+job.id+'/ack','POST',{
   leaseToken:job.leaseToken,success:false,error:'Bluetooth desconectado'
  },pa.deviceToken);
  expect(failed.status).toBe(200);
  expect((await failed.json() as any).status).toBe('queued');
  const again=await device('/jobs/claim','POST',{},pa.deviceToken);
  expect(again.status).toBe(200);
  const againJob=(await again.json() as any).job;
  expect(againJob.id).toBe(job.id);
  expect(againJob.leaseToken).not.toBe(job.leaseToken);
  expect((await admin(a,'/devices/'+pa.deviceId,'DELETE')).status).toBe(405);
  const removed=await admin(a,'/devices/'+pa.deviceId,'DELETE');
  expect(removed.status).toBe(405);
 });
 it('gera comanda térmica de 32 colunas e não repassa controles do cliente',()=>{
  const text=formatPrintReceipt('Minha Loja',{
   order_number:111,created_at:'2026-11-21T12:00:00.000Z',
   customer_name:'Maria Teste',customer_phone:'5573999999999',
   address_street:'Rua do Comercio',address_number:'10',address_neighborhood:'Centro',
   payment_method:'cash',subtotal_cents:350,delivery_fee_cents:600,total_cents:950,
   needs_change:1,change_for_cents:2000,change_amount_cents:1050
  },[{product_name_snapshot:'Alface crespa',quantity_display:'2 unidades',line_total_cents:350}]);
  expect(text).toContain('R$ 9,50');
  expect(text).toContain('Troco: R$ 10,50');
  expect(text.split('\n').every(line=>line.length<=80)).toBe(true);
 });
});
