export type SharePlatform={
 share?:(data:{title:string;text:string;url:string})=>Promise<void>;
 clipboard?:{writeText:(text:string)=>Promise<void>};
};
export type ShareOutcome='shared'|'copied'|'cancelled'|'manual';
/** Compartilha só o endereço da vitrine, sem códigos de rastreamento, buscas ou âncoras. */
export function storeShareUrl(location:{origin:string;pathname:string}):string{
 return location.origin+location.pathname;
}
export async function shareStore(platform:SharePlatform,storeName:string,url:string):Promise<ShareOutcome>{
 if(platform.share){
  try{
   await platform.share({title:storeName,text:'Conheça a loja '+storeName+'! Confira os produtos e ofertas.',url});
   return 'shared';
  }catch(error){
   if(error&&typeof error==='object'&&'name' in error&&error.name==='AbortError')return 'cancelled';
   // Navegador recusou o compartilhamento: tentar copiar o link.
  }
 }
 if(platform.clipboard){
  try{await platform.clipboard.writeText(url);return 'copied';}catch{}
 }
 return 'manual';
}
