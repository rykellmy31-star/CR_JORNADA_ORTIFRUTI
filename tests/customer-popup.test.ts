import {afterEach,describe,expect,it} from 'vitest';
import {SqliteD1Adapter} from '../src/server/db/sqlite-local';
import {seedDatabase} from '../src/server/seed';
import {createApp} from '../src/server/app';

let db:SqliteD1Adapter;
afterEach(()=>{try{db?.sqlite.close()}catch{}});
async function setup(){
 db=new SqliteD1Adapter(':memory:');
 db.execMigrations('./migrations');
 await seedDatabase(db,{});
 const media:any={async putObject(){throw Error('unused')},async getObject(){return null}};
 return createApp({db,media,jwtSecret:'test-secret-'.repeat(4),crmApiKey:'test-crm-key',appEnv:'test',evolution:{}});
}
const data={name:'Ana das Flores',email:'ana@example.com',phone:'(73) 99999-1234',privacyAccepted:true,marketingOptIn:true};
async function signup(app:any,slug:string,body:any=data){
 return app.fetch(new Request('http://local/api/store/'+slug+'/signup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));
}
describe('cadastro voluntário na vitrine',()=>{
 it('exibe configuração da loja sem afetar a vitrine de outras lojas',async()=>{
  const app=await setup();
  const response=await app.fetch(new Request('http://local/api/store/verde-vivo'));
  expect(response.status).toBe(200);
  const payload:any=await response.json();
  expect(payload.store.signup_popup_enabled).toBe(1);
  expect(payload.store.signup_popup_title).toMatch(/Fresquinho/);
 });
 it('cadastra uma vez por telefone em cada estabelecimento, com consentimento separado',async()=>{
  const app=await setup();
  expect((await signup(app,'verde-vivo')).status).toBe(200);
  expect((await signup(app,'sabor-da-terra')).status).toBe(200);
  const rows=(await db.prepare('SELECT tenant_id,name,email,phone,marketing_opt_in,whatsapp_opt_in,signup_source FROM customers WHERE email=? ORDER BY tenant_id').bind('ana@example.com').all<any>()).results;
  expect(rows).toHaveLength(2);
  expect(rows[0].tenant_id).not.toBe(rows[1].tenant_id);
  expect(rows.every(x=>x.marketing_opt_in===1&&x.whatsapp_opt_in===0&&x.signup_source==='popup')).toBe(true);
  expect((await signup(app,'verde-vivo',{...data,name:'Ana das Flores Souza',marketingOptIn:false})).status).toBe(200);
  const tenant=await db.prepare("SELECT id FROM tenants WHERE slug='verde-vivo'").first<any>();
  const {results}=await db.prepare('SELECT name,marketing_opt_in,marketing_consented_at FROM customers WHERE tenant_id=? AND email=?').bind(tenant.id,'ana@example.com').all<any>();
  expect(results).toHaveLength(1);
  expect(results[0].name).toBe('Ana das Flores Souza');
  expect(results[0].marketing_opt_in).toBe(0);
  expect(results[0].marketing_consented_at).toBeNull();
 });
 it('recusa cadastro sem autorização, e-mail inválido e loja desabilitada',async()=>{
  const app=await setup();
  expect((await signup(app,'verde-vivo',{...data,privacyAccepted:false})).status).toBe(400);
  expect((await signup(app,'verde-vivo',{...data,email:'invalido'})).status).toBe(400);
  await db.prepare("UPDATE tenants SET signup_popup_enabled=0 WHERE slug='verde-vivo'").run();
  expect((await signup(app,'verde-vivo')).status).toBe(403);
 });
 it('exige conta do estabelecimento para visualizar lista de clientes cadastrados',async()=>{
  const app=await setup();
  await signup(app,'verde-vivo');
  const unauth=await app.fetch(new Request('http://local/api/admin/customers'));
  expect(unauth.status).toBe(401);
  const login=await app.fetch(new Request('http://local/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'dono@verdevivo.local',password:'CRJornada!Local2026'})}));
  expect(login.status).toBe(200);
  const {token}=await login.json() as any;
  const response=await app.fetch(new Request('http://local/api/admin/customers',{headers:{authorization:'Bearer '+token}}));
  expect(response.status).toBe(200);
  const {customers}=await response.json() as any;
  expect(customers.some((x:any)=>x.email==='ana@example.com')).toBe(true);
  const tenant=await db.prepare("SELECT id FROM tenants WHERE slug='verde-vivo'").first<any>();
  expect(customers.every((x:any)=>x.tenant_id===tenant.id)).toBe(true);
 });
});
