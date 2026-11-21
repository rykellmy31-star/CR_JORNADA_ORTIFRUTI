import {afterEach,describe,expect,it} from 'vitest';
import {SqliteD1Adapter} from '../src/server/db/sqlite-local';
import {seedDatabase} from '../src/server/seed';
import {createApp} from '../src/server/app';

const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4//8/AwAI/AL+Pk7dAAAAAElFTkSuQmCC';
let db:SqliteD1Adapter;
afterEach(()=>db?.close());

describe('banners por estabelecimento',()=>{
 it('permite carrossel ordenado, imagem para celular e bloqueia imagens de outro tenant',async()=>{
  db=new SqliteD1Adapter(':memory:');
  db.execMigrations('./migrations');
  await seedDatabase(db,{});
  const objects=new Map<string,{bytes:Uint8Array;contentType:string}>();
  const media:any={
   async putObject(key:string,bytes:Uint8Array,contentType:string){
    objects.set(key,{bytes,contentType});return {key,publicUrl:'/media/'+key};
   },
   async getObject(key:string){return objects.get(key)||null}
  };
  const app=createApp({db,media,jwtSecret:'test-secret-'.repeat(4),crmApiKey:'test',appEnv:'test',evolution:{}});
  const login=await app.fetch(new Request('http://local/api/auth/login',{
   method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({email:'dono@verdevivo.local',password:'CRJornada!Local2026'})
  }));
  expect(login.status).toBe(200);
  const {token}=await login.json() as any;
  const request=(path:string,method='GET',body?:any)=>app.fetch(new Request('http://local/api/'+path,{
   method,headers:{authorization:'Bearer '+token,...(body===undefined?{}:{'content-type':'application/json'})},
   body:body===undefined?undefined:JSON.stringify(body)
  }));
  const upload=async()=>{
   const response=await request('admin/media/upload','POST',{dataUri:png,folder:'banners'});
   expect(response.status).toBe(201);
   return (await response.json() as any).url as string;
  };
  const first=await upload(),second=await upload(),mobile=await upload();
  const ownTenantId=first.split('/')[3];
  const cross=await request('admin/banners','POST',{imageUrl:first.replace(ownTenantId,'another-tenant')});
  expect(cross.status).toBe(400);
  const a=await request('admin/banners','POST',{imageUrl:first,mobileImageUrl:mobile});
  expect(a.status).toBe(201);
  const idA=(await a.json() as any).id as string;
  const b=await request('admin/banners','POST',{imageUrl:second});
  expect(b.status).toBe(201);
  const idB=(await b.json() as any).id as string;
  let storefront:any=await (await app.fetch(new Request('http://local/api/store/verde-vivo'))).json();
  expect(storefront.banners.map((x:any)=>x.id)).toEqual([idA,idB]);
  expect(storefront.banners[0].mobile_image_url).toBe(mobile);
  const other:any=await (await app.fetch(new Request('http://local/api/store/sabor-da-terra'))).json();
  expect(other.banners).toEqual([]);
  expect((await request('admin/banners/'+idB,'PATCH',{direction:'up'})).status).toBe(200);
  storefront=await (await app.fetch(new Request('http://local/api/store/verde-vivo'))).json();
  expect(storefront.banners.map((x:any)=>x.id)).toEqual([idB,idA]);
  expect((await request('admin/banners/'+idB,'PATCH',{active:false})).status).toBe(200);
  storefront=await (await app.fetch(new Request('http://local/api/store/verde-vivo'))).json();
  expect(storefront.banners.map((x:any)=>x.id)).toEqual([idA]);
  expect((await request('admin/banners/'+idA,'PATCH',{mobileImageUrl:null})).status).toBe(200);
  expect((await request('admin/banners/'+idA,'DELETE')).status).toBe(200);
  expect((await request('admin/banners/'+idA,'DELETE')).status).toBe(404);
 });
});
