import type {DbClient} from '../db/adapter';
import {generateId} from '../security/crypto';

export const PRINT_LEASE_SECONDS=300;
export const PRINT_MAX_ATTEMPTS=5;

export function randomSecret(byteLength=32):string{
 const bytes=crypto.getRandomValues(new Uint8Array(byteLength));
 return Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
}

export function pairingCode():string{
 const raw=randomSecret(8).toUpperCase(); // 64 bits. Formato XXXX-XXXX-XXXX-XXXX
 return raw.match(/.{4}/g)!.join('-');
}
export function normalizePairingCode(value:string):string{
 return value.replace(/[^A-F0-9]/gi,'').toUpperCase();
}
export async function hashSecret(value:string):Promise<string>{
 const bytes=new TextEncoder().encode(value);
 const sum=await crypto.subtle.digest('SHA-256',bytes);
 return Array.from(new Uint8Array(sum),x=>x.toString(16).padStart(2,'0')).join('');
}
export async function hashPairingCode(tenantId:string,code:string,serverSecret:string):Promise<string>{
 return hashSecret('crx-print-pair:v1:'+tenantId+':'+normalizePairingCode(code)+':'+serverSecret);
}
function money(value:number):string{
 return 'R$ '+(Math.round(Number(value||0))/100).toFixed(2).replace('.',',');
}
const clean=(value:unknown):string=>String(value??'').replace(/[\r\n\t]+/g,' ').replace(/\s+/g,' ').trim();
function wrap(text:string,width=32):string[]{
 const words=clean(text).split(' ');const lines:string[]=[];let line='';
 for(const word of words){
  if(!word)continue;
  if(line&&line.length+1+word.length>width){lines.push(line);line='';}
  if(word.length>width){if(line){lines.push(line);line='';}
   for(let i=0;i<word.length;i+=width){const part=word.slice(i,i+width);if(part.length===width)lines.push(part);else line=part;}
  }else line=line?line+' '+word:word;
 }
 if(line)lines.push(line);
 return lines.length?lines:[''];
}
function moneyRow(left:string,right:string):string{
 const size=32;
 const value=clean(right),label=clean(left);
 const maxLabel=Math.max(1,size-value.length-1);
 return label.slice(0,maxLabel).padEnd(size-value.length,' ')+value;
}
export function formatPrintReceipt(
 shopName:string,order:Record<string,any>,items:Array<Record<string,any>>
):string{
 const time=new Date(order.created_at);
 const when=Number.isNaN(time.valueOf())?'':time.toLocaleString('pt-BR',{timeZone:'America/Bahia'});
 const payment:Record<string,string>={cash:'Dinheiro',pix_delivery:'Pix na entrega',
  debit_card:'Debito na entrega',credit_card:'Credito na entrega'};
 const lines=[
  ...wrap(clean(shopName).toUpperCase()),'COMANDA DE PEDIDO',
  '#'+order.order_number,when,'--------------------------------',
  'CLIENTE: '+clean(order.customer_name),
  'TELEFONE: '+clean(order.customer_phone),
  'ENDERECO:',
  ...wrap([order.address_street,order.address_number].filter(Boolean).join(', ')),
  ...wrap(order.address_neighborhood),
 ];
 for(const field of [order.address_complement,order.address_reference]){
  if(clean(field))lines.push(...wrap(field));
 }
 lines.push('--------------------------------','PRODUTOS');
 for(const item of items){
  const title=clean(item.product_name_snapshot)+(item.variant_name_snapshot?' - '+clean(item.variant_name_snapshot):'');
  lines.push(...wrap(title));
  lines.push(moneyRow(clean(item.quantity_display),money(item.line_total_cents)));
  if(item.customization_snapshot)for(const detail of String(item.customization_snapshot).split('\n'))lines.push(...wrap(detail));
 }
 lines.push('--------------------------------',
  moneyRow('SUBTOTAL',money(order.subtotal_cents)),
  moneyRow('ENTREGA',money(order.delivery_fee_cents)),
  moneyRow('TOTAL',money(order.total_cents)),
  'Pagamento: '+(payment[order.payment_method]||clean(order.payment_method)));
 if(order.needs_change)lines.push(
  'Troco para: '+money(order.change_for_cents),
  'Troco: '+money(order.change_amount_cents)
 );
 if(clean(order.notes))lines.push('OBS:',...wrap(order.notes));
 lines.push('--------------------------------','SEPARACAO - NAO FISCAL');
 return lines.join('\n')+'\n';
}
export type AuthorizedPrintDevice={
 id:string;tenant_id:string;name:string;last_seen_at:string|null;
};
export async function authenticatePrintDevice(db:DbClient,authHeader:string):Promise<AuthorizedPrintDevice|null>{
 const token=authHeader.match(/^Bearer\s+(\w+)$/i)?.[1]||'';
 if(!/^[a-f0-9]{64}$/.test(token))return null;
 const tokenHash=await hashSecret(token);
 return db.prepare(`SELECT d.id,d.tenant_id,d.name,d.last_seen_at
  FROM print_devices d INNER JOIN tenants t ON t.id=d.tenant_id
  WHERE d.token_hash=? AND d.revoked_at IS NULL AND t.status='active'`)
  .bind(tokenHash).first<AuthorizedPrintDevice>();
}
export async function updatePrintDeviceHeartbeat(db:DbClient,device:AuthorizedPrintDevice):Promise<void>{
 const now=new Date().toISOString();
 await db.prepare('UPDATE print_devices SET last_seen_at=?,updated_at=? WHERE id=? AND tenant_id=? AND revoked_at IS NULL')
  .bind(now,now,device.id,device.tenant_id).run();
}
export async function claimNextPrintJob(db:DbClient,device:AuthorizedPrintDevice){
 const now=new Date(),current=now.toISOString(),until=new Date(now.getTime()+PRINT_LEASE_SECONDS*1000).toISOString();
 // Limpa leases expirados que já consumiram o limite. Não aciona impressão retroativa.
 await db.prepare(`UPDATE print_jobs SET status='failed',last_error='Limite de tentativas esgotado',
  lease_token_hash=NULL,lease_expires_at=NULL,leased_by_device_id=NULL,updated_at=?
  WHERE tenant_id=? AND status='leased' AND lease_expires_at<=? AND attempts>=?`)
  .bind(current,device.tenant_id,current,PRINT_MAX_ATTEMPTS).run();
 const leaseToken=randomSecret(24);
 const leaseHash=await hashSecret(leaseToken);
 const claimed=await db.prepare(`UPDATE print_jobs SET
   status='leased', leased_by_device_id=?,lease_token_hash=?,lease_expires_at=?,
   attempts=attempts+1,updated_at=?,last_error=NULL
  WHERE id=(
   SELECT j.id FROM print_jobs j
   JOIN orders o ON o.id=j.order_id AND o.tenant_id=j.tenant_id
   JOIN tenants t ON t.id=j.tenant_id
   WHERE j.tenant_id=? AND t.auto_print_enabled=1
    AND o.status!='cancelled' AND o.deleted_at IS NULL AND j.attempts<?
    AND (j.status='queued' OR (j.status='leased' AND j.lease_expires_at<=?))
   ORDER BY j.created_at,j.id LIMIT 1
  )
  RETURNING id,order_id,order_number,job_type,created_at`)
  .bind(device.id,leaseHash,until,current,device.tenant_id,PRINT_MAX_ATTEMPTS,current)
  .first<{id:string;order_id:string;order_number:number;job_type:string;created_at:string}>();
 if(!claimed)return null;
 const order=await db.prepare(`SELECT o.*,t.name AS store_name FROM orders o
  JOIN tenants t ON t.id=o.tenant_id
  WHERE o.id=? AND o.tenant_id=? AND o.deleted_at IS NULL AND o.status!='cancelled'`)
  .bind(claimed.order_id,device.tenant_id).first<Record<string,any>>();
 if(!order)return null; // Exclusão concorrente: lease expira e pedido cancelado não é reimpresso.
 const {results:items}=await db.prepare(`SELECT product_name_snapshot,variant_name_snapshot,
  quantity_display,line_total_cents,customization_snapshot FROM order_items WHERE order_id=? AND tenant_id=? ORDER BY rowid`)
  .bind(claimed.order_id,device.tenant_id).all<Record<string,any>>();
 return {
  id:claimed.id,orderNumber:claimed.order_number,jobType:claimed.job_type,
  receiptText:formatPrintReceipt(order.store_name,order,items),leaseToken,leaseExpiresAt:until,
  createdAt:claimed.created_at
 };
}
export async function acknowledgePrintJob(
 db:DbClient,device:AuthorizedPrintDevice,jobId:string,leaseToken:string,success:boolean,error?:string
):Promise<'printed'|'queued'|'failed'|null>{
 if(!/^[a-f0-9]{48}$/.test(leaseToken))return null;
 const leaseHash=await hashSecret(leaseToken),now=new Date().toISOString();
 const row=await db.prepare(`SELECT attempts FROM print_jobs
  WHERE id=? AND tenant_id=? AND leased_by_device_id=? AND lease_token_hash=?
   AND status='leased'`)
  .bind(jobId,device.tenant_id,device.id,leaseHash).first<{attempts:number}>();
 if(!row)return null;
 const status=success?'printed':row.attempts>=PRINT_MAX_ATTEMPTS?'failed':'queued';
 const errorText=success?null:clean(error||'Falha de impressao no Android').slice(0,200);
 const result=await db.prepare(`UPDATE print_jobs SET status=?,last_error=?,
  printed_at=?,leased_by_device_id=NULL,lease_token_hash=NULL,lease_expires_at=NULL,updated_at=?
  WHERE id=? AND tenant_id=? AND leased_by_device_id=? AND lease_token_hash=? AND status='leased'`)
  .bind(status,errorText,success?now:null,now,jobId,device.tenant_id,device.id,leaseHash).run();
 return result.meta.changes===1?status:null;
}
