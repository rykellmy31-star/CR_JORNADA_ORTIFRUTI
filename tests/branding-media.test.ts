import {afterEach,describe,expect,it} from 'vitest';
import {SqliteD1Adapter} from '../src/server/db/sqlite-local';
import {seedDatabase} from '../src/server/seed';
import {createApp} from '../src/server/app';
import {hasImageSignature,parseDataUriImage} from '../src/server/storage/r2-media';
import {isImageUploadCandidate} from '../src/web/image-upload';

const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4//8/AwAI/AL+Pk7dAAAAAElFTkSuQmCC';
let db:SqliteD1Adapter;
afterEach(()=>db?.close());

describe('imagens da marca e banner na vitrine',()=>{
 it('aceita PNG real, rejeita arquivos falsos ou SVG ativo no servidor',()=>{
   const decoded=parseDataUriImage(png);
   expect(decoded.extension).toBe('png');
   expect(decoded.contentType).toBe('image/png');
   expect(hasImageSignature('image/png',decoded.bytes)).toBe(true);
   const fake='data:image/png;base64,'+btoa('I am not an image');
   expect(()=>parseDataUriImage(fake)).toThrow(/não contém uma imagem válida/);
   const svg='data:image/svg+xml;base64,'+btoa('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
   expect(()=>parseDataUriImage(svg)).toThrow(/não permitido/);
 });
 it('permite escolher formatos de imagem legíveis e rejeita documentos',()=>{
   expect(isImageUploadCandidate({name:'foto.avif',type:'image/avif',size:4000})).toBe(true);
   expect(isImageUploadCandidate({name:'imagem.heic',type:'',size:4000})).toBe(true);
   expect(isImageUploadCandidate({name:'logo.gif',type:'image/gif',size:4000})).toBe(true);
   expect(isImageUploadCandidate({name:'documento.pdf',type:'application/pdf',size:4000})).toBe(false);
   expect(isImageUploadCandidate({name:'arquivo.exe',type:'application/octet-stream',size:4000})).toBe(false);
   expect(isImageUploadCandidate({name:'grande.png',type:'image/png',size:25*1024*1024})).toBe(false);
 });
 it('salva logomarca e banner só para a loja autenticada e expõe imagens na vitrine',async()=>{
   db=new SqliteD1Adapter(':memory:');
   db.execMigrations('./migrations');
   await seedDatabase(db,{});
   const images=new Map<string,{bytes:Uint8Array;contentType:string}>();
   const media:any={
     async putObject(key:string,bytes:Uint8Array,contentType:string){
       images.set(key,{bytes,contentType});return {key,publicUrl:'/media/'+key};
     },
     async getObject(key:string){return images.get(key)||null}
   };
   const app=createApp({db,media,jwtSecret:'test-secret-'.repeat(4),
     crmApiKey:'test',appEnv:'test',evolution:{}});
   const login=await app.fetch(new Request('http://local/api/auth/login',{
     method:'POST',headers:{'content-type':'application/json'},
     body:JSON.stringify({email:'dono@verdevivo.local',password:'CRJornada!Local2026'})
   }));
   expect(login.status).toBe(200);
   const {token}=await login.json() as any;
   const put=async()=>app.fetch(new Request('http://local/api/admin/media/upload',{
     method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},
     body:JSON.stringify({dataUri:png,folder:'branding'})
   }));
   const logoResponse=await put();
   expect(logoResponse.status).toBe(201);
   const logo:any=await logoResponse.json();
   expect(logo.url).toMatch(/^\/media\/tenants\//);
   const banner:any=await (await put()).json();
   const update=await app.fetch(new Request('http://local/api/admin/settings',{
     method:'PATCH',headers:{authorization:'Bearer '+token,'content-type':'application/json'},
     body:JSON.stringify({logoUrl:logo.url,bannerUrl:banner.url})
   }));
   expect(update.status).toBe(200);
   const store:any=await (await app.fetch(new Request('http://local/api/store/verde-vivo'))).json();
   expect(store.store.logo_url).toBe(logo.url);
   expect(store.store.banner_url).toBe(banner.url);
   const other:any=await (await app.fetch(new Request('http://local/api/store/sabor-da-terra'))).json();
   expect(other.store.logo_url).not.toBe(logo.url);
   expect(other.store.banner_url).not.toBe(banner.url);
   const image=await app.fetch(new Request('http://local'+logo.url));
   expect(image.status).toBe(200);
   expect(image.headers.get('content-type')).toBe('image/png');
 });
});
