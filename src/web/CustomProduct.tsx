import {useState} from 'react';
import {createPortal} from 'react-dom';
import {Plus,X,Trash2} from 'lucide-react';
import {formatBRL} from '../shared/pricing';
import {readCustomConfig,resolveCustomSelection,type CustomConfig,type CustomSelection} from '../shared/custom-product';
const uid=()=>crypto.randomUUID();
const makeOption=(name='',priceCents=0)=>({id:uid(),name,priceCents,active:true});
const makeGroup=(name='',min=0,max=1,options=[makeOption()])=>({id:uid(),name,min,max,options});
export const newCustomConfig=():CustomConfig=>({allowNotes:true,groups:[
 makeGroup('Tamanho',1,1,[makeOption('Pequena'),makeOption('Média',500),makeOption('Grande',1000)]),
 makeGroup('Proteína',1,1,[makeOption('Frango'),makeOption('Carne')]),
 makeGroup('Acompanhamentos',0,3,[makeOption('Arroz'),makeOption('Feijão'),makeOption('Salada')]),
 makeGroup('Adicionais',0,1,[makeOption('Ovo frito',200)]),
]});
type Group=CustomConfig['groups'][number];
export function CustomConfigEditor({value,onChange}:{value:CustomConfig;onChange:(v:CustomConfig)=>void}){
 const update=(index:number,change:Partial<Group>)=>onChange({...value,groups:value.groups.map((g,i)=>i===index?{...g,...change}:g)});
 return <section className="custom-config-editor">
  <h3>Complementos e escolhas</h3><small>O preço base é o menor preço da marmita. Configure valores adicionais, limites e disponibilidade. Use um grupo opcional "Retirar ingredientes" para opções como Sem cebola.</small>
  {value.groups.map((g,i)=><div key={g.id} className="custom-config-group">
   <div className="custom-config-row"><label>Nome do grupo<input required maxLength={100} value={g.name} onChange={e=>update(i,{name:e.target.value})}/></label><button type="button" className="icon-btn" aria-label="Excluir grupo" onClick={()=>onChange({...value,groups:value.groups.filter(x=>x.id!==g.id)})}><Trash2 size={16}/></button></div>
   <div className="custom-config-row"><label>Mínimo (0 = opcional)<input type="number" min={0} max={g.options.length} value={g.min} onChange={e=>update(i,{min:Number(e.target.value)})}/></label><label>Máximo<input type="number" min={1} max={g.options.length} value={g.max} onChange={e=>update(i,{max:Number(e.target.value)})}/></label></div>
   <small>Nome · Adicional (R$) · Disponível</small>
   {g.options.map((o,j)=><div className="custom-config-option" key={o.id}>
    <input required aria-label="Nome da opção" maxLength={100} value={o.name} onChange={e=>update(i,{options:g.options.map((x,k)=>k===j?{...x,name:e.target.value}:x)})}/>
    <input aria-label="Preço adicional em reais" type="number" min={0} max={100000} step="0.01" value={o.priceCents/100} onChange={e=>update(i,{options:g.options.map((x,k)=>k===j?{...x,priceCents:Math.round(Number(e.target.value)*100)}:x)})}/>
    <input type="checkbox" aria-label={'Disponível: '+o.name} checked={o.active} onChange={e=>update(i,{options:g.options.map((x,k)=>k===j?{...x,active:e.target.checked}:x)})}/>
    <button type="button" className="icon-btn" aria-label="Excluir opção" disabled={g.options.length<=1} onClick={()=>{const options=g.options.filter(x=>x.id!==o.id);update(i,{options,max:Math.min(g.max,options.length),min:Math.min(g.min,options.length)});}}><X size={15}/></button>
   </div>)}
   <button type="button" className="btn btn-xs btn-outline" disabled={g.options.length>=30} onClick={()=>update(i,{options:[...g.options,makeOption()]})}><Plus size={14}/> Adicionar complemento</button>
  </div>)}
  <button type="button" className="btn btn-outline" disabled={value.groups.length>=12} onClick={()=>onChange({...value,groups:[...value.groups,makeGroup()]})}><Plus size={16}/> Criar grupo</button>
  <label className="check-row"><input type="checkbox" checked={value.allowNotes} onChange={e=>onChange({...value,allowNotes:e.target.checked})}/> Permitir observações e retirada de ingredientes</label>
 </section>;
}
export function CustomProductCard({product,img,onAdd}:{product:any;img:(url?:string)=>string;onAdd:(choice:CustomSelection,quantity:number)=>void}){
 const config=readCustomConfig(product.custom_config_json)!;
 const [open,setOpen]=useState(false),[ids,setIds]=useState<string[]>([]),[note,setNote]=useState(''),[quantity,setQuantity]=useState(1);
 const original=Number(product.price_cents);
 const base=typeof product.promo_price_cents==='number'&&product.promo_price_cents>=0&&product.promo_price_cents<original?product.promo_price_cents:original;
 const cheapest=config.groups.reduce((s,g)=>s+g.options.filter(o=>o.active).map(o=>o.priceCents).sort((a,b)=>a-b).slice(0,g.min).reduce((a,b)=>a+b,0),base);
 const extras=config.groups.flatMap(g=>g.options).filter(o=>ids.includes(o.id)).reduce((s,o)=>s+o.priceCents,0);
 let valid=false;
 try{resolveCustomSelection(config,{optionIds:ids,note});valid=true;}catch{}
 function start(){setIds([]);setNote('');setQuantity(1);setOpen(true)}
 function toggle(g:Group,id:string){setIds(old=>{
  if(old.includes(id))return old.filter(x=>x!==id);
  const own=new Set(g.options.map(o=>o.id));
  const selected=old.filter(x=>own.has(x));
  if(g.max===1)return [...old.filter(x=>!own.has(x)),id];
  return selected.length<g.max?[...old,id]:old;
 });}
 return <article className="custom-product-card">
  <button type="button" onClick={start} style={{border:0,padding:0,background:'transparent',cursor:'pointer'}} aria-label={'Montar '+product.name}><img className="custom-product-cover" src={img(product.image_url)} alt={product.name}/></button>
  <div className="custom-product-card-body"><button type="button" onClick={start} style={{border:0,background:'transparent',textAlign:'left',padding:0,fontWeight:700,cursor:'pointer'}}>{product.name}</button><strong>A partir de {formatBRL(cheapest)}</strong><button type="button" className="btn btn-primary btn-block" onClick={start}>Montar e adicionar</button></div>
  {open&&createPortal(<div className="fixed-price-overlay" onClick={()=>setOpen(false)} style={{'--store-color':document.querySelector<HTMLElement>('.storefront')?.style.getPropertyValue('--store-color')||'#16834b'} as React.CSSProperties}>
   <div className="fixed-price-modal custom-product-modal" role="dialog" aria-modal="true" aria-label={'Personalizar '+product.name} onClick={e=>e.stopPropagation()}>
    <header className="fixed-price-hero"><img src={img(product.image_url)} alt=""/><button type="button" className="icon-btn fixed-price-close" onClick={()=>setOpen(false)} aria-label="Fechar"><X/></button></header>
    <div className="fixed-price-body"><h2>{product.name}</h2><p>{product.description}</p><strong>Preço base: {formatBRL(base)}</strong>
     {config.groups.map(g=>{const selected=g.options.filter(o=>ids.includes(o.id)).length;return <section key={g.id} className="custom-choice-group"><h3>{g.name}</h3><small>{g.min?'Obrigatório':'Opcional'} · {g.min===g.max?'Escolha '+g.max:'Escolha de '+g.min+' a '+g.max} · {selected}/{g.max}</small>
      {g.options.map(o=><label className="custom-choice-option" key={o.id}><input type={g.max===1&&g.min===1?'radio':'checkbox'} name={g.id} checked={ids.includes(o.id)} disabled={!o.active||(!ids.includes(o.id)&&g.max>1&&selected>=g.max)} onChange={()=>toggle(g,o.id)}/><span>{o.name}{!o.active?' (indisponível)':''}</span><b>{o.priceCents?'+'+formatBRL(o.priceCents):'Incluso'}</b></label>)}
     </section>})}
     {config.allowNotes&&<label>Observações / retirar ingredientes<textarea rows={3} maxLength={300} placeholder="Ex.: sem cebola" value={note} onChange={e=>setNote(e.target.value)}/></label>}
    </div>
    <footer className="fixed-price-footer custom-product-footer"><input aria-label="Quantidade" type="number" min={1} max={99} value={quantity} onChange={e=>setQuantity(Math.max(1,Math.min(99,Math.floor(Number(e.target.value)||1))))}/><button type="button" className="btn btn-primary" disabled={!valid} onClick={()=>{onAdd({optionIds:ids,note},quantity);setOpen(false);}}>Adicionar · {formatBRL((base+extras)*quantity)}</button></footer>
   </div></div>,document.body)}
 </article>;
}
