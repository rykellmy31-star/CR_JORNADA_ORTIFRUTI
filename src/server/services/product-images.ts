import type {DbClient} from '../db/adapter';
import type {MediaStorageAdapter} from '../storage/r2-media';
import {hasImageSignature} from '../storage/r2-media';
import {generateId} from '../security/crypto';
import {CURATED_FOOD_PHOTOS} from './curated-food-photos';

// Acervo estático existente, sem rede. Variantes conhecidas apontam para foto da espécie.
const builtin:Record<string,string>={
 'abacate':'abacate','alface':'alface','alface crespa':'alface','alface lisa':'alface','alface americana':'alface',
 'banana':'banana','banana prata':'banana','banana nanica':'banana','banana caturra':'banana','banana maca':'banana',
 'batata':'batata-inglesa','batata inglesa':'batata-inglesa','batata doce':'batata-doce',
 'beterraba':'beterraba','cenoura':'cenoura','cheiro verde':'cheiro-verde',
 'laranja':'laranja','laranja pera':'laranja','laranja bahia':'laranja',
 'morango':'morango','ovos':'ovos','ovo':'ovos','ovos caipiras':'ovos',
 'tomate':'tomate','tomate italiano':'tomate','tomate cereja':'tomate'
};
const aliases:Record<string,string>={
 'abacaxi':'pineapple','melancia':'watermelon','melao':'melon','manga':'mango fruit',
 'uva':'grape','cebola':'onion','alho':'garlic','pepino':'cucumber','couve':'kale',
 'repolho':'cabbage','limao':'lime fruit','mandioca':'cassava','abobora':'pumpkin',
 'pimentao':'bell pepper','coco':'coconut','goiaba':'guava','mamao':'papaya',
 'kiwi':'kiwifruit','pera':'pear fruit','maca':'apple fruit','brocolis':'broccoli',
 'vagem':'green beans','rucula':'arugula'
};
export function normalizeProductName(name:string):string{
 return String(name||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ').slice(0,140);
}
export function builtInProductImage(name:string):string|null{
 const key=builtin[normalizeProductName(name)];
 return key?'/images/products/'+key+'.jpg':null;
}
export type PhotoSuggestion={
 imageUrl:string;source:'builtin'|'library'|'wikimedia'|'curated';title:string;
 sourcePageUrl:string|null;licenseName:string|null;licenseUrl:string|null;
 author:string|null;pageId?:number;confidence?:number;
};
type Page={pageid?:number;title?:string;imageinfo?:Array<{
 mime?:string;thumburl?:string;extmetadata?:Record<string,{value?:string}>
}>};
const clean=(s:string)=>s.replace(/<[^>]*>/g,' ').replace(/&amp;/gi,'&')
 .replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/\s+/g,' ').trim().slice(0,170);
