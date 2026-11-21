const fields=['customerName','phone','street','number','neighborhood','complement','reference'] as const;
export type CheckoutIdentity=Record<typeof fields[number],string>;
export const emptyCheckoutIdentity=():CheckoutIdentity=>({customerName:'',phone:'',street:'',number:'',neighborhood:'',complement:'',reference:''});
const key=(slug:string)=>'crj_checkout_identity_v1:'+slug;
export function loadCheckoutIdentity(slug:string,storage:Storage=localStorage):CheckoutIdentity{
 const empty=emptyCheckoutIdentity();
 try{
  const value=JSON.parse(storage.getItem(key(slug))||'null');
  if(value&&typeof value==='object')for(const field of fields)if(typeof value[field]==='string')empty[field]=value[field];
 }catch{}
 return empty;
}
export function saveCheckoutIdentity(slug:string,data:CheckoutIdentity,storage:Storage=localStorage){
 try{storage.setItem(key(slug),JSON.stringify(Object.fromEntries(fields.map(f=>[f,data[f]]))))}catch{}
}
export function clearCheckoutIdentity(slug:string,storage:Storage=localStorage){
 try{storage.removeItem(key(slug))}catch{}
}
