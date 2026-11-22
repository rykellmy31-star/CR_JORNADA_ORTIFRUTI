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