function score(title:string,name:string){
 const t=normalizeProductName(title.replace(/^File:/i,'').replace(/\.[a-z0-9]{2,5}$/i,'').replace(/_/g,' '));
 const input=normalizeProductName(name),term=normalizeProductName(aliases[input]||input);
 const matches=(x:string)=>t===x||t.startsWith(x+' ')||t.includes(' '+x+' ');
 if(!matches(term)&&!matches(input))return 0;
 if(/\b(drawing|logo|illustration|diagram|painting|recipe|cooked|cake|poster|icon)\b/.test(t))return 0;
 if(t===term||t===input)return 100;
 if(t.length<=term.length+20)return 80;
 return 45;
}
function parsePage(page:Page,name:string):PhotoSuggestion|null{
 const info=page.imageinfo?.[0],meta=info?.extmetadata;
 if(!page.pageid||!page.title||!info?.thumburl||!meta)return null;
 if(!['image/jpeg','image/png','image/webp'].includes(info.mime||''))return null;
 const license=clean(meta.LicenseShortName?.value||'');
 if(!/^(CC0(?:\s|$)|Public domain(?:\s|$)|CC BY(?:-SA)?(?:\s|$))/i.test(license))return null;
 let image:URL;try{image=new URL(info.thumburl);}catch{return null;}
 if(image.protocol!=='https:'||image.hostname!=='upload.wikimedia.org'||
   !image.pathname.startsWith('/wikipedia/commons/'))return null;
 const confidence=score(page.title,name);
 const link=String(meta.LicenseUrl?.value||'');
 return {
  imageUrl:image.toString(),title:page.title.replace(/^File:/i,'').replace(/_/g,' '),
  source:'wikimedia',sourcePageUrl:'https://commons.wikimedia.org/wiki/'+
    encodeURIComponent(page.title.replace(/ /g,'_')),
  licenseName:license,licenseUrl:link.startsWith('https://')?link:null,
  author:clean(meta.Artist?.value||'')||'Wikimedia Commons',pageId:page.pageid,confidence
 };
}
async function searchCommons(parameters:URLSearchParams):Promise<Page[]>{
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),4000);
 try{
  const resp=await fetch('https://commons.wikimedia.org/w/api.php?'+parameters.toString(),
   {signal:controller.signal,headers:{Accept:'application/json',
    'Api-User-Agent':'CRJornadaHortifruti/2.0 (https://github.com/rykellmy31-star/CR_JORNADA_ORTIFRUTI; pesquisa de fotos de frutas)'}});
  if(!resp.ok)return [];
  const body=await resp.json() as {query?:{pages?:Page[]}};
  return Array.isArray(body.query?.pages)?body.query.pages:[];
 }catch{return [];}finally{clearTimeout(timer);}
}
export async function findCommonsPhotoCandidates(name:string):Promise<PhotoSuggestion[]>{
 if(normalizeProductName(name).length<3)return [];
 const query=new URLSearchParams({action:'query',format:'json',formatversion:'2',
   generator:'search',gsrsearch:aliases[normalizeProductName(name)]||name,
   gsrnamespace:'6',gsrlimit:'12',prop:'imageinfo',
   iiprop:'url|mime|extmetadata',iiurlwidth:'1000'});
 const pages=await searchCommons(query);
 return pages.map(p=>parsePage(p,name)).filter((v):v is PhotoSuggestion=>!!v&&!!v.confidence)
  .sort((a,b)=>(b.confidence||0)-(a.confidence||0)).slice(0,8);
}
/** Fotos reais verificadas no repositório Fruits-360, sem chamada de busca. */
export function curatedProductImage(name:string):PhotoSuggestion|null{
 const key=normalizeProductName(name);
 const item=CURATED_FOOD_PHOTOS[key];
 if(!item)return null;
 return {imageUrl:item.imageUrl,source:'curated',title:name,
  sourcePageUrl:item.sourcePageUrl,licenseName:item.licenseName,
  licenseUrl:item.licenseUrl,author:item.author,confidence:100};
}
/** Importação segura de URL previamente aprovada ao R2 e compartilhamento no D1. */
export async function importCuratedProductImage(db:DbClient,media:MediaStorageAdapter,name:string):Promise<PhotoSuggestion>{
 const key=normalizeProductName(name),item=CURATED_FOOD_PHOTOS[key];
 if(!item)throw new Error('Produto não está no catálogo de imagens verificadas.');
 const existing=await cachedProductImage(db,name);
 if(existing)return existing;
 const url=new URL(item.imageUrl);
 if(url.protocol!=='https:'||url.hostname!=='raw.githubusercontent.com'||
   !url.pathname.startsWith('/fruits-360/'))throw new Error('Origem da foto não autorizada.');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
 let bytes:Uint8Array;
 try{
  const resp=await fetch(url.toString(),{signal:controller.signal,headers:{Accept:'image/jpeg'}});
  if(!resp.ok||Number(resp.headers.get('content-length')||0)>3*1024*1024)
   throw new Error('Foto temporariamente indisponível.');
  bytes=new Uint8Array(await resp.arrayBuffer());
  if(bytes.length<100||bytes.length>3*1024*1024||!hasImageSignature('image/jpeg',bytes))
   throw new Error('Arquivo de foto inválido.');
 }finally{clearTimeout(timer);}
 const stored=await media.putObject('shared/products/'+generateId()+'.jpg',bytes,'image/jpeg');
 const now=new Date().toISOString();
 await db.prepare(`INSERT INTO product_image_library
 (normalized_name,display_name,image_url,source,source_page_url,license_name,license_url,author,created_at,updated_at)
 VALUES(?,?,?,'builtin',?,?,?,?,?,?)
 ON CONFLICT(normalized_name) DO NOTHING`)
 .bind(key,name,stored.publicUrl,item.sourcePageUrl,item.licenseName,item.licenseUrl,item.author,now,now).run();
 return await cachedProductImage(db,name)||{imageUrl:stored.publicUrl,source:'library',
  title:name,sourcePageUrl:item.sourcePageUrl,licenseName:item.licenseName,
  licenseUrl:item.licenseUrl,author:item.author};
}

