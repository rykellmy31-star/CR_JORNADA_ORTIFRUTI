import {z} from 'zod';
const time=z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const daySchema=z.object({enabled:z.boolean(),open:time,close:time});
export const scheduleSchema=z.object({enabled:z.boolean(),days:z.array(daySchema).length(7)}).superRefine((v,ctx)=>{
 for(const d of v.days)if(d.enabled&&d.open===d.close)ctx.addIssue({code:'custom',message:'A abertura deve ser diferente do fechamento.'});
});
export type StoreSchedule=z.infer<typeof scheduleSchema>;
export const WEEKDAYS=['domingo','segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado'];
export const defaultSchedule=():StoreSchedule=>({enabled:false,days:Array.from({length:7},()=>({enabled:false,open:'07:00',close:'19:00'}))});
export function readSchedule(raw:unknown):StoreSchedule{
 if(!raw)return defaultSchedule();
 return scheduleSchema.parse(typeof raw==='string'?JSON.parse(raw):raw);
}

const DAY_LABELS=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'] as const;
const DAY_KEYS=['dom','seg','ter','qua','qui','sex','sab'];
const dayIndex=(value:string):number=>{
 const normalized=value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 return DAY_KEYS.findIndex(day=>normalized.startsWith(day));
};
const normalizeTime=(timeText:string):string|null=>{
 const parts=timeText.match(/^(\d{1,2})(?:h(\d{2})?|:(\d{2}))?$/i);
 if(!parts)return null;
 const hour=Number(parts[1]),minute=Number(parts[2]||parts[3]||'0');
 if(hour>23||minute>59)return null;
 return String(hour).padStart(2,'0')+':'+String(minute).padStart(2,'0');
};
/** Interpreta apenas formatos explícitos: "Seg a Sáb: 07h às 19h • Dom: 07h às 13h". */
export function parseBusinessHours(value:unknown):StoreSchedule|null{
 if(typeof value!=='string'||!value.trim()||value.length>600)return null;
 const input=value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[–—]/g,'-');
 const sections=input.split(/[•·;\n|]+/).map(x=>x.trim()).filter(Boolean);
 if(!sections.length)return null;
 const result=defaultSchedule(),used=new Set<number>();
 const pattern='(\\d{1,2}(?:h\\d{2}|h|:\\d{2})?)';
 const interval=new RegExp('^'+pattern+'\\s*(?:as|a|ate|-)\\s*'+pattern+'
export type StoreStatus={open:boolean;label:string;reason:'open'|'manual'|'schedule';nextOpening:string|null};
export function getStoreStatus(manualOpen:boolean,raw:unknown,now=new Date(),businessHours?:unknown):StoreStatus{
 if(!manualOpen)return {open:false,label:'Fechado no momento',reason:'manual',nextOpening:null};
 let schedule:StoreSchedule;
 try{schedule=effectiveSchedule(raw,businessHours);}catch{return {open:false,label:'Fechado no momento',reason:'schedule',nextOpening:null};}
 if(!schedule.enabled)return {open:true,label:'Aberto agora',reason:'open',nextOpening:null};
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Bahia',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
 const get=(type:string)=>parts.find(p=>p.type===type)?.value||'';
 const day=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(get('weekday'));
 const current=Number(get('hour'))*60+Number(get('minute'));
 const today=schedule.days[day],yesterday=schedule.days[(day+6)%7];
 const active=(d:StoreSchedule['days'][number],m:number)=>d.enabled&&m>=minutes(d.open)&&(minutes(d.close)<minutes(d.open)||m<minutes(d.close));
 if(active(today,current)||(yesterday.enabled&&minutes(yesterday.close)<minutes(yesterday.open)&&current<minutes(yesterday.close)))return {open:true,label:'Aberto agora',reason:'open',nextOpening:null};
 for(let offset=0;offset<=7;offset++){
  const index=(day+offset)%7,d=schedule.days[index];
  if(d.enabled&&(offset>0||minutes(d.open)>current)){
   const nextOpening=(offset===0?'hoje':WEEKDAYS[index])+' às '+d.open;
   return {open:false,label:'Fechado, abriremos '+nextOpening,reason:'schedule',nextOpening};
  }
 }
 return {open:false,label:'Fechado no momento',reason:'schedule',nextOpening:null};
}
);
 for(const section of sections){
  const divider=section.indexOf(':');
  if(divider<0)return null;
  const daysPart=section.slice(0,divider).trim(),hoursPart=section.slice(divider+1).trim();
  const daysMatch=daysPart.match(/^([a-z-]+)(?:\s+(?:a|ate|-)\s+([a-z-]+))?$/);
  if(!daysMatch)return null;
  const first=dayIndex(daysMatch[1]),last=daysMatch[2]?dayIndex(daysMatch[2]):first;
  if(first<0||last<0)return null;
  let hours:{enabled:boolean;open:string;close:string};
  if(/^fechad[oa]$/.test(hoursPart))hours={enabled:false,open:'07:00',close:'19:00'};
  else{
   const match=hoursPart.match(interval);
   if(!match)return null;
   const open=normalizeTime(match[1]),close=normalizeTime(match[2]);
   if(!open||!close||open===close)return null;
   hours={enabled:true,open,close};
  }
  let current=first;
  for(let count=0;count<7;count++){
   if(used.has(current))return null;
   used.add(current);
   result.days[current]={...hours};
   if(current===last)break;
   current=(current+1)%7;
   if(count===6)return null;
  }
 }
 result.enabled=true;
 return result;
}
const readableTime=(text:string)=>{const [h,m]=text.split(':');return h+'h'+(m==='00'?'':m)};
export function formatScheduleHours(schedule:StoreSchedule):string{
 if(!schedule.enabled)return '';
 const segments:string[]=[],days=[1,2,3,4,5,6,0];
 const same=(a:number,b:number)=>{
  const x=schedule.days[a],y=schedule.days[b];
  return x.enabled===y.enabled&&(!x.enabled||(x.open===y.open&&x.close===y.close));
 };
 let begin=0;
 for(let i=1;i<=days.length;i++){
  if(i<days.length&&same(days[i-1],days[i]))continue;
  const first=days[begin],last=days[i-1],label=first===last?DAY_LABELS[first]:DAY_LABELS[first]+' a '+DAY_LABELS[last],d=schedule.days[first];
  segments.push(label+': '+(d.enabled?readableTime(d.open)+' às '+readableTime(d.close):'Fechado'));
  begin=i;
 }
 return segments.join(' • ');
}
/** Agenda detalhada tem prioridade; senão usa os horários já mostrados na vitrine. */
export function effectiveSchedule(raw:unknown,businessHours?:unknown):StoreSchedule{
 const detailed=readSchedule(raw);
 return detailed.enabled?detailed:(parseBusinessHours(businessHours)||detailed);
}

