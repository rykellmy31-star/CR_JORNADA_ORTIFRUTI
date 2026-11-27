import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {SqliteD1Adapter} from '../src/server/db/sqlite-local';
import {seedDatabase} from '../src/server/seed';
import {createApp} from '../src/server/app';
import {
 normalizeProductName,builtInProductImage,autoProductImage,
 cachedProductImage,importCommonsProductImage,findCommonsPhotoCandidates
} from '../src/server/services/product-images';

let db:SqliteD1Adapter,app:any,token:string,media:any;
const stored=new Map<string,{bytes:Uint8Array;contentType:string}>();
const url='http://local/api';
const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4//8/AwAI/AL+Pk7dAAAAAElFTkSuQmCC','base64'));
const api=(path:string,method='GET',data?:any)=>
 app.fetch(new Request(url+path,{method,headers:{Authorization:'Bearer '+token,
  'content-type':'application/json'},...(data?{body:JSON.stringify(data)}:{})}));
beforeEach(async()=>{
 stored.clear();
 db=new SqliteD1Adapter(':memory:');db.execMigrations('./migrations');await seedDatabase(db,{});
 media={
  putObject:async(key:string,bytes:Uint8Array,contentType:string)=>{
   stored.set(key,{bytes,contentType});return {key,publicUrl:'/media/'+key}
  },
  getObject:async(key:string)=>stored.get(key)||null
 };
 app=createApp({db,media,jwtSecret:'test-secret-'.repeat(4),crmApiKey:'test',
  appEnv:'test',evolution:{}});
 const login=await app.fetch(new Request(url+'/auth/login',{method:'POST',
  headers:{'content-type':'application/json'},
  body:JSON.stringify({email:'dono@verdevivo.local',password:'CRJornada!Local2026'})}));
 expect(login.status).toBe(200);
 token=(await login.json() as any).token;
});
afterEach(()=>{vi.unstubAllGlobals();db?.close();});
function commonsPage(){
 return {pageid:321,title:'File:Pineapple fruit.jpg',imageinfo:[{
  mime:'image/png',thumburl:'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1c/Pineapple.png',
  extmetadata:{
   LicenseShortName:{value:'CC BY-SA 4.0'},
   LicenseUrl:{value:'https://creativecommons.org/licenses/by-sa/4.0/'},
   Artist:{value:'<a href="https://commons.wikimedia.org">Fotógrafo Exemplo</a>'}
  }
 }]};
}
function mockCommons(){
 const requests:string[]=[];
 vi.stubGlobal('fetch',vi.fn(async(input:string)=>{
  const u=String(input);requests.push(u);
  if(u.startsWith('https://commons.wikimedia.org/w/api.php')){
   const params=new URL(u).searchParams;
   const page=commonsPage();
   return new Response(JSON.stringify({query:{pages:params.has('pageids')?[page]:[page]}}),{
    status:200,headers:{'Content-Type':'application/json'}
   });
  }
  if(u.startsWith('https://upload.wikimedia.org/')){
   return new Response(png,{status:200,headers:{'Content-Type':'image/png'}});
  }
  throw new Error('Untrusted external host '+u);
 }));
 return requests;
}
describe('fotos automáticas do Hortifruti',()=>{
 it('reconhece nomes e variações do catálogo sem rede',()=>{
  expect(normalizeProductName('  BANANA PRÁTA!  ')).toBe('banana prata');
  expect(builtInProductImage('Banana Prata')).toBe('/images/products/banana.jpg');
  expect(builtInProductImage('TOMATE ITALIANO')).toBe('/images/products/tomate.jpg');
  expect(builtInProductImage('produto desconhecido')).toBeNull();
 });
 it('cadastra produto por kg/unidade com foto automática local, sem pedir upload',async()=>{
  const res=await api('/admin/products','POST',{
   name:'Banana Prata',saleMode:'unit',priceCents:120,stockQty:12,minQty:1,stepQty:1
  });
  expect(res.status).toBe(201);
  const payload:any=await res.json();
  expect(payload.imageUrl).toBe('/images/products/banana.jpg');
  expect(payload.photoSource).toBe('builtin');
  const product=await db.prepare('SELECT image_url FROM products WHERE id=?')
   .bind(payload.id).first<any>();
  expect(product.image_url).toBe('/images/products/banana.jpg');
 });
 it('busca arquivo aberto por nome e valida licença, depois salva uma única foto no R2',async()=>{
  const calls=mockCommons();
  const candidates=await findCommonsPhotoCandidates('Abacaxi');
  expect(candidates).toHaveLength(1);
  expect(candidates[0]).toMatchObject({source:'wikimedia',pageId:321,confidence:80});
  const photo=await importCommonsProductImage(db,media,'Abacaxi',321);
  expect(photo.imageUrl).toMatch(/^\/media\/shared\/products\//);
  expect(stored.size).toBe(1);
  const saved=await cachedProductImage(db,'ABACAXI');
  expect(saved?.imageUrl).toBe(photo.imageUrl);
  expect(saved?.licenseName).toBe('CC BY-SA 4.0');
  expect(saved?.author).toContain('Fotógrafo Exemplo');
  expect(calls.filter(u=>u.includes('upload.wikimedia.org'))).toHaveLength(1);
  const auto=await autoProductImage(db,media,'abacaxi');
  expect(auto.imageUrl).toBe(photo.imageUrl);
  expect(stored.size).toBe(1);
 });
 it('reutiliza foto compartilhada do outro lojista sem reutilizar preços nem clientes',async()=>{
  mockCommons();
  const imported=await importCommonsProductImage(db,media,'Abacaxi',321);
  const owner=await db.prepare("SELECT id FROM tenants WHERE slug='sabor-da-terra'").first<any>();
  const reused=await autoProductImage(db,media,'Abacaxi');
  expect(reused.imageUrl).toBe(imported.imageUrl);
  await db.prepare(`INSERT INTO products(
   id,tenant_id,name,sale_mode,unit_label,price_cents,min_qty,step_qty,image_url,
   physical_qty,reserved_qty,is_active,is_deleted,created_at,updated_at
  ) VALUES(? ,? ,'Abacaxi','unit','un',700,1,1,?,10,0,1,0,?,?)`)
   .bind('test-fruit-in-other-store',owner.id,reused.imageUrl,new Date().toISOString(),new Date().toISOString()).run();
  const one=await db.prepare("SELECT price_cents,tenant_id FROM products WHERE id='test-fruit-in-other-store'").first<any>();
  expect(one.price_cents).toBe(700);
  const storefront:any=await (await app.fetch(new Request(url+'/store/sabor-da-terra'))).json();
  expect(storefront.products.some((p:any)=>p.id==='test-fruit-in-other-store')).toBe(true);
  const visible=storefront.products.find((p:any)=>p.id==='test-fruit-in-other-store');
  expect(visible.photo_license).toBe('CC BY-SA 4.0');
 });
 it('botão de preencher fotos não altera foto manual nem produtos de outro estabelecimento',async()=>{
  const tenant=await db.prepare("SELECT id FROM tenants WHERE slug='verde-vivo'").first<any>();
  const now=new Date().toISOString();
  for(const [id,name,image] of [
   ['without-image','Tomate Italiano',null],
   ['manual-image','Cenoura','/media/tenants/private/custom.jpg']
  ] as any[]){
   await db.prepare(`INSERT INTO products(
    id,tenant_id,name,sale_mode,unit_label,price_cents,min_qty,step_qty,image_url,
    physical_qty,reserved_qty,is_active,is_deleted,created_at,updated_at
   ) VALUES(?,? ,?,'unit','un',400,1,1,?,10,0,1,0,?,?)`)
    .bind(id,tenant.id,name,image,now,now).run();
  }
  const r=await api('/admin/products/images/autofill','POST',{});
  expect(r.status).toBe(200);
  const table=(await db.prepare("SELECT id,image_url FROM products WHERE id IN ('without-image','manual-image')").all<any>()).results;
  expect(table.find((x:any)=>x.id==='without-image')?.image_url).toBe('/images/products/tomate.jpg');
  expect(table.find((x:any)=>x.id==='manual-image')?.image_url).toBe('/media/tenants/private/custom.jpg');
 });
});

 describe('remoção de foto do catálogo',()=>{
 it('remove a foto existente e impede que a busca automática ou preenchimento em lote a restaure',async()=>{
  const created=await api('/admin/products','POST',{name:'Banana Prata',saleMode:'unit',priceCents:200,stockQty:10});
  expect(created.status).toBe(201);
  const {id}=await created.json() as any;
  const saved=await api('/admin/products/'+id,'PATCH',{name:'Banana Prata',imageUrl:null,disableAutoImage:true});
  expect(saved.status).toBe(200);
  const row=()=>db.prepare('SELECT image_url,auto_image_disabled FROM products WHERE id=?').bind(id).first<any>();
  expect(await row()).toMatchObject({image_url:null,auto_image_disabled:1});
  expect((await api('/admin/products/'+id,'PATCH',{name:'Banana Prata'})).status).toBe(200);
  expect((await api('/admin/products/images/autofill','POST',{})).status).toBe(200);
  expect(await row()).toMatchObject({image_url:null,auto_image_disabled:1});
  expect((await api('/admin/products/'+id,'PATCH',{imageUrl:'/images/products/banana.jpg',disableAutoImage:false})).status).toBe(200);
  expect(await row()).toMatchObject({image_url:'/images/products/banana.jpg',auto_image_disabled:0});
 });
 it('permite cadastrar produto comum e produto com variações sem foto',async()=>{
  const simple=await api('/admin/products','POST',{name:'Banana Prata',saleMode:'unit',priceCents:200,stockQty:10,disableAutoImage:true});
  expect(simple.status).toBe(201);
  const variants=await api('/admin/products/with-variants','POST',{name:'Banana Prata',disableAutoImage:true,sharedPool:true,poolPhysicalQty:10,variants:[{name:'Pacote',priceCents:200,deductionQty:1}]});
  expect(variants.status).toBe(201);
  for(const response of [simple,variants]){
   const {id}=await response.json() as any;
   expect(await db.prepare('SELECT image_url,auto_image_disabled FROM products WHERE id=?').bind(id).first()).toMatchObject({image_url:null,auto_image_disabled:1});
  }
 });
});
