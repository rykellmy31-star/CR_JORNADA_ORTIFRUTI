/** Identificação de vitrines sem consumir subdomínios de serviços da CR Jornada. */
export const RESERVED_CRJ_SUBDOMAINS=new Set([
 'admin','api','www','pontos','fidelidade','farmacia','evolution',
 'site','hortifruti','hortifruti-admin','tigu','mail','ftp',
 'agendamentos','crbot','gestor','promoml','bot','painel','suporte'
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
export const HORTIFRUTI_SUPERADMIN_HOST='hortifruti-admin.crjornada.com';
export const HORTIFRUTI_ADMIN_HOST='hortifruti.crjornada.com';
export const HORTIFRUTI_SUPERADMIN_URL='https://'+HORTIFRUTI_SUPERADMIN_HOST;
export const HORTIFRUTI_ADMIN_URL='https://'+HORTIFRUTI_ADMIN_HOST+'/admin';

/** Páginas iniciais próprias, sem alterar URLs legadas ou a CR Jornada geral. */
export function hortifrutiHomeRoute(hostname:string):'/superadmin'|'/admin'|null {
 const host=hostname.toLowerCase().replace(/\.$/,'');
 if(host===HORTIFRUTI_SUPERADMIN_HOST)return '/superadmin';
 if(host===HORTIFRUTI_ADMIN_HOST)return '/admin';
 return null;
}

export function storeHomeUrl(slug:string):string{
 return isValidStoreSubdomain(slug)
  ? 'https://'+slug+'.crjornada.com/' : '/loja/'+encodeURIComponent(slug);
}
