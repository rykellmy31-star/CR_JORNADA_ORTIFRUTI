import {describe,it,expect} from 'vitest';
import {getStoreStatus,defaultSchedule,scheduleSchema} from '../src/shared/store-hours';
import {SqliteD1Adapter} from '../src/server/db/sqlite-local';
import {seedDatabase} from '../src/server/seed';
import {createApp} from '../src/server/app';
const schedule=defaultSchedule();schedule.enabled=true;schedule.days[1]={enabled:true,open:'07:00',close:'19:00'};
describe('horários da loja',()=>{
 it('preserva abertura manual e não inventa previsão quando pausada',()=>{
  expect(getStoreStatus(true,null).open).toBe(true);
  expect(getStoreStatus(false,schedule)).toMatchObject({open:false,reason:'manual',nextOpening:null});
 });
 it('calcula horário de Bahia e próxima abertura',()=>{
  expect(getStoreStatus(true,schedule,new Date('2026-11-23T09:59:00Z'))).toMatchObject({open:false,nextOpening:'hoje às 07:00'});
  expect(getStoreStatus(true,schedule,new Date('2026-11-23T10:00:00Z')).open).toBe(true);
  expect(getStoreStatus(true,schedule,new Date('2026-11-23T22:00:00Z'))).toMatchObject({open:false,nextOpening:'segunda-feira às 07:00'});
 });
 it('aceita restaurantes que fecham depois da meia-noite',()=>{
  const s=defaultSchedule();s.enabled=true;s.days[6]={enabled:true,open:'18:00',close:'02:00'};
  expect(getStoreStatus(true,s,new Date('2026-11-22T04:59:00Z')).open).toBe(true);
  expect(getStoreStatus(true,s,new Date('2026-11-22T05:00:00Z')).open).toBe(false);
 });
 it('rejeita horário inválido',()=>{
  expect(scheduleSchema.safeParse({...schedule,days:[]}).success).toBe(false);
 });
 it('aplica o fechamento também no checkout do servidor',async()=>{
  const db=new SqliteD1Adapter(':memory:');
  try{
   db.execMigrations('./migrations');await seedDatabase(db,{});
   const app=createApp({db,media:{async putObject(){throw Error('unused')},async getObject(){return null}} as any,jwtSecret:'test-secret-'.repeat(4),crmApiKey:'test',appEnv:'test',evolution:{}});
   const closed=defaultSchedule();closed.enabled=true;
   await db.prepare("UPDATE tenants SET opening_schedule_json=?,is_open=1 WHERE slug='verde-vivo'").bind(JSON.stringify(closed)).run();
   const status=await app.fetch(new Request('http://local/api/store/verde-vivo/status'));
   expect((await status.json() as any).open).toBe(false);
   const catalog=await app.fetch(new Request('http://local/api/store/verde-vivo'));
   expect((await catalog.json() as any).store.is_open).toBe(0);
   const response=await app.fetch(new Request('http://local/api/store/verde-vivo/orders',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({customerName:'Cliente Teste',phone:'73999990001',street:'Rua A',number:'1',neighborhood:'Centro',paymentMethod:'cash',whatsappOptIn:false,items:[{productId:'teste',quantity:1}]})}));
   expect(response.status).toBe(409);
  }finally{db.close();}
 });
});
