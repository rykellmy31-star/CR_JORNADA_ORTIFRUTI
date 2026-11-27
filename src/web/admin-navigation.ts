/** A URL é a fonte da aba atual: atualizar e voltar/avançar preservam a navegação. */
const adminSections=new Set(['dashboard','orders','printing','products','categories','stock','customers','loyalty','reports','whatsapp','settings']);
const whatsAppTabs=new Set(['connection','templates','auto','history']);
export function readAdminSection(params:URLSearchParams):string{
 const section=params.get('aba')||'dashboard';
 return adminSections.has(section)?section:'dashboard';
}
export function adminSectionParams(previous:URLSearchParams,section:string):URLSearchParams{
 const next=new URLSearchParams(previous);
 if(!adminSections.has(section))return next;
 if(section==='dashboard')next.delete('aba');else next.set('aba',section);
 if(section!==readAdminSection(previous))next.delete('subaba');
 return next;
}
export function readWhatsAppTab(params:URLSearchParams):string{
 const tab=params.get('subaba')||'connection';
 return whatsAppTabs.has(tab)?tab:'connection';
}
export function whatsAppTabParams(previous:URLSearchParams,tab:string):URLSearchParams{
 const next=new URLSearchParams(previous);
 if(!whatsAppTabs.has(tab)||readAdminSection(previous)!=='whatsapp')return next;
 if(tab==='connection')next.delete('subaba');else next.set('subaba',tab);
 return next;
}
