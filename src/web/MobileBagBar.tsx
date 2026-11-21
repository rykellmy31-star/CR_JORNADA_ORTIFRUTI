import {formatBRL} from '../shared/pricing';
export default function MobileBagBar({count,subtotal,onOpen}:{count:number;subtotal:number;onOpen:()=>void}){
 if(count<=0)return null;
 return <div className="mobile-bag-bar">
  <button type="button" className="mobile-bag-button" onClick={onOpen}
   aria-label={`Ver sacola, ${count} ${count===1?'produto':'produtos'}, subtotal ${formatBRL(subtotal)}`}>
   <span className="mobile-bag-count">{count}</span>
   <span className="mobile-bag-label">Ver sacola</span>
   <span className="mobile-bag-total">{formatBRL(subtotal)}</span>
  </button>
 </div>;
}