const minutes=(v:string)=>Number(v.slice(0,2))*60+Number(v.slice(3));
export type StoreStatus={open:boolean;label:string;reason:'open'|'manual'|'schedule';nextOpening:string|null};
export function getStoreStatus(manualOpen:boolean,raw:unknown,now=new Date()):StoreStatus{
 if(!manualOpen)return {open:false,label:'Fechado no momento',reason:'manual',nextOpening:null};
 let schedule:StoreSchedule;
 try{schedule=readSchedule(raw);}catch{return {open:false,label:'Fechado no momento',reason:'schedule',nextOpening:null};}
 if(!schedule.enabled)return {open:true,label:'Aberto agora',reason:'open',nextOpening:null};
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Bahia',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
 const get=(type:string)=>parts.find(p=>p.type===type)?.value||'';
 const day=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(get('weekday'));
 const current=Number(get('hour'))*60+Number(get('minute'));
 const today=schedule.days[day],yesterday=schedule.days[(day+6)%7];
 const active=(d:StoreSchedule['days'][number],m:number)=>d.enabled&&m>=minutes(d.open)&&(minutes(d.close)<minutes(d.open)||m<minutes(d.close));
 if(active(today,current)||(yesterday.enabled&&minutes(yesterday.close)<minutes(yesterday.open)&&current<minutes(yesterday.close)))return {open:true,label:'Aberto agora',reason:'open',nextOpening:null};
 for(let offset=0;offset<=7;offset++){
  const index=(day+offset)%7,d=schedule.days[index];
  if(d.enabled&&(offset>0||minutes(d.open)>current)){
   const nextOpening=(offset===0?'hoje':WEEKDAYS[index])+' às '+d.open;
   return {open:false,label:'Fechado, abriremos '+nextOpening,reason:'schedule',nextOpening};
  }
 }
 return {open:false,label:'Fechado no momento',reason:'schedule',nextOpening:null};
}
