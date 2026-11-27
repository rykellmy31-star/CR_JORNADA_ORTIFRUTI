export type SuggestionCategory={id:string;name:string;is_active?:number|boolean};
export type SuggestionConfig={enabled:boolean;triggerCategoryIds:string[];suggestedCategoryId:string;limit:number};
const normalized=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
export function readSuggestionConfig(raw:unknown,categories:SuggestionCategory[]):SuggestionConfig{
 if(raw!=null&&raw!==''){
  try{const value=typeof raw==='string'?JSON.parse(raw):raw;
   if(validSuggestionConfig(value))return value;
  }catch{}
  return {enabled:false,triggerCategoryIds:[],suggestedCategoryId:'',limit:3};
 }
 const active=categories.filter(c=>c.is_active===undefined||!!c.is_active);
 const triggers=active.filter(c=>/^(pizzas?|lanches?)$/.test(normalized(c.name))).map(c=>c.id);
 const target=active.find(c=>/^bebidas?$/.test(normalized(c.name)))?.id||'';
 return {enabled:!!target&&triggers.length>0,triggerCategoryIds:triggers,suggestedCategoryId:target,limit:3};
}
export function validSuggestionConfig(value:unknown):value is SuggestionConfig{
 if(!value||typeof value!=='object')return false;
 const c=value as SuggestionConfig;
 return typeof c.enabled==='boolean'&&Array.isArray(c.triggerCategoryIds)&&c.triggerCategoryIds.length<=100&&
  c.triggerCategoryIds.every(id=>typeof id==='string'&&id.length>0&&id.length<=120)&&
  typeof c.suggestedCategoryId==='string'&&c.suggestedCategoryId.length<=120&&
  Number.isInteger(c.limit)&&c.limit>=1&&c.limit<=6;
}
type Product={id:string;category_id?:string|null;sale_mode?:string;custom_config_json?:unknown;min_qty?:number;step_qty?:number;is_active?:boolean|number;available?:boolean|number;is_featured?:boolean|number;price_cents?:number};
export function suggestedProducts<T extends Product>(config:SuggestionConfig,categories:SuggestionCategory[],products:T[],cart:{product:Product;quantity:number}[]):T[]{
 const active=new Set(categories.filter(c=>c.is_active===undefined||!!c.is_active).map(c=>c.id));
 if(!config.enabled||!active.has(config.suggestedCategoryId)||!cart.some(l=>l.quantity>0&&config.triggerCategoryIds.includes(l.product.category_id||'')&&active.has(l.product.category_id||''))||
  cart.some(l=>l.quantity>0&&l.product.category_id===config.suggestedCategoryId))return [];
 return products.filter(p=>p.category_id===config.suggestedCategoryId&&p.sale_mode==='unit'&&!p.custom_config_json&&
  (p.is_active===undefined||!!p.is_active)&&(p.available===undefined||!!p.available)&&
  Number(p.min_qty??1)===1&&Number(p.step_qty??1)===1&&Number.isSafeInteger(p.price_cents)&&Number(p.price_cents)>=0)
  .slice(0,config.limit);
}
