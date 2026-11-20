import {afterEach,describe,expect,it,vi} from 'vitest';
import {SqliteD1Adapter} from '../src/server/db/sqlite-local';
import {seedDatabase} from '../src/server/seed';
import {createApp} from '../src/server/app';

const cf={enabled:true,accountId:'a'.repeat(32),zoneId:'b'.repeat(32),apiToken:'secret-'.repeat(8)};
const response=(result:any,status=200)=>new Response(JSON.stringify({success:status<400,result}),{
 status,headers:{'content-type':'application/json'}
});
let db:SqliteD1Adapter;
async function setup(){
 db=new SqliteD1Adapter(':memory:');db.execMigrations('./migrations');
 await seedDatabase(db,{});
 const app=createApp({db,media:{getObject:async()=>null,putObject:async()=>undefined} as any,
  jwtSecret:'test-secret-'.repeat(4),crmApiKey:'test-crm-key',appEnv:'test',
  evolution:{},cloudflareDomains:cf});
 const login=await app.fetch(new Request('http://local/api/auth/login',{method:'POST',
  headers:{'content-type':'application/json'},
  body:JSON.stringify({email:'admin@crjornada.com.br',password:'CRJornada!Local2026'})}));
 expect(login.status).toBe(200);
 const {token}=await login.json() as any;
 const create=()=>app.fetch(new Request('http://local/api/superadmin/tenants',{
  method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},
  body:JSON.stringify({name:'Verdurão Testes',slug:'verdurao-testes',
   ownerName:'Proprietário Testes',ownerEmail:'proprietario@verduratestes.example',
   temporaryPassword:'NovaSenhaSegura!2026'})
 }));
 const retry=(id:string)=>app.fetch(new Request('http://local/api/superadmin/tenants/'+id+'/domain/retry',{
  method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:'{}'
 }));
 return {app,token,create,retry};
}
afterEach(()=>{vi.unstubAllGlobals();try{db?.close();}catch{}});
describe('cadastro e recuperação de domínio do Hortifruti',()=>{
 it('registra na Cloudflare e só então ativa a loja',async()=>{
  const mock=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
   if(init?.method==='PUT')return response({id:'dom-10',
    hostname:'verdurao-testes.crjornada.com',service:'cr-jornada-hortifruti',
    zone_id:cf.zoneId});
   return response([]);
  });
  vi.stubGlobal('fetch',mock);
  const {create}=await setup();
  const result=await create();expect(result.status).toBe(201);
  const body=await result.json() as any;
  expect(body.domainStatus).toBe('registered');
  expect((await db.prepare('SELECT status FROM tenants WHERE id=?').bind(body.tenantId).first<any>())?.status).toBe('active');
  expect((await db.prepare('SELECT status FROM tenant_store_domains WHERE tenant_id=?').bind(body.tenantId).first<any>())?.status).toBe('registered');
 });
 it('em falha externa mantém onboarding e recupera na tentativa seguinte',async()=>{
  let failed=true;
  const mock=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
   if(init?.method==='PUT'){
    if(failed)return response(null,502);
    return response({id:'dom-11',hostname:'verdurao-testes.crjornada.com',
     service:'cr-jornada-hortifruti',zone_id:cf.zoneId});
   }
   return response([]);
  });
  vi.stubGlobal('fetch',mock);
  const {create,retry}=await setup();
  const result=await create();
  expect(result.status).toBe(201);
  const body=await result.json() as any;
  expect(body.domainStatus).toBe('pending');
  expect((await db.prepare('SELECT status FROM tenants WHERE id=?').bind(body.tenantId).first<any>())?.status).toBe('onboarding');
  failed=false;
  const second=await retry(body.tenantId);expect(second.status).toBe(200);
  expect((await second.json() as any).domainStatus).toBe('registered');
  expect((await db.prepare('SELECT status FROM tenants WHERE id=?').bind(body.tenantId).first<any>())?.status).toBe('active');
 });
 it('domínio de outro serviço bloqueia o cadastro antes de tocar no D1',async()=>{
  const mock=vi.fn(async()=>response([{
   id:'other',hostname:'verdurao-testes.crjornada.com',
   service:'outro-servico',zone_id:cf.zoneId
  }]));
  vi.stubGlobal('fetch',mock);
  const {create}=await setup();
  const before=(await db.prepare('SELECT COUNT(*) AS n FROM tenants').first<any>())?.n;
  const attempt=await create();expect(attempt.status).toBe(409);
  expect((await db.prepare('SELECT COUNT(*) AS n FROM tenants').first<any>())?.n).toBe(before);
  expect(mock).toHaveBeenCalledTimes(1);
 });
});
