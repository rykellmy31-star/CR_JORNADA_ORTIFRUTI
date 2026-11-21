import {useEffect,useMemo,useState} from 'react';
import {createPortal} from 'react-dom';
import {Check,Minus,Plus,X} from 'lucide-react';

type Variant={id:string;name:string;price_cents:number;promo_price_cents:number|null};
type FixedProduct={id:string;name:string;description?:string|null;image_url?:string|null;variants:Variant[]};
const cost=(v:Variant)=>v.promo_price_cents!=null&&v.promo_price_cents>=0&&v.promo_price_cents<v.price_cents?v.promo_price_cents:v.price_cents;

/** Escolha obrigatória da quantidade de preço fechado, sem alterar as embalagens antigas. */
export default function FixedPriceProductCard({p,getLine,setLine,img,money}:{
 p:FixedProduct;getLine:(product:any,variant:any,mode:'variants')=>number;
 setLine:(product:any,variant:any,mode:'variants',quantity:number)=>void;
 img:(url?:string)=>string;money:(value:number)=>string;
}){
 const [open,setOpen]=useState(false);
 const [selectedId,setSelectedId]=useState('');
 const [quantity,setQuantity]=useState(1);
 const options=useMemo(()=>p.variants||[],[p.variants]);
 const selected=options.find(v=>v.id===selectedId)||null;
 const minimum=options.length?Math.min(...options.map(cost)):0;

 useEffect(()=>{
  if(!open)return;
  const previous=document.body.style.overflow;
  document.body.style.overflow='hidden';
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape')setOpen(false);};
  document.addEventListener('keydown',key);
  return()=>{document.body.style.overflow=previous;document.removeEventListener('keydown',key);};
 },[open]);
 const close=()=>{setOpen(false);setSelectedId('');setQuantity(1);};
 const add=()=>{
  if(!selected)return;
  setLine(p,selected,'variants',getLine(p,selected,'variants')+quantity);
  close();
 };
 return <>
  <article className="product-card fixed-price-card">
   <div className="product-photo"><img src={img(p.image_url||undefined)} loading="lazy" alt={p.name}/>
    <div className="fresh-pill"><span/> Preço fixo</div>
   </div>
   <div className="product-info">
    <small className="product-category">ESCOLHA A QUANTIDADE</small>
    <h3>{p.name}</h3>
    {p.description&&<p className="product-desc">{p.description}</p>}
    <div className="product-price"><span className="current-price">a partir de {money(minimum)}</span></div>
    <button type="button" className="add-btn fixed-open-button" onClick={()=>setOpen(true)}>
     <Plus size={16}/> Escolher quantidade
    </button>
   </div>
  </article>
  {open&&createPortal(<div className="fixed-price-overlay" role="presentation"
    onMouseDown={event=>{if(event.target===event.currentTarget)close();}}>
   <section className="fixed-price-modal" role="dialog" aria-modal="true"
    aria-labelledby="fixed-modal-title">
    <div className="fixed-price-hero">
     <img src={img(p.image_url||undefined)} alt={p.name}/>
     <button type="button" aria-label="Fechar opções" className="fixed-price-close" onClick={close}><X size={23}/></button>
    </div>
    <div className="fixed-price-body">
     <h2 id="fixed-modal-title">{p.name}</h2>
     <strong className="fixed-price-start">a partir de {money(minimum)}</strong>
     {p.description&&<p className="fixed-price-desc">{p.description}</p>}
     <div className="fixed-price-choose"><div><h3>Escolha a quantidade <span>Obrigatório</span></h3>
      <small>Escolha 1 opção.</small></div></div>
     <div className="fixed-price-option-list" role="radiogroup" aria-label="Quantidade do produto">
      {options.map((option:Variant)=><label key={option.id} className={'fixed-price-option '+(selectedId===option.id?'selected':'')}>
       <span><b>{option.name}</b><strong>{money(cost(option))}</strong></span>
       <input type="radio" name={'fixed-option-'+p.id}
        value={option.id} checked={selectedId===option.id} onChange={()=>setSelectedId(option.id)}/>
       <span className="fixed-price-radio"><Check size={13}/></span>
      </label>)}
     </div>
    </div>
    <div className="fixed-price-footer">
     <div className="fixed-price-stepper">
      <button type="button" aria-label="Diminuir quantidade" disabled={quantity<=1} onClick={()=>setQuantity(v=>Math.max(1,v-1))}><Minus size={16}/></button>
      <span>{quantity}</span>
      <button type="button" aria-label="Aumentar quantidade" disabled={quantity>=99} onClick={()=>setQuantity(v=>Math.min(99,v+1))}><Plus size={16}/></button>
     </div>
     <button type="button" className="fixed-price-add" disabled={!selected}
      onClick={add}>Adicionar <span>{money(selected?cost(selected)*quantity:0)}</span></button>
    </div>
   </section>
  </div>,document.body)}
 </>;
}
