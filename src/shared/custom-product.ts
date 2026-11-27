import {z} from 'zod';
const id=z.string().min(1).max(80);
const name=z.string().trim().min(1).max(100).regex(/^[^\r\n]+$/);
const option=z.object({id,name,priceCents:z.number().int().min(0).max(10000000),priceByOptionId:z.record(z.string().min(1).max(80),z.number().int().min(0).max(10000000)).optional(),active:z.boolean()});
const group=z.object({id,name,min:z.number().int().min(0).max(30),max:z.number().int().min(1).max(30),priceMode:z.enum(['additional','final']).optional(),kind:z.enum(['choice','included']).optional(),selectionMode:z.enum(['half-and-half']).optional(),options:z.array(option).min(1).max(30)});
export const customConfigSchema=z.object({groups:z.array(group).min(1).max(12),allowNotes:z.boolean(),pizzaModel:z.boolean().optional(),halfAndHalf:z.boolean().optional()}).superRefine((c,ctx)=>{
 const ids=new Set<string>();
 const finalGroups=c.groups.filter(g=>g.priceMode==='final');
 if(finalGroups.length>1)ctx.addIssue({code:'custom',message:'Somente um grupo pode definir o preço final do produto.'});
 const finalGroup=finalGroups[0];
 for(const g of c.groups){
  if(g.selectionMode==='half-and-half'&&(g.kind==='included'||(g.min!==1&&g.min!==2)||g.max!==2))ctx.addIssue({code:'custom',message:'A escolha de sabores deve permitir um ou dois sabores.'});
  if(g.kind==='included'&&(g.selectionMode!==undefined||g.priceMode==='final'||g.min!==0||g.max!==g.options.length||g.options.some(o=>o.priceCents!==0)))ctx.addIssue({code:'custom',message:'Ingredientes inclusos devem ser gratuitos, sem mínimo e todos disponíveis para retirada.'});
  if(g.priceMode==='final'&&(g.min!==1||g.max!==1||g.options.some(o=>o.priceCents<=0)))ctx.addIssue({code:'custom',message:'O grupo de preço final deve ter uma escolha obrigatória e opções com preço maior que zero.'});
  if(ids.has(g.id)||g.min>g.max||g.max>g.options.length)ctx.addIssue({code:'custom',message:'Confira os limites e opções do grupo '+g.name});
  ids.add(g.id);
  for(const o of g.options){if(ids.has(o.id))ctx.addIssue({code:'custom',message:'Identificador de opção duplicado.'});ids.add(o.id);
   if(o.priceByOptionId){if(!finalGroup||g.id===finalGroup.id||Object.keys(o.priceByOptionId).some(key=>!finalGroup.options.some(size=>size.id===key)))ctx.addIssue({code:'custom',message:'Preço por tamanho só pode ser usado em opções de outros grupos e deve apontar para tamanhos existentes.'});}
  }
 }
});
export const customSelectionSchema=z.object({optionIds:z.array(id).max(120),note:z.string().trim().max(300).default(''),flavorMode:z.enum(['single','half-and-half']).optional(),firstFlavorName:z.string().trim().min(1).max(100).optional(),pairedFlavorName:z.string().trim().min(1).max(100).optional(),pairedFlavorPriceCents:z.number().int().min(0).max(10000000).optional()});
export type CustomConfig=z.infer<typeof customConfigSchema>;
export type CustomSelection=z.infer<typeof customSelectionSchema>;
export function readCustomConfig(raw:unknown):CustomConfig|null{
 if(raw==null||raw==='')return null;
 return customConfigSchema.parse(typeof raw==='string'?JSON.parse(raw):raw);
}
/** Compatibilidade com pizzas cadastradas antes da opção independente. */
export function supportsHalfAndHalf(config:CustomConfig|null|undefined):boolean{
 return config?.halfAndHalf??!!config?.groups.some(g=>g.selectionMode==='half-and-half');
}
export function isPizzaConfig(config:CustomConfig|null|undefined,pizzeria=false):boolean{
 return !!config&&(!!config.pizzaModel||config.halfAndHalf!==undefined||supportsHalfAndHalf(config)||
  (pizzeria&&config.groups.some(g=>g.priceMode==='final')));
}
/** Prepara o cadastro da pizza sem grupos de sabores artificiais ou adicionais por tamanho.
 * Aplicado somente à edição/criação; não altera cadastros existentes até salvar.
 */
