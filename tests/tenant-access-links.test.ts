import {afterEach,describe,expect,it} from 'vitest';
import {SqliteD1Adapter} from '../src/server/db/sqlite-local';
import {seedDatabase} from '../src/server/seed';
import {createApp} from '../src/server/app';

let db:SqliteD1Adapter;
const media:any={async putObject(){throw new Error('unused')},async getObject(){return null}};
async function setup(){
 db=new SqliteD1Adapter(':memory:');db.execMigrations('./migrations');
 await seedDatabase(db,{});
 const app=createApp({db,media,jwtSecret:'test-secret-'.repeat(4),crmApiKey:'test-crm-key',appEnv:'test',evolution:{}});
 const res=await app.fetch(new Request('http://local/api/auth/login',{
  method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({email:'admin@crjornada.com.br',password:'CRJornada!Local2026'})
 }));
 expect(res.status).toBe(200);
 const {token}=await res.json() as any;
 return {app,token};
}
afterEach(()=>{try{db?.close()}catch{}});

describe('Super Admin original do Hortifruti com credenciais e links por loja',()=>{
 it('cria uma loja ativa, entrega senha uma vez e permite login sem troca obrigatória',async()=>{
  const {app,token}=await setup();
  const res=await app.fetch(new Request('http://local/api/superadmin/tenants',{
   method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},
   body:JSON.stringify({name:'Verdurão Itanhém',slug:'verdurao-itanhem',ownerName:'Proprietário Teste',
     ownerEmail:'gestor@verduraoteste.example',temporaryPassword:'SenhaInicialSegura2026!',status:'active'})
  }));
  expect(res.status).toBe(201);
  const account=await res.json() as any;
  expect(account.ownerEmail).toBe('gestor@verduraoteste.example');
  expect(account.temporaryPassword).toBe('SenhaInicialSegura2026!');
  expect(account.adminUrl).toBe('https://hortifruti.crjornada.com/admin');
  expect(account.storeUrl).toBe('https://verdurao-itanhem.crjornada.com/');
  const ownerLogin=await app.fetch(new Request('http://local/api/auth/login',{
   method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({email:account.ownerEmail,password:account.temporaryPassword})
  }));
  expect(ownerLogin.status).toBe(200);
  const owner=await ownerLogin.json() as any;
  expect(owner.user.role).toBe('owner');
  expect(owner.user.tenantSlug).toBe('verdurao-itanhem');
  expect(owner).not.toHaveProperty('forcePasswordChange');
  const storefront=await app.fetch(new Request('http://local/api/store/verdurao-itanhem'));
  expect(storefront.status).toBe(200);
  const dbUser=await db.prepare('SELECT password_hash FROM users WHERE tenant_id=?').bind(account.tenantId).first<{password_hash:string}>();
  expect(dbUser?.password_hash).not.toContain(account.temporaryPassword);
 });
 it('gera senha inicial quando não foi informada, sem exigir troca no login',async()=>{
  const {app,token}=await setup();
  const response=await app.fetch(new Request('http://local/api/superadmin/tenants',{
   method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},
   body:JSON.stringify({name:'Hortifruti Exemplo',slug:'hortifruti-exemplo',
    ownerName:'Proprietário Exemplo',ownerEmail:'owner@exemplo.test',
    temporaryPassword:'',status:'active'})
  }));
  expect(response.status).toBe(201);
  const created=await response.json() as any;
  expect(created.temporaryPassword.length).toBeGreaterThanOrEqual(12);
  const login=await app.fetch(new Request('http://local/api/auth/login',{
   method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({email:created.ownerEmail,password:created.temporaryPassword})
  }));
  expect(login.status).toBe(200);
 });
 it('não aceita utilizar subdomínio de outro serviço da CR Jornada',async()=>{
  const {app,token}=await setup();
  const res=await app.fetch(new Request('http://local/api/superadmin/tenants',{
   method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},
   body:JSON.stringify({name:'Loja Teste',slug:'pontos',ownerName:'Proprietário Teste',
    ownerEmail:'owner@example.test',status:'active'})
  }));
  expect(res.status).toBe(400);
  expect((await res.json() as any).error).toMatch(/reservado/);
 });
});
