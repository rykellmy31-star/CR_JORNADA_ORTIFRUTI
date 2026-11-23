import {formatBRL,formatPhoneBR,ORDER_STATUS_LABELS,PAYMENT_METHOD_LABELS} from '../shared/pricing';

import {formatReceiptQuantity,originalPromotionTotal,orderSavings} from '../shared/order-presentation';
export {formatReceiptQuantity} from '../shared/order-presentation';

export type PrintableOrderItem={
 product_name_snapshot:string;
 variant_name_snapshot?:string|null;
 quantity_display:string;
 line_total_cents:number;
 original_line_total_cents?:number|null;
 customization_snapshot?:string|null;
};
export type PrintableOrder={
 order_number:number;
 created_at:string;
 status:string;
 customer_name:string;
 customer_phone:string;
 address_street:string;
 address_number:string;
 address_neighborhood:string;
 address_complement?:string|null;
 address_reference?:string|null;
 payment_method:string;
 needs_change?:number|boolean;
 change_for_cents?:number|null;
 change_amount_cents?:number|null;
 subtotal_cents:number;
 delivery_fee_cents:number;
 total_cents:number;
 items:PrintableOrderItem[];
};

/** Comanda não fiscal para a janela de impressão nativa do navegador. */
export default function OrderPrintReceipt({order,storeName,footerMessage='',storeLogoUrl=null,watermarkText='',watermarkOrientation='diagonal',watermarkOpacity=10,watermarkFontSize=21}:{order:PrintableOrder;storeName:string;footerMessage?:string;storeLogoUrl?:string|null;watermarkText?:string;watermarkOrientation?:'horizontal'|'diagonal'|'vertical';watermarkOpacity?:number;watermarkFontSize?:number}){
 const savings=orderSavings(order.items||[]);
 const payment=PAYMENT_METHOD_LABELS[order.payment_method as keyof typeof PAYMENT_METHOD_LABELS]||order.payment_method;
 const status=ORDER_STATUS_LABELS[order.status as keyof typeof ORDER_STATUS_LABELS]||order.status;
 const created=new Date(order.created_at).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'});
 const address=[order.address_street,order.address_number].filter(Boolean).join(', ');
 return <section className="order-print-receipt" aria-label={`Comanda do pedido ${order.order_number}`}>
  <header className="order-print-header">
   <h1>{storeName}</h1>
   <strong>COMANDA DE PEDIDO</strong>
   <small>CR Jornada Express · Documento não fiscal</small>
  </header>
  <div className="order-print-rule">
   <p><b>PEDIDO #{order.order_number}</b><span>{created}</span></p>
   <p><span>Status</span><b>{status}</b></p>
  </div>
  <div className="order-print-section">
   <b>CLIENTE</b>
   <p>{order.customer_name}</p>
   <p>{formatPhoneBR(order.customer_phone).replace(/^\((\d{2})\) /,'$1 ')}</p>
   <p>{address}</p>
   <p>{order.address_neighborhood}</p>
   {order.address_complement&&<p>Complemento: {order.address_complement}</p>}
   {order.address_reference&&<p>Referência: {order.address_reference}</p>}
  </div>
  <div className="order-print-section">
   <b>PRODUTOS</b>
   <table>
    <thead><tr><th>Item / quantidade</th><th>Valor</th></tr></thead>
    <tbody>{(order.items||[]).map((item,i)=>{const original=originalPromotionTotal(item);return <tr key={i}>
     <td><b>{item.product_name_snapshot}</b>
      <span>{formatReceiptQuantity(item)}</span>
      {item.customization_snapshot&&<span className="customization-details">{item.customization_snapshot}</span>}
      {original!==null&&<small>EM PROMOÇÃO</small>}
     </td>
     <td>{original!==null?<><s className="order-print-old-price">{formatBRL(original)}</s><b className="order-print-new-price">{formatBRL(item.line_total_cents)}</b></>:formatBRL(item.line_total_cents)}</td>
    </tr>})}</tbody>
   </table>
  </div>
  <div className="order-print-totals">
   <p><span>Subtotal</span><b>{formatBRL(order.subtotal_cents)}</b></p>
   <p><span>Entrega</span><b>{order.delivery_fee_cents===0?'GRÁTIS':formatBRL(order.delivery_fee_cents)}</b></p>
   <p className="order-print-grand-total"><span>TOTAL</span><b>{formatBRL(order.total_cents)}</b></p>
  </div>
  {savings>0&&<div className="order-print-savings">VOCÊ ECONOMIZOU {formatBRL(savings)}!</div>}
  <div className="order-print-section order-print-payment">
   <p><b>PAGAMENTO</b><span>{payment}</span></p>
   {!!order.needs_change&&<>
    <p>Troco para: {formatBRL(order.change_for_cents||0)}</p>
    <p>Troco a devolver: {formatBRL(order.change_amount_cents||0)}</p>
   </>}
  </div>
  {footerMessage.trim()&&<footer className="order-print-footer">{footerMessage}</footer>}
  {/* Marca-d'água discreta na parte inferior, atrás da comanda, sem acrescentar campos nem papel. */}
  <div className={`order-print-watermark watermark-${['horizontal','diagonal','vertical'].includes(watermarkOrientation)?watermarkOrientation:'diagonal'}`}
   style={{opacity:Math.max(0,Math.min(35,watermarkOpacity))/100,...({'--watermark-font-size':`${Math.max(10,Math.min(48,watermarkFontSize))}pt`} as any)}} aria-hidden="true">
   {watermarkText.trim()?<span>{watermarkText.trim()}</span>:storeLogoUrl?<img src={storeLogoUrl} alt="" decoding="sync"/>:<span>{storeName}</span>}
  </div>
 </section>;
}