export async function cachedProductImage(db:DbClient,name:string):Promise<PhotoSuggestion|null>{
 const key=normalizeProductName(name);if(!key)return null;
 const row=await db.prepare('SELECT * FROM product_image_library WHERE normalized_name=?')
  .bind(key).first<Record<string,any>>();
 if(!row)return null;
 return {imageUrl:row.image_url,source:'library',title:row.display_name,
  sourcePageUrl:row.source_page_url||null,licenseName:row.license_name||null,
  licenseUrl:row.license_url||null,author:row.author||null};
}
export async function suggestProductImages(db:DbClient,name:string,external=true){
 const found:PhotoSuggestion[]=[];
 const cached=await cachedProductImage(db,name);
 if(cached)found.push(cached);
 const builtin=builtInProductImage(name);
 if(builtin&&!found.some(s=>s.imageUrl===builtin))
  found.push({imageUrl:builtin,source:'builtin',title:name,
   sourcePageUrl:null,licenseName:null,licenseUrl:null,author:null});
 const curated=curatedProductImage(name);
 if(curated&&!found.some(s=>s.imageUrl===curated.imageUrl))found.push(curated);
 if(external&&!curated&&!builtin&&!cached){
  const candidates=await findCommonsPhotoCandidates(name);
  found.push(...candidates.filter(c=>!found.some(s=>s.imageUrl===c.imageUrl)));
 }
 return found;
}
export async function importCommonsProductImage(
 db:DbClient,media:MediaStorageAdapter,name:string,pageId:number
):Promise<PhotoSuggestion>{
 if(!Number.isSafeInteger(pageId)||pageId<1)throw new Error('Seleção de imagem inválida.');
 const params=new URLSearchParams({action:'query',format:'json',formatversion:'2',
  pageids:String(pageId),prop:'imageinfo',iiprop:'url|mime|extmetadata',iiurlwidth:'1000'});
 const page=(await searchCommons(params)).find(p=>p.pageid===pageId);
 const found=page&&parsePage(page,name);
 if(!found||!found.confidence)throw new Error('Não foi possível confirmar o produto nesta foto.');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),6000);
 let bytes:Uint8Array,contentType:string;
 try{
  const response=await fetch(found.imageUrl,{signal:controller.signal});
  if(!response.ok||Number(response.headers.get('content-length')||0)>4*1024*1024)
   throw new Error('Imagem indisponível ou grande demais.');
  contentType=String(response.headers.get('content-type')||'').split(';')[0].toLowerCase();
  bytes=new Uint8Array(await response.arrayBuffer());
  if(bytes.length>4*1024*1024||!hasImageSignature(contentType,bytes))
   throw new Error('O arquivo de imagem não passou na validação.');
 }finally{clearTimeout(timer);}
 const extension=contentType==='image/jpeg'?'jpg':contentType==='image/png'?'png':
   contentType==='image/webp'?'webp':null;
 if(!extension)throw new Error('Formato de imagem não permitido.');
 const key=normalizeProductName(name);if(!key)throw new Error('Nome de produto inválido.');
 const uploaded=await media.putObject('shared/products/'+generateId()+'.'+extension,bytes,contentType);
 const now=new Date().toISOString();
 await db.prepare('INSERT INTO product_image_library (normalized_name,display_name,image_url,source,'+
  'source_page_url,license_name,license_url,author,created_at,updated_at) '+
  "VALUES(?,?,?,'wikimedia',?,?,?,?,?,?) "+
  'ON CONFLICT(normalized_name) DO UPDATE SET display_name=excluded.display_name,'+
  'image_url=excluded.image_url,source=excluded.source,source_page_url=excluded.source_page_url,'+
  'license_name=excluded.license_name,license_url=excluded.license_url,'+
  'author=excluded.author,updated_at=excluded.updated_at')
 .bind(key,name,uploaded.publicUrl,found.sourcePageUrl,found.licenseName,
  found.licenseUrl,found.author,now,now).run();
 return {...found,imageUrl:uploaded.publicUrl,source:'library'};
}
export async function autoProductImage(
 db:DbClient,media:MediaStorageAdapter,name:string
):Promise<{imageUrl:string|null;source:string}>{
 const shared=await cachedProductImage(db,name);
 if(shared)return {imageUrl:shared.imageUrl,source:'shared'};
 const builtin=builtInProductImage(name);
 if(builtin)return {imageUrl:builtin,source:'builtin'};
 const curated=curatedProductImage(name);
 if(curated){
  try{
   const photo=await importCuratedProductImage(db,media,name);
   return {imageUrl:photo.imageUrl,source:'curated'};
  }catch{
   // URL estática de um arquivo que verificamos existir; não depender do Wikimedia.
   // Ainda pode ser apresentada quando a importação para R2 estiver temporariamente fora.
   return {imageUrl:curated.imageUrl,source:'curated_direct'};
  }
 }
 try{
  const options=await findCommonsPhotoCandidates(name);
  const strong=options.filter(o=>(o.confidence||0)>=80);
  // Várias fotos válidas da mesma fruta podem existir. Escolher a melhor
  // correspondência verificada pelo título, sem confundir produtos diferentes.
  for(const candidate of strong.slice(0,2)){
   try{
    const imported=await importCommonsProductImage(db,media,name,candidate.pageId!);
    return {imageUrl:imported.imageUrl,source:'wikimedia'};
   }catch{/* Tentar a próxima foto compatível. */}
  }
 }catch{/* Não impede cadastro quando a fonte pública está indisponível. */}
 return {imageUrl:null,source:'not_found'};
}
