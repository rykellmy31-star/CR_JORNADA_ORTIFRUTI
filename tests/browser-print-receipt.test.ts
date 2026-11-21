import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import OrderPrintReceipt,{type PrintableOrder} from '../src/web/OrderPrintReceipt';

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
   'Perto da feira','Meio quilo','2x Meio quilo','R$ 15,00','R$ 31,50',
   'R$ 18,50','Dinheiro na entrega','Documento não fiscal']){
   expect(html).toContain(label);
  }
  expect(html).toContain('class="order-print-receipt"');
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
 it('identifica pedidos cancelados para evitar comanda de venda incorreta',()=>{
  const data=order();data.status='cancelled';
  const html=renderToStaticMarkup(createElement(OrderPrintReceipt,{order:data,storeName:'Loja'}));
  expect(html).toContain('Cancelado');
 });
});
