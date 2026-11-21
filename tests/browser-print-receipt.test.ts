import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import OrderPrintReceipt,{formatReceiptQuantity,type PrintableOrder} from '../src/web/OrderPrintReceipt';

function order():PrintableOrder{
 return {
  order_number:81,created_at:'2026-11-21T18:00:00.000Z',status:'received',
  customer_name:'Maria & João',customer_phone:'73999998811',
  address_street:'Rua das Mangueiras',address_number:'123',address_neighborhood:'Centro',
  address_complement:'Casa 2',address_reference:'Perto da feira',
  payment_method:'cash',needs_change:1,change_for_cents:5000,change_amount_cents:1850,
  subtotal_cents:2550,delivery_fee_cents:600,total_cents:3150,
  items:[{product_name_snapshot:'Tomate',variant_name_snapshot:'Meio quilo',
   quantity_display:'2x Meio quilo',line_total_cents:1500},
   {product_name_snapshot:'Banana',quantity_display:'1 kg',line_total_cents:1050}]
 };
}
describe('comanda para impressão direta do navegador',()=>{
 it('inclui loja, cliente, endereço, itens, quantidades, pagamento, totais e aviso não fiscal',()=>{
  const html=renderToStaticMarkup(createElement(OrderPrintReceipt,{
   order:order(),storeName:'Verdurão Braga'
  }));
  for(const label of ['Verdurão Braga','PEDIDO #81','Maria &amp; João','Rua das Mangueiras',
   'Perto da feira','<b>Tomate</b><span>1 kg</span>','R$ 15,00','R$ 31,50',
   'R$ 18,50','Dinheiro na entrega','Documento não fiscal']){
   expect(html).toContain(label);
  }
  expect(html).toContain('class="order-print-receipt"');
 });
 it('mostra apenas o peso total, preservando opções de embalagem e unidades',()=>{
  const item=(name:string,quantity:string)=>({product_name_snapshot:'Tomate',
   variant_name_snapshot:name,quantity_display:quantity,line_total_cents:1500});
  expect(formatReceiptQuantity(item('1 Kg','1x 1 Kg'))).toBe('1 kg');
  expect(formatReceiptQuantity(item('1 Kg','2x 1 Kg'))).toBe('2 kg');
  expect(formatReceiptQuantity(item('Meio quilo','1x Meio quilo'))).toBe('500 g');
  expect(formatReceiptQuantity(item('Meio quilo','3x Meio quilo'))).toBe('1,5 kg');
  expect(formatReceiptQuantity(item('1,5 Kg','2x 1,5 Kg'))).toBe('3 kg');
  expect(formatReceiptQuantity(item('250 g','3x 250 g'))).toBe('750 g');
  expect(formatReceiptQuantity(item('Caixa 1 kg','2x Caixa 1 kg'))).toBe('2x Caixa 1 kg');
  expect(formatReceiptQuantity(item('Grande','2x Grande'))).toBe('2x Grande');
  expect(formatReceiptQuantity({...item('','3 un'),variant_name_snapshot:null})).toBe('3 un');
  const html=renderToStaticMarkup(createElement(OrderPrintReceipt,{order:order(),storeName:'Loja'}));
  expect(html).not.toContain('Meio quilo');
  expect(html).not.toContain('2x Meio quilo');
 });
 it('não injeta código HTML a partir dos dados de clientes ou produtos',()=>{
  const data=order();data.customer_name='<script>alert(1)</script>';
  data.items[0].product_name_snapshot='<img src=x onerror=alert(1)>';
  const html=renderToStaticMarkup(createElement(OrderPrintReceipt,{
   order:data,storeName:'Hortifruti'
  }));
  expect(html).not.toContain('<script>');
  expect(html).not.toContain('<img ');
  expect(html).toContain('&lt;script&gt;');
  expect(html).toContain('&lt;img');
 });
 it('exibe promoção, economia, entrega grátis e mensagem personalizada sem repetir a marca no rodapé',()=>{
  const data=order();data.items[0].original_line_total_cents=1800;data.delivery_fee_cents=0;data.total_cents=data.subtotal_cents;
  const html=renderToStaticMarkup(createElement(OrderPrintReceipt,{order:data,storeName:'Loja',footerMessage:'Volte sempre!'}));
  for(const label of ['R$ 18,00','EM PROMOÇÃO','VOCÊ ECONOMIZOU R$ 3,00!','GRÁTIS','Volte sempre!','CR Jornada Express · Documento não fiscal'])expect(html).toContain(label);
  expect(html).not.toContain('Desconto promocional');
 });
 it('identifica pedidos cancelados para evitar comanda de venda incorreta',()=>{
  const data=order();data.status='cancelled';
  const html=renderToStaticMarkup(createElement(OrderPrintReceipt,{order:data,storeName:'Loja'}));
  expect(html).toContain('Cancelado');
 });
});
