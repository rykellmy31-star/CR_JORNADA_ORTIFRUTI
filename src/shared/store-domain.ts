/** Identificação de vitrines sem consumir subdomínios de serviços da CR Jornada. */
export const RESERVED_CRJ_SUBDOMAINS=new Set([
 'admin','api','www','pontos','fidelidade','farmacia','evolution',
 'site','hortifruti','hortifruti-admin','tigu','mail','ftp'
]);
export function isValidStoreSubdomain(slug:string):boolean{
 return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
  && slug.length<=80 && slug.length>=2 && !RESERVED_CRJ_SUBDOMAINS.has(slug);
}
export function vanityStoreSlug(hostname:string):string|null {
 const host=hostname.toLowerCase().replace(/\.$/,'');
 const suffix='.crjornada.com';
 if(!host.endsWith(suffix))return null;
 const slug=host.slice(0,-suffix.length);
 return isValidStoreSubdomain(slug)?slug:null;
}
export function storeHomeUrl(slug:string):string{
 return isValidStoreSubdomain(slug)
  ? 'https://'+slug+'.crjornada.com/' : '/loja/'+encodeURIComponent(slug);
}
