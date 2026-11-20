import {isValidStoreSubdomain} from '../../shared/store-domain';

/**
 * Gestão de DOMÍNIOS PERSONALIZADOS do próprio Worker Hortifruti.
 * Endpoint FIXO e hostname somente de slug validado; sem URL controlada pelo usuário.
 * Não apaga, transfere ou modifica um domínio que já pertença a outro projeto.
 */
export interface CloudflareDomainsConfig {
 enabled?:boolean;
 accountId?:string;
 zoneId?:string;
 apiToken?:string;
}
export type DomainProvisionResult={status:'registered';hostname:string;domainId:string|null;alreadyExisted:boolean};
export class DomainProvisionError extends Error {
 constructor(public readonly kind:'not_configured'|'conflict'|'unavailable'){
  super(kind==='not_configured'?'Cadastro automático de domínios ainda não configurado na Cloudflare.':
    kind==='conflict'?'Este subdomínio já está em uso na Cloudflare. Escolha outro nome.':
    'Não foi possível confirmar o domínio com a Cloudflare. Tente novamente no Super Admin.');
 }
}

const SERVICE='cr-jornada-hortifruti';
const ZONE='crjornada.com';
const API='https://api.cloudflare.com/client/v4';
const HEX32=/^[0-9a-f]{32}$/i;

export function domainAutoConfigured(config:CloudflareDomainsConfig):boolean {
 return config.enabled===true && HEX32.test(config.accountId||'') &&
  HEX32.test(config.zoneId||'') && typeof config.apiToken==='string' &&
  config.apiToken.length>=24;
}
function hostnameFor(slug:string):string {
 if(!isValidStoreSubdomain(slug))throw new DomainProvisionError('conflict');
 return slug+'.'+ZONE;
}
type DomainRow={id:string;hostname:string;service:string;zone_id:string;enabled?:boolean};
type ApiEnvelope<T>={success:boolean;result:T;errors?:Array<{message?:string}>;result_info?:{total_pages?:number;total_count?:number}};
async function cfRequest<T>(config:CloudflareDomainsConfig,path:string,method:'GET'|'PUT'='GET',body?:unknown,
 fetcher:typeof fetch=fetch):Promise<ApiEnvelope<T>>{
 let response:Response;
 try{
  response=await fetcher(API+path,{
   method,headers:{Authorization:'Bearer '+config.apiToken,
    'Content-Type':'application/json','Cache-Control':'no-store'},
   body:body===undefined?undefined:JSON.stringify(body),
   signal:AbortSignal.timeout(12000)
  });
 }catch{throw new DomainProvisionError('unavailable');}
 // Respostas de erro da Cloudflare não são encaminhadas integralmente ao navegador.
 if(!response.ok)throw new DomainProvisionError(response.status===409?'conflict':'unavailable');
 const size=Number(response.headers.get('content-length')||'0');
 if(size>32768)throw new DomainProvisionError('unavailable');
 let raw='';
 try{raw=await response.text();}catch{throw new DomainProvisionError('unavailable');}
 if(raw.length>32768)throw new DomainProvisionError('unavailable');
 let parsed:ApiEnvelope<T>;
 try{parsed=JSON.parse(raw);}catch{throw new DomainProvisionError('unavailable');}
 if(!parsed || parsed.success!==true)throw new DomainProvisionError('unavailable');
 return parsed;
}

export async function preflightStoreDomain(config:CloudflareDomainsConfig,slug:string,
 fetcher:typeof fetch=fetch):Promise<{hostname:string;current?:DomainRow}> {
 if(!domainAutoConfigured(config))throw new DomainProvisionError('not_configured');
 const hostname=hostnameFor(slug);
 // Só um resultado exato; se existir outro Worker, não fazemos PUT (que transferiria domínio).
 const domainReply=await cfRequest<DomainRow[]>(config,
  '/accounts/'+config.accountId+'/workers/domains?hostname='+encodeURIComponent(hostname), 'GET',undefined,fetcher);
 if(!Array.isArray(domainReply.result))throw new DomainProvisionError('unavailable');
 const domain=domainReply.result.find(x=>x.hostname?.toLowerCase()===hostname);
 if(domain){
  if(domain.service!==SERVICE||domain.zone_id!==config.zoneId)throw new DomainProvisionError('conflict');
  return {hostname,current:domain};
 }
 // Uma outra entrada DNS não gerenciada pelo Hortifruti NUNCA pode ser substituída.
 // name.exact evita que "loja" encontre "outra-loja".
 const dnsReply=await cfRequest<Array<{name:string;type:string}>>(config,
  '/zones/'+config.zoneId+'/dns_records?name.exact='+encodeURIComponent(hostname)+'&per_page=100','GET',undefined,fetcher);
 if(!Array.isArray(dnsReply.result))throw new DomainProvisionError('unavailable');
 if(dnsReply.result.some(x=>x.name?.toLowerCase()===hostname))
  throw new DomainProvisionError('conflict');
 return {hostname};
}

export async function provisionStoreDomain(config:CloudflareDomainsConfig,slug:string,
 fetcher:typeof fetch=fetch):Promise<DomainProvisionResult>{
 const {hostname,current}=await preflightStoreDomain(config,slug,fetcher);
 if(current){
  return {status:'registered',hostname,domainId:current.id,alreadyExisted:true};
 }
 const reply=await cfRequest<DomainRow>(config,'/accounts/'+config.accountId+'/workers/domains','PUT',{
  hostname,service:SERVICE,enabled:true,zone_id:config.zoneId,zone_name:ZONE
 },fetcher);
 if(!reply.result||reply.result.hostname!==hostname||
    reply.result.service!==SERVICE||reply.result.zone_id!==config.zoneId)
  throw new DomainProvisionError('unavailable');
 return {status:'registered',hostname,domainId:reply.result.id||null,alreadyExisted:false};
}
