import {z} from 'zod';
const id=z.string().min(1).max(80);
const name=z.string().trim().min(1).max(100).regex(/^[^\r\n]+$/);
const option=z.object({id,name,priceCents:z.number().int().min(0).max(10000000),active:z.boolean()});
const group=z.object({id,name,min:z.number().int().min(0).max(30),max:z.number().int().min(1).max(30),options:z.array(option).min(1).max(30)});
export const customConfigSchema=z.object({groups:z.array(group).min(1).max(12),allowNotes:z.boolean()}).superRefine((c,ctx)=>{
 const ids=new Set<string>();
 for(const g of c.groups){
  if(ids.has(g.id)||g.min>g.max||g.max>g.options.length)ctx.addIssue({code:'custom',message:'Confira os limites e opções do grupo '+g.name});
  ids.add(g.id);
  for(const o of g.options){if(ids.has(o.id))ctx.addIssue({code:'custom',message:'Identificador de opção duplicado.'});ids.add(o.id);}
 }
});
export const customSelectionSchema=z.object({optionIds:z.array(id).max(120),note:z.string().trim().max(300).default('')});
export type CustomConfig=z.infer<typeof customConfigSchema>;
export type CustomSelection=z.infer<typeof customSelectionSchema>;
export function readCustomConfig(raw:unknown):CustomConfig|null{
 if(raw==null||raw==='')return null;
 return customConfigSchema.parse(typeof raw==='string'?JSON.parse(raw):raw);
}
export function customSelectionKey(selection?:CustomSelection|null):string{
 return selection?JSON.stringify([Array.from(new Set(selection.optionIds)).sort(),selection.note.trim()]):'';
}
export function resolveCustomSelection(config:CustomConfig,raw:unknown){
 const choice=customSelectionSchema.parse(raw);
 const ids=new Set(choice.optionIds);
 if(ids.size!==choice.optionIds.length)throw Error('Opção repetida.');
 if(!config.allowNotes&&choice.note)throw Error('Este produto não aceita observações.');
 let extrasCents=0;const details:string[]=[];
 for(const g of config.groups){
  const selected=g.options.filter(o=>ids.has(o.id));
  if(selected.length<g.min||selected.length>g.max)throw Error('Selecione de '+g.min+' a '+g.max+' opção(ões) em '+g.name+'.');
  if(selected.some(o=>!o.active))throw Error('Uma opção de '+g.name+' está indisponível.');
  for(const o of selected){ids.delete(o.id);extrasCents+=o.priceCents;}
  if(selected.length)details.push(g.name+': '+selected.map(o=>o.name).join(', '));
 }
 if(ids.size)throw Error('Complemento inválido para este produto.');
 if(choice.note)details.push('Observação: '+choice.note.replace(/[\r\n]+/g,' '));
 return {extrasCents,details:details.join('\n')};
}
export function customConfigAvailable(config:CustomConfig){
 return config.groups.every(g=>g.options.filter(o=>o.active).length>=g.min);
}
