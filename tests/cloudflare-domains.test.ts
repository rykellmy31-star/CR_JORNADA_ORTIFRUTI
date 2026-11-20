import {describe,expect,it,vi} from 'vitest';
import {DomainProvisionError,preflightStoreDomain,provisionStoreDomain} from '../src/server/services/cloudflare-domains';

const cfg={enabled:true,accountId:'a'.repeat(32),zoneId:'b'.repeat(32),apiToken:'test-secret-token'.repeat(3)};
const reply=(result:unknown,status=200)=>new Response(JSON.stringify({success:status<400,result}),{
 status,headers:{'Content-Type':'application/json'}
});
describe('provisionamento de Custom Domain sem afetar outros sistemas',()=>{
 it('registra somente hostname exato no Worker Hortifruti via PUT',async()=>{
  const seen:Array<{url:string;method:string;body:any}>=[];
  const mock=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
   const url=String(input);const method=init?.method||'GET';
   seen.push({url,method,body:init?.body?JSON.parse(String(init.body)):null});
   if(url.includes('/workers/domains?'))return reply([]);
   if(url.includes('/dns_records?'))return reply([]);
   if(method==='PUT')return reply({
    id:'domain-1',hostname:'verdurao.crjornada.com',
    service:'cr-jornada-hortifruti',zone_id:cfg.zoneId,enabled:true
   });
   throw Error('unexpected URL');
  }) as unknown as typeof fetch;
  const result=await provisionStoreDomain(cfg,'verdurao',mock);
  expect(result).toEqual({status:'registered',hostname:'verdurao.crjornada.com',
   domainId:'domain-1',alreadyExisted:false});
  const last=seen.at(-1);
  expect(last?.method).toBe('PUT');
  expect(last?.body).toMatchObject({hostname:'verdurao.crjornada.com',
   service:'cr-jornada-hortifruti',zone_id:cfg.zoneId});
  expect(seen.some(x=>x.url.includes('name.exact=verdurao.crjornada.com'))).toBe(true);
 });
 it('nunca transfere domínio de outro Worker, nem chama PUT',async()=>{
  const mock=vi.fn(async()=>reply([{
   id:'worker-old',hostname:'verde.crjornada.com',service:'sistema-fidelidade',
   zone_id:cfg.zoneId
  }])) as unknown as typeof fetch;
  await expect(provisionStoreDomain(cfg,'verde',mock))
   .rejects.toMatchObject({kind:'conflict'});
  expect(mock).toHaveBeenCalledTimes(1);
 });
 it('nunca sobrepõe DNS preexistente',async()=>{
  const mock=vi.fn(async(input:RequestInfo|URL)=>{
   return String(input).includes('/workers/domains?')?reply([]):
    reply([{name:'verdurao.crjornada.com',type:'CNAME'}]);
  }) as unknown as typeof fetch;
  await expect(preflightStoreDomain(cfg,'verdurao',mock))
   .rejects.toMatchObject({kind:'conflict'});
  expect(mock).toHaveBeenCalledTimes(2);
 });
 it('reconcilia o mesmo domínio já conectado sem usar PUT',async()=>{
  const mock=vi.fn(async()=>reply([{id:'existing-id',hostname:'verdurao.crjornada.com',
   service:'cr-jornada-hortifruti',zone_id:cfg.zoneId}])) as unknown as typeof fetch;
  expect(await provisionStoreDomain(cfg,'verdurao',mock)).toMatchObject({
   domainId:'existing-id',alreadyExisted:true
  });
  expect(mock).toHaveBeenCalledTimes(1);
 });
 it('bloqueia a integração desabilitada e nomes reservados',async()=>{
  await expect(provisionStoreDomain({...cfg,enabled:false},'verdurao'))
   .rejects.toMatchObject({kind:'not_configured'});
  await expect(provisionStoreDomain(cfg,'pontos'))
   .rejects.toMatchObject({kind:'conflict'});
 });
});
