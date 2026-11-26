import {useState} from 'react';
import {createPortal} from 'react-dom';
import {Plus,X,Trash2} from 'lucide-react';
import {formatBRL} from '../shared/pricing';
import EditableNumberInput from './EditableNumberInput';
import {readCustomConfig,resolveCustomSelection,customUnitPrice,minimumCustomPrice,type CustomConfig,type CustomSelection} from '../shared/custom-product';
const uid=()=>crypto.randomUUID();
const makeOption=(name='',priceCents=0)=>({id:uid(),name,priceCents,active:true});
const makeGroup=(name='',min=0,max=1,options=[makeOption()])=>({id:uid(),name,min,max,options});
const makeIncludedGroup=()=>({...makeGroup('Ingredientes inclusos',0,1,[makeOption('Ingrediente')]),kind:'included' as const});
export const newCustomConfig=():CustomConfig=>({allowNotes:true,groups:[
 makeGroup('Tamanho',1,1,[makeOption('Pequena'),makeOption('Média',500),makeOption('Grande',1000)]),
 makeGroup('Proteína',1,1,[makeOption('Frango'),makeOption('Carne')]),
 makeGroup('Acompanhamentos',0,3,[makeOption('Arroz'),makeOption('Feijão'),makeOption('Salada')]),
 makeGroup('Adicionais',0,1,[makeOption('Ovo frito',200)]),
]});
export const newPizzaConfig=():CustomConfig=>({allowNotes:true,groups:[
 {...makeGroup('Tamanho',1,1,[makeOption('Broto · 4 fatias',2590),makeOption('Média · 6 fatias',3590),makeOption('Grande · 8 fatias',4590),makeOption('Família · 12 fatias',5990)]),priceMode:'final'},
 {...makeGroup('Sabores',2,2,['Calabresa','Mussarela','Portuguesa','Frango com catupiry','Marguerita','Quatro queijos','Pepperoni','Bacon','Napolitana','Moda da casa'].map(n=>makeOption(n))),selectionMode:'half-and-half'},
 makeGroup('Borda recheada',0,1,[makeOption('Sem borda',0),makeOption('Catupiry',700),makeOption('Cheddar',700),makeOption('Chocolate',900)]),
 makeGroup('Adicionais',0,8,[makeOption('Bacon',500),makeOption('Catupiry',500),makeOption('Cheddar',500),makeOption('Milho',250),makeOption('Azeitona',250),makeOption('Cebola',200),makeOption('Tomate',250),makeOption('Extra mussarela',600)]),
 makeGroup('Tipo de massa',0,1,[makeOption('Tradicional'),makeOption('Fina'),makeOption('Integral')])
]});
export const newSnackConfig=():CustomConfig=>{
 const ingredients=['Pão','Hambúrguer','Queijo','Presunto','Alface','Tomate','Cebola','Milho','Batata palha','Molho especial'];
 const included={...makeGroup('Ingredientes que acompanham',0,ingredients.length,ingredients.map(n=>makeOption(n))),kind:'included' as const};
 return {allowNotes:true,groups:[included,
  makeGroup('Adicionais',0,8,[makeOption('Bacon',400),makeOption('Ovo',250),makeOption('Cheddar',350),makeOption('Hambúrguer extra',600),makeOption('Queijo extra',300),makeOption('Presunto extra',250),makeOption('Catupiry',400),makeOption('Calabresa',400)]),
  makeGroup('Ponto da carne',0,1,[makeOption('Bem passado'),makeOption('Ao ponto'),makeOption('Mal passado')])
 ]};
};
type Group=CustomConfig['groups'][number];
export function CustomConfigEditor({value,onChange,baseCents=0}:{value:CustomConfig;onChange:(v:CustomConfig)=>void;baseCents?:number}){
 const update=(index:number,change:Partial<Group>)=>onChange({...value,groups:value.groups.map((g,i)=>i===index?{...g,...change}:g)});
 const finalGroup=value.groups.find(g=>g.priceMode==='final');
 return <section className="custom-config-editor">
  <h3>Complementos e ingredientes</h3><div className="custom-config-create"><button type="button" className="btn btn-outline" onClick={()=>onChange(newPizzaConfig())}>🍕 Usar modelo de pizza</button><button type="button" className="btn btn-outline" onClick={()=>onChange(newSnackConfig())}>🍔 Usar modelo de lanche</button></div><small>Use «Escolhas e adicionais» para opções que o cliente precisa selecionar. Use «Ingredientes que já vêm no produto» para mostrar a composição do lanche e permitir retirar ingredientes sem cobrança. O preço base já inclui esses ingredientes.</small>
  {value.groups.map((g,i)=><div key={g.id} className="custom-config-group">
   <div className="custom-config-row"><label>Nome do grupo<input required maxLength={100} value={g.name} onChange={e=>update(i,{name:e.target.value})}/></label><button type="button" className="icon-btn" aria-label="Excluir grupo" onClick={()=>onChange({...value,groups:value.groups.filter(x=>x.id!==g.id)})}><Trash2 size={16}/></button></div>
   {g.kind!=='included'&&/sabor/i.test(g.name)&&<label className="check-row"><input type="checkbox" checked={g.selectionMode==='half-and-half'} onChange={e=>update(i,e.target.checked?{selectionMode:'half-and-half',min:2,max:2}:{selectionMode:undefined,min:1,max:1})}/> Pizza vendida meio a meio (cliente escolhe 2 sabores em sequência)</label>}
   <label>Como funciona este grupo?<select value={g.kind||'choice'} onChange={e=>{
    const kind=e.target.value as 'choice'|'included';
    if(kind==='included'&&g.options.some(o=>o.priceCents!==0)){window.alert('Para marcar ingredientes que já vêm no lanche, coloque R$ 0,00 nas opções deste grupo primeiro.');return;}
    update(i,kind==='included'?{kind,priceMode:'additional',min:0,max:g.options.length}:{kind,min:0,max:1});
   }}><option value="choice">Escolhas e adicionais (cliente seleciona)</option><option value="included">Ingredientes que já vêm no produto (cliente pode retirar)</option></select></label>
   {g.selectionMode==='half-and-half'&&<small>O cliente escolhe o primeiro sabor e, em seguida, aparece uma segunda lista para escolher o outro sabor. Os dois sabores são obrigatórios e não podem ser repetidos.</small>}{g.kind==='included'?<small>Todos os ingredientes disponíveis já vêm no produto. O cliente só marca o que deseja retirar, sem alterar o valor.</small>:<label>Forma de cobrança do grupo<select value={g.priceMode||'additional'} onChange={e=>{const priceMode=e.target.value as 'additional'|'final';update(i,priceMode==='final'?{priceMode,min:1,max:1}:{priceMode});}}><option value="additional">Adicional ao preço base (+ R$)</option><option value="final" disabled={value.groups.some(x=>x.id!==g.id&&x.priceMode==='final')}>Preço final do tamanho (substitui o preço base)</option></select></label>}
   {g.kind==='included'?<small>Cadastre os nomes originais: Hambúrguer, Queijo, Presunto... O cliente verá a composição e poderá marcar o que não quer.</small>:g.priceMode==='final'?<small>Uma escolha obrigatória. Informe o preço integral, por exemplo R$ 20,00. A promoção do preço base não é aplicada a este grupo.</small>:<small>Informe R$ 0,00 quando a escolha não tiver custo extra. Opções sem custo ainda precisam ser selecionadas pelo cliente.</small>}
   {g.kind!=='included'&&g.selectionMode!=='half-and-half'&&<div className="custom-config-row"><label>Mínimo (0 = opcional)<EditableNumberInput aria-label={'Quantidade mínima '+g.name} min={0} max={g.options.length} step={1} disabled={g.priceMode==='final'} value={g.min} onValueChange={min=>update(i,{min})}/></label><label>Máximo<EditableNumberInput aria-label={'Quantidade máxima '+g.name} min={1} max={g.options.length} step={1} disabled={g.priceMode==='final'} value={g.max} onValueChange={max=>update(i,{max})}/></label></div>}
   <small>{g.kind==='included'?'Ingrediente · Já incluso · Disponível':'Nome · '+(g.priceMode==='final'?'Preço final (R$)':'Adicional (R$)')+' · Disponível'}</small>
   {g.options.map((o,j)=><div className="custom-config-option" key={o.id}>
    <input required aria-label="Nome da opção" maxLength={100} value={o.name} onChange={e=>update(i,{options:g.options.map((x,k)=>k===j?{...x,name:e.target.value}:x)})}/>
    {g.kind==='included'?<span className="custom-included-price">Incluso</span>:<EditableNumberInput aria-label={g.priceMode==='final'?'Preço final em reais':'Preço adicional em reais'} min={0} max={100000} step="0.01" value={o.priceCents/100} onValueChange={value=>update(i,{options:g.options.map((x,k)=>k===j?{...x,priceCents:Math.round(value*100)}:x)})}/>}
    {finalGroup&&g.id!==finalGroup.id&&g.kind!=='included'&&<div className="custom-size-price-grid"><small>Preço adicional por tamanho (substitui o adicional padrão)</small>{finalGroup.options.map(size=><label key={size.id}>{size.name}<EditableNumberInput aria-label={'Preço de '+o.name+' para '+size.name} min={0} max={100000} step="0.01" value={(o.priceByOptionId?.[size.id]??o.priceCents)/100} onValueChange={amount=>update(i,{options:g.options.map((x,k)=>k===j?{...x,priceByOptionId:{...(x.priceByOptionId||{}),[size.id]:Math.round(amount*100)}}:x)})}/></label>)}</div>}
    <input type="checkbox" aria-label={'Disponível: '+o.name} checked={o.active} onChange={e=>update(i,{options:g.options.map((x,k)=>k===j?{...x,active:e.target.checked}:x)})}/>
    <button type="button" className="icon-btn" aria-label="Excluir opção" disabled={g.options.length<=1} onClick={()=>{const options=g.options.filter(x=>x.id!==o.id);update(i,{options,max:g.kind==='included'?options.length:Math.min(g.max,options.length),min:g.kind==='included'?0:Math.min(g.min,options.length)});}}><X size={15}/></button>
   </div>)}
   <button type="button" className="btn btn-xs btn-outline" disabled={g.options.length>=30} onClick={()=>update(i,{options:[...g.options,makeOption()],...(g.kind==='included'?{max:g.options.length+1}: {})})}><Plus size={14}/> Adicionar complemento</button>
  </div>)}
  <div className="custom-config-create">
   <button type="button" className="btn btn-outline" disabled={value.groups.length>=12} onClick={()=>onChange({...value,groups:[...value.groups,makeGroup()]})}><Plus size={16}/> Criar grupo de escolhas</button>
   <button type="button" className="btn btn-outline" disabled={value.groups.length>=12} onClick={()=>onChange({...value,groups:[...value.groups,makeIncludedGroup()]})}><Plus size={16}/> Ingredientes já inclusos</button>
  </div>
  <div className="custom-price-check"><b>Menor preço com as escolhas obrigatórias: {formatBRL(minimumCustomPrice(value,baseCents))}</b><small>Confira o valor antes de salvar. Se estiver somando o preço de um tamanho completo ao preço base, altere a forma de cobrança do grupo para Preço final do tamanho.</small></div>
  <label className="check-row"><input type="checkbox" checked={value.allowNotes} onChange={e=>onChange({...value,allowNotes:e.target.checked})}/> Permitir observações e retirada de ingredientes</label>
 </section>;
}
export function CustomProductCard({product,img,onAdd}:{product:any;img:(url?:string)=>string;onAdd:(choice:CustomSelection,quantity:number)=>void}){
 const config=readCustomConfig(product.custom_config_json)!;
 const [open,setOpen]=useState(false),[ids,setIds]=useState<string[]>([]),[note,setNote]=useState(''),[quantityInput,setQuantityInput]=useState('1');
 const original=Number(product.price_cents);
 const base=typeof product.promo_price_cents==='number'&&product.promo_price_cents>=0&&product.promo_price_cents<original?product.promo_price_cents:original;
 const cheapest=minimumCustomPrice(config,base);
 const hasFinal=config.groups.some(g=>g.priceMode==='final');
 const includedGroups=config.groups.filter(g=>g.kind==='included');
 const includedNames=includedGroups.flatMap(g=>g.options.filter(o=>o.active).map(o=>o.name));
 const quantity=Number(quantityInput);
 const quantityValid=quantityInput.trim()!==''&&/^\d+$/.test(quantityInput.trim())&&Number.isSafeInteger(quantity)&&quantity>=1&&quantity<=99;
 let valid=false,unitTotal=cheapest;
 try{const selection=resolveCustomSelection(config,{optionIds:ids,note});unitTotal=customUnitPrice(base,selection);valid=true;}catch{}
 function start(){setIds([]);setNote('');setQuantityInput('1');setOpen(true)}
 function toggle(g:Group,id:string){setIds(old=>{
  if(old.includes(id))return old.filter(x=>x!==id);
  const own=new Set(g.options.map(o=>o.id));
  const selected=old.filter(x=>own.has(x));
  if(g.kind==='included')return [...old,id];
  if(g.max===1)return [...old.filter(x=>!own.has(x)),id];
  return selected.length<g.max?[...old,id]:old;
 });}
 return <article className="custom-product-card">
  <button type="button" onClick={start} style={{border:0,padding:0,background:'transparent',cursor:'pointer'}} aria-label={'Montar '+product.name}><img className="custom-product-cover" src={img(product.image_url)} alt={product.name}/></button>
  <div className="custom-product-card-body"><button type="button" onClick={start} style={{border:0,background:'transparent',textAlign:'left',padding:0,fontWeight:700,cursor:'pointer'}}>{product.name}</button>{includedNames.length>0&&<small className="custom-included-summary"><b>Já vem com:</b> {includedNames.join(', ')}</small>}<strong>A partir de {formatBRL(cheapest)}</strong><button type="button" className="btn btn-primary btn-block" onClick={start}>Montar e adicionar</button></div>
  {open&&createPortal(<div className="fixed-price-overlay" onClick={()=>setOpen(false)} style={{'--store-color':document.querySelector<HTMLElement>('.storefront')?.style.getPropertyValue('--store-color')||'#16834b'} as React.CSSProperties}>
   <div className="fixed-price-modal custom-product-modal" role="dialog" aria-modal="true" aria-label={'Personalizar '+product.name} onClick={e=>e.stopPropagation()}>
    <header className="fixed-price-hero"><img src={img(product.image_url)} alt=""/><button type="button" className="icon-btn fixed-price-close" onClick={()=>setOpen(false)} aria-label="Fechar"><X/></button></header>
    <div className="fixed-price-body"><h2>{product.name}</h2><p>{product.description}</p><strong>{hasFinal?'A partir de '+formatBRL(cheapest):'Preço base: '+formatBRL(base)}</strong>
     {includedNames.length>0&&<div className="custom-included-summary custom-included-in-modal"><b>Ingredientes inclusos:</b> {includedNames.join(', ')}</div>}
     {config.groups.filter(g=>g.kind!=='included').map(g=>{const selectedIds=ids.filter(id=>g.options.some(o=>o.id===id));const selected=g.options.filter(o=>ids.includes(o.id)).length;const sizeId=config.groups.find(x=>x.priceMode==='final')?.options.find(x=>ids.includes(x.id))?.id;const renderFlavorStep=(position:number,title:string,excludeId?:string)=> <div className="custom-flavor-step"><h4>{title}</h4>{g.options.filter(o=>o.id!==excludeId).map(o=>{const price=sizeId&&o.priceByOptionId&&Object.prototype.hasOwnProperty.call(o.priceByOptionId,sizeId)?o.priceByOptionId[sizeId]:o.priceCents;return <label className="custom-choice-option" key={o.id}><input type="radio" name={g.id+'-'+position} checked={selectedIds[position]===o.id} disabled={!o.active} onChange={()=>setIds(old=>{const own=new Set(g.options.map(x=>x.id));const other=old.filter(x=>!own.has(x));const flavors=old.filter(x=>own.has(x));const next=[flavors[0],flavors[1]] as (string|undefined)[];next[position]=o.id;if(position===0&&next[1]===o.id)next[1]=undefined;return [...other,...next.filter((x):x is string=>!!x)];})}/><span>{o.name}{!o.active?' (indisponível)':''}</span><b>{g.priceMode==='final'?formatBRL(o.priceCents):o.priceByOptionId&&!sizeId?'Varia por tamanho':price?'+'+formatBRL(price):'Sem custo extra'}</b></label>})}</div>;return <section key={g.id} className="custom-choice-group"><h3>{g.selectionMode==='half-and-half'?'Sabores da pizza':g.name}</h3>{g.selectionMode==='half-and-half'?<><small>Escolha os dois sabores da pizza meia a meia.</small>{renderFlavorStep(0,'1. Escolha o primeiro sabor')}{selectedIds.length>0&&renderFlavorStep(1,'2. Agora escolha o segundo sabor',selectedIds[0])}</>:<><small>{g.min?'Obrigatório':'Opcional'} · {g.min===g.max?'Escolha '+g.max:'Escolha de '+g.min+' a '+g.max} · {selected}/{g.max}</small>{g.options.map(o=>{const price=sizeId&&o.priceByOptionId&&Object.prototype.hasOwnProperty.call(o.priceByOptionId,sizeId)?o.priceByOptionId[sizeId]:o.priceCents;const varies=!!o.priceByOptionId;return <label className="custom-choice-option" key={o.id}><input type={g.max===1&&g.min===1?'radio':'checkbox'} name={g.id} checked={ids.includes(o.id)} disabled={!o.active||(!ids.includes(o.id)&&g.max>1&&selected>=g.max)} onChange={()=>toggle(g,o.id)}/><span>{o.name}{!o.active?' (indisponível)':''}</span><b>{g.priceMode==='final'?formatBRL(o.priceCents):varies&&!sizeId?'Varia por tamanho':price?'+'+formatBRL(price):'Sem custo extra'}</b></label>})}</>}</section>})}
     {includedGroups.some(g=>g.options.some(o=>o.active))&&<section className="custom-choice-group custom-removal-group">
      <h3>Deseja retirar algum ingrediente?</h3>
      <small>Opcional · Marque somente o que deseja retirar. Sem cobrança adicional.</small>
      {includedGroups.flatMap(g=>g.options.filter(o=>o.active).map(o=><label className="custom-choice-option custom-removal-option" key={o.id}>
       <input type="checkbox" checked={ids.includes(o.id)} onChange={()=>toggle(g,o.id)} aria-label={'Retirar '+o.name}/>
       <span>{o.name}</span><b>{ids.includes(o.id)?'RETIRAR':'Manter'}</b>
      </label>))}
     </section>}
     {config.allowNotes&&<label>Observações / retirar ingredientes<textarea rows={3} maxLength={300} placeholder="Ex.: sem cebola" value={note} onChange={e=>setNote(e.target.value)}/></label>}
    </div>
    <footer className="fixed-price-footer custom-product-footer"><input aria-label="Quantidade" type="number" inputMode="numeric" min={1} max={99} step={1} value={quantityInput} onChange={e=>setQuantityInput(e.target.value)} onBlur={()=>{if(quantityInput==='')setQuantityInput('1');}}/><button type="button" className="btn btn-primary" disabled={!valid||!quantityValid} onClick={()=>{if(!quantityValid||!valid)return;onAdd({optionIds:ids,note},quantity);setOpen(false);}}>Adicionar · {quantityValid?formatBRL(unitTotal*quantity):'—'}</button></footer>
   </div></div>,document.body)}
 </article>;
}
