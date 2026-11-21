import {formatBRL,formatWeightGrams,ORDER_STATUS_LABELS,PAYMENT_METHOD_LABELS} from '../shared/pricing';

export type PrintableOrderItem={
 product_name_snapshot:string;
 variant_name_snapshot?:string|null;
 quantity_display:string;
 line_total_cents:number;
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

/** Resume pesos das opções de preço fechado, sem alterar o pedido ou seus valores.
 * Embalagens e opções sem um peso inequívoco mantêm a quantidade e o nome originais. */
export function formatReceiptQuantity(item:PrintableOrderItem):string{
 const display=item.quantity_display.trim();
 const variant=item.variant_name_snapshot?.trim();
 if(!variant)return display;
 const counted=display.match(/^(\d+)\s*[x×]\s*(.+)$/i);
 if(!counted||counted[2].trim()!==variant)return display;
 const count=Number(counted[1]);
 if(!Number.isSafeInteger(count)||count<=0)return display;
 const label=variant.toLowerCase().replace(/\s+/g,' ');
 let grams=0;
 if(/^(?:meio|meia)\s*(?:kg|quilo|quilograma)$/.test(label))grams=500;
 else{
  const weight=label.match(/^(\d+(?:[,.]\d+)?)\s*(kg|quilo(?:s)?|quilograma(?:s)?|g|grama(?:s)?)$/);
  if(weight){
   const amount=Number(weight[1].replace(',','.'));
   grams=amount*(/^(?:kg|quilo)/.test(weight[2])?1000:1);
  }
 }
 const total=Math.round(grams*count);
 if(grams>0&&Math.abs(grams-Math.round(grams))<1e-8&&Number.isSafeInteger(total)&&total>0){
  return formatWeightGrams(total);
 }
 return display;
}

/** Comanda não fiscal para a janela de impressão nativa do navegador. */
export default function OrderPrintReceipt({order,storeName}:{order:PrintableOrder;storeName:string}){
 const payment=PAYMENT_METHOD_LABELS[order.payment_method as keyof typeof PAYMENT_METHOD_LABELS]||order.payment_method;
 const status=ORDER_STATUS_LABELS[order.status as keyof typeof ORDER_STATUS_LABELS]||order.status;
 const created=new Date(order.created_at).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'});
 const address=[order.address_street,order.address_number].filter(Boolean).join(', ');
 return <section className="order-print-receipt" aria-label={`Comanda do pedido ${order.order_number}`}>
  <header className="order-print-header">
   <h1>{storeName}</h1>
   <strong>COMANDA DE PEDIDO</strong>
   <small>Documento não fiscal</small>
  </header>
  <div className="order-print-rule">
   <p><b>PEDIDO #{order.order_number}</b><span>{created}</span></p>
   <p><span>Status</span><b>{status}</b></p>
  </div>
  <div className="order-print-section">
   <b>CLIENTE</b>
   <p>{order.customer_name}</p>
   <p>{order.customer_phone}</p>
   <p>{address}</p>
   <p>{order.address_neighborhood}</p>
   {order.address_complement&&<p>Complemento: {order.address_complement}</p>}
   {order.address_reference&&<p>Referência: {order.address_reference}</p>}
  </div>
  <div className="order-print-section">
   <b>PRODUTOS</b>
   <table>
    <thead><tr><th>Item / quantidade</th><th>Valor</th></tr></thead>
    <tbody>{(order.items||[]).map((item,i)=><tr key={i}>
     <td><b>{item.product_name_snapshot}</b>
      <span>{formatReceiptQuantity(item)}</span>
     </td>
     <td>{formatBRL(item.line_total_cents)}</td>
    </tr>)}</tbody>
   </table>
  </div>
  <div className="order-print-totals">
   <p><span>Subtotal</span><b>{formatBRL(order.subtotal_cents)}</b></p>
   <p><span>Entrega</span><b>{formatBRL(order.delivery_fee_cents)}</b></p>
   <p className="order-print-grand-total"><span>TOTAL</span><b>{formatBRL(order.total_cents)}</b></p>
  </div>
  <div className="order-print-section">
   <b>PAGAMENTO</b>
   <p>{payment}</p>
   {!!order.needs_change&&<>
    <p>Troco para: {formatBRL(order.change_for_cents||0)}</p>
    <p>Troco a devolver: {formatBRL(order.change_amount_cents||0)}</p>
   </>}
  </div>
  <footer className="order-print-footer">CR Jornada Express · Comanda não fiscal</footer>
 </section>;
}