export function simplifyPizzaConfig(config:CustomConfig,halfAndHalf=supportsHalfAndHalf(config)):CustomConfig{
 const groups=config.groups
  .filter(g=>g.selectionMode!=='half-and-half'&&!(g.kind!=='included'&&/^sabores?$/i.test(g.name.trim())))
  .map(g=>({...g,options:g.options.map(({priceByOptionId,...o})=>o)}));
 return {...config,pizzaModel:true,halfAndHalf,groups};
}
export function customSelectionKey(selection?:CustomSelection|null):string{
 return selection?JSON.stringify([Array.from(new Set(selection.optionIds)).sort(),selection.note.trim(),selection.flavorMode||'',selection.firstFlavorName||'',selection.pairedFlavorName||'']):'';
}
export function resolveCustomSelection(config:CustomConfig,raw:unknown){
 const choice=customSelectionSchema.parse(raw);
 if(supportsHalfAndHalf(config)&&(!choice.flavorMode||!choice.firstFlavorName))throw Error('Escolha se deseja uma pizza de um sabor ou meio a meio.');
 const ids=new Set(choice.optionIds);
 if(ids.size!==choice.optionIds.length)throw Error('Opção repetida.');
 if(!config.allowNotes&&choice.note)throw Error('Este produto não aceita observações.');
 const finalGroup=config.groups.find(g=>g.priceMode==='final');
 const selectedFinalOptionId=finalGroup?.options.find(o=>ids.has(o.id))?.id||null;
 let extrasCents=0;let selectedBaseCents:number|null=null;const details:string[]=[];
 for(const g of config.groups){
  if(g.selectionMode==='half-and-half')continue;
  const selected=g.options.filter(o=>ids.has(o.id));
  if(g.kind==='included'){
   if(selected.some(o=>!o.active))throw Error('Ingrediente indisponível não pode ser retirado.');
   for(const o of selected)ids.delete(o.id);
   const remaining=g.options.filter(o=>o.active&&!selected.includes(o)).map(o=>o.name);
   const removed=selected.map(o=>o.name);
   details.push('Ingredientes inclusos: '+(remaining.join(', ')||'nenhum'));
   if(removed.length)details.push('RETIRAR: '+removed.join(', '));
   continue;
  }
  const min=g.selectionMode==='half-and-half'?1:g.min;
  const max=g.selectionMode==='half-and-half'?1:g.max;
  if(selected.length<min||selected.length>max)throw Error('Selecione '+(min===max?min:'de '+min+' a '+max)+' opção(ões) em '+g.name+'.');
  if(selected.some(o=>!o.active))throw Error('Uma opção de '+g.name+' está indisponível.');
  for(const o of selected){ids.delete(o.id);if(g.priceMode==='final')selectedBaseCents=o.priceCents;}
  if(g.priceMode!=='final')for(const o of selected){const dependent=selectedFinalOptionId&&o.priceByOptionId&&Object.prototype.hasOwnProperty.call(o.priceByOptionId,selectedFinalOptionId)?o.priceByOptionId[selectedFinalOptionId]:o.priceCents;extrasCents+=dependent;}
  if(selected.length)details.push(g.name+': '+selected.map(o=>o.name).join(', '));
 }
 if(ids.size)throw Error('Complemento inválido para este produto.');
 if(choice.pairedFlavorName){details.push('Meio a meio: '+choice.firstFlavorName+' + '+choice.pairedFlavorName);if(choice.pairedFlavorPriceCents!==undefined)selectedBaseCents=Math.max(selectedBaseCents??0,choice.pairedFlavorPriceCents);}else if(choice.firstFlavorName){details.push('Sabor: '+choice.firstFlavorName);}
 if(choice.note)details.push('Observação: '+choice.note.replace(/[\r\n]+/g,' '));
 return {extrasCents,selectedBaseCents,details:details.join('\n')};
}
export function customConfigAvailable(config:CustomConfig){
 return config.groups.every(g=>g.kind==='included'||g.selectionMode==='half-and-half'||g.options.filter(o=>o.active).length>=g.min);
}

/** Uma escolha de preço final substitui o preço base, nunca é somada a ele. */
export function customUnitPrice(baseCents:number,selection:{extrasCents:number;selectedBaseCents:number|null}):number{
 return (selection.selectedBaseCents??baseCents)+selection.extrasCents;
}
/** Menor preço realmente comprável, considerando opções obrigatórias ativas. */
export function minimumCustomPrice(config:CustomConfig,baseCents:number):number{
 const finalGroup=config.groups.find(g=>g.priceMode==='final');
 const costFor=(g:CustomConfig['groups'][number],sizeId:string|null)=>g.options
  .filter(o=>o.active)
  .map(o=>o.priceByOptionId&&sizeId&&Object.prototype.hasOwnProperty.call(o.priceByOptionId,sizeId)?o.priceByOptionId[sizeId]:o.priceCents)
  .sort((a,b)=>a-b)
  .slice(0,g.min)
  .reduce((sum,value)=>sum+value,0);
 if(finalGroup){
  const sizes=finalGroup.options.filter(o=>o.active);
  if(!sizes.length)return baseCents;
  return Math.min(...sizes.map(size=>
   size.priceCents+config.groups
    .filter(g=>g.kind!=='included'&&g.selectionMode!=='half-and-half'&&g.id!==finalGroup.id)
    .reduce((sum,g)=>sum+costFor(g,size.id),0)
  ));
 }
 return baseCents+config.groups
  .filter(g=>g.kind!=='included'&&g.selectionMode!=='half-and-half')
  .reduce((sum,g)=>sum+costFor(g,null),0);
}

/** Valida a quantidade digitada no modal antes de liberar o preço e a ação do rodapé. */
export function isValidCustomQuantityInput(value:string):boolean{
 const normalized=value.trim();
 if(!/^\d+$/.test(normalized))return false;
 const quantity=Number(normalized);
 return Number.isSafeInteger(quantity)&&quantity>=1&&quantity<=99;
}
