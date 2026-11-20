import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {SqliteD1Adapter} from '../src/server/db/sqlite-local';
import {seedDatabase} from '../src/server/seed';
import {createApp} from '../src/server/app';
import {CURATED_FOOD_PHOTOS} from '../src/server/services/curated-food-photos';
import {curatedProductImage,autoProductImage,cachedProductImage,
 suggestProductImages} from '../src/server/services/product-images';
const fakeJpeg=Uint8Array.from([0xff,0xd8,0xff,...Array.from({length:150},()=>0)]);
let db:SqliteD1Adapter,app:any,token:string;
let stored:Map<string,Uint8Array>;
let requests:string[];
const api=(path:string,method='GET',body?:any)=>
 app.fetch(new Request('http://local/api'+path,{
 method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},
 ...(body?{body:JSON.stringify(body)}:{})
 }));
beforeEach(async()=>{
 db=new SqliteD1Adapter(':memory:');db.execMigrations('./migrations');await seedDatabase(db,{});
 stored=new Map();requests=[];
 const media:any={
  putObject:async(key:string,bytes:Uint8Array,mime:string)=>{
   expect(mime).toBe('image/jpeg');stored.set(key,bytes);return {key,publicUrl:'/media/'+key};
  },getObject:async(key:string)=>stored.has(key)?{bytes:stored.get(key)!,contentType:'image/jpeg'}:null
 };
 vi.stubGlobal('fetch',vi.fn(async(input:string)=>{
   const url=String(input);requests.push(url);
   if(url.startsWith('https://raw.githubusercontent.com/fruits-360/'))
    return new Response(fakeJpeg,{status:200,headers:{'content-type':'image/jpeg'}});
   throw Error('External lookup should not occur: '+url);
 }));
 app=createApp({db,media,jwtSecret:'test-secret-'.repeat(4),
   crmApiKey:'test',appEnv:'test',evolution:{}});
 const resp=await app.fetch(new Request('http://local/api/auth/login',{
   method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({email:'dono@verdevivo.local',password:'CRJornada!Local2026'})
 }));
 expect(resp.status).toBe(200);
 token=(await resp.json() as any).token;
});
afterEach(()=>{vi.unstubAllGlobals();db?.close()});
describe('catálogo fotográfico confiável, sem depender da busca externa',()=>{
 it('usa fontes com endereço e licença verificados para frutas e verduras',()=>{
  for(const name of ['abacaxi','melancia','manga','mamão','uva','goiaba','pepino','pimentão','cebola','berinjela','abobrinha']){
   const photo=curatedProductImage(name);
   expect(photo?.source).toBe('curated');
   expect(photo?.imageUrl).toMatch(/^https:\/\/raw\.githubusercontent\.com\/fruits-360\//);
   expect(photo?.licenseName).toBe('CC BY-SA 4.0');
  }
  expect(Object.keys(CURATED_FOOD_PHOTOS).length).toBeGreaterThanOrEqual(70);
  expect(curatedProductImage('produto de fantasia')).toBeNull();
 });
 it('sugere abacaxi sem fazer chamada Wikimedia e sem aviso de imagem não encontrada',async()=>{
  const res=await api('/admin/products/image-suggestions?name=ABACAXI&external=0');
  expect(res.status).toBe(200);
  const data:any=await res.json();
  expect(data.matched).toBe(true);
  expect(data.suggestions[0].source).toBe('curated');
  expect(requests).toHaveLength(0);
 });
 it('cadastra produto sem foto manual, grava no R2 e expõe autoria na vitrine',async()=>{
  const res=await api('/admin/products','POST',{
   name:'Abacaxi',saleMode:'unit',priceCents:399,stockQty:30,minQty:1,stepQty:1
  });
  expect(res.status).toBe(201);
  const data:any=await res.json();
  expect(data.photoSource).toBe('curated');
  expect(data.imageUrl).toMatch(/^\/media\/shared\/products\//);
  expect(stored.size).toBe(1);
  const photo=await cachedProductImage(db,'abacaxi');
  expect(photo?.licenseName).toBe('CC BY-SA 4.0');
  const publicData:any=await (await app.fetch(
    new Request('http://local/api/store/verde-vivo'))).json();
  const visible=publicData.products.find((x:any)=>x.id===data.id);
  expect(visible.image_url).toBe(data.imageUrl);
  expect(visible.photo_author).toContain('Fruits-360');
  expect(visible.photo_license).toBe('CC BY-SA 4.0');
 });
 it('reutiliza a mesma foto por nome, sem novo download e sem compartilhar produtos',async()=>{
  const first=await autoProductImage(db,(app as any).unused||{
   putObject:async(key:string,bytes:Uint8Array)=>{stored.set(key,bytes);return {key,publicUrl:'/media/'+key}}
  } as any,'melancia');
  const second=await suggestProductImages(db,'melancia',false);
  const count=requests.length;
  expect(first.imageUrl).toMatch(/^\/media\/shared\/products\//);
  expect(second[0].imageUrl).toBe(first.imageUrl);
  const next=await autoProductImage(db,{} as any,'melancia');
  expect(next.imageUrl).toBe(first.imageUrl);
  expect(requests.length).toBe(count);
 });
 it('quando o servidor externo falha, retorna foto validada e não mensagem vazia',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response('',{status:503})));
  const photo=await autoProductImage(db,{} as any,'abacaxi');
  expect(photo.source).toBe('curated_direct');
  expect(photo.imageUrl).toBe(curatedProductImage('abacaxi')?.imageUrl);
 });
 it('bloqueia tentativa de importar nome que não existe no acervo',async()=>{
  const res=await api('/admin/products/image-curated','POST',{name:'coisa inventada'});
  expect(res.status).toBe(400);
 });
});
