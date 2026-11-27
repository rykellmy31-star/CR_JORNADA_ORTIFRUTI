import {ShoppingBasket,X,Plus,Check} from 'lucide-react';
import type {SuggestionCategory,SuggestionConfig} from '../shared/checkout-suggestions';

export function SuggestionSettings({value,categories,onChange}:{value:SuggestionConfig;categories:SuggestionCategory[];onChange:(value:SuggestionConfig)=>void}){
 const active=categories.filter(c=>c.is_active===undefined||!!c.is_active);
 const change=(patch:Partial<SuggestionConfig>)=>onChange({...value,...patch});
 return <section className="panel-card settings-card"><div className="panel-heading"><div><h2>Venda sugestiva inteligente</h2><p>Ofereça produtos complementares antes de finalizar o pedido.</p></div><ShoppingBasket size={19}/></div>
 <div className="settings-toggle"><span><b>Ativar sugestões de compra</b><small>Não aparece se o cliente já tiver um produto da categoria sugerida.</small></span><label className="switch"><input aria-label="Ativar sugestões de compra" type="checkbox" checked={value.enabled} onChange={e=>change({enabled:e.target.checked})}/><span/></label></div>
 <div className="form-grid"><div className="full"><b>Categorias que acionam a sugestão</b>{active.map(c=><label key={c.id} className="check-row"><input type="checkbox" checked={value.triggerCategoryIds.includes(c.id)} onChange={e=>change({triggerCategoryIds:e.target.checked?[...value.triggerCategoryIds,c.id]:value.triggerCategoryIds.filter(id=>id!==c.id)})}/>{c.name}</label>)}</div>
 <label>Categoria sugerida<select value={value.suggestedCategoryId} onChange={e=>change({suggestedCategoryId:e.target.value})}><option value="">Selecione</option>{active.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
 <label>Quantidade máxima de sugestões<select value={value.limit} onChange={e=>change({limit:Number(e.target.value)})}>{[1,2,3,4,5,6].map(n=><option key={n} value={n}>{n} produto(s)</option>)}</select></label></div>
 <small>Mostra produtos simples vendidos por unidade, ativos e disponíveis, sem adicionar nada automaticamente.</small></section>;
}

export function CheckoutSuggestionModal({products,cart,categoryName,img,money,price,onAdd,onContinue}:{products:any[];cart:{product:any;quantity:number}[];categoryName:string;img:(url?:string)=>string;money:(c:number)=>string;price:(p:any)=>number;onAdd:(p:any)=>void;onContinue:()=>void}){
 const added=new Set(cart.filter(l=>l.quantity>0).map(l=>l.product.id));
 const beverage=/bebida/i.test(categoryName);
 return <div className="modal-backdrop" onClick={e=>{if(e.target===e.currentTarget)onContinue();}}><div className="checkout-modal" role="dialog" aria-modal="true" aria-label="Sugestões para acompanhar seu pedido">
 <div className="modal-heading"><div><span className="eyebrow">COMPLETE SEU PEDIDO</span><h2>{beverage?'Que tal uma bebida para acompanhar?':'Que tal complementar seu pedido?'}</h2><p>Escolha se desejar, ou continue sem adicionar nada.</p></div><button type="button" className="icon-btn" aria-label="Continuar sem sugestões" onClick={onContinue}><X/></button></div>
 <div className="checkout-scroll"><div className="cart-lines">{products.map(p=><div className="cart-line" key={p.id}><img src={img(p.image_url)} alt={p.name}/><div className="cart-line-meta"><b>{p.name}</b><strong>{money(price(p))}</strong></div><button type="button" className="btn btn-sm btn-primary" disabled={added.has(p.id)} onClick={()=>onAdd(p)} aria-label={added.has(p.id)?p.name+' adicionado':'Adicionar '+p.name}>{added.has(p.id)?<><Check size={16}/> Adicionado</>:<><Plus size={16}/> Adicionar</>}</button></div>)}</div></div>
 <div className="modal-footer"><button type="button" className="btn btn-outline" onClick={onContinue}>{products.some(p=>added.has(p.id))?'Continuar pedido':'Não, obrigado'}</button><button type="button" className="btn btn-primary" onClick={onContinue}>Finalizar pedido</button></div></div></div>;
}
