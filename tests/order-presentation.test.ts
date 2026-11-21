import {describe,it,expect} from 'vitest';
import {formatWhatsAppItems,orderSavings} from '../src/shared/order-presentation';
import {loadCheckoutIdentity,saveCheckoutIdentity,clearCheckoutIdentity,emptyCheckoutIdentity} from '../src/web/checkout-memory';
import {DEFAULT_WHATSAPP_TEMPLATES} from '../src/server/services/evolution-whatsapp';
describe('comanda, mensagens e dados salvos',()=>{
 it('mostra preço original antes da promoção, sem inventar economia de pedido antigo',()=>{
  const items=[{product_name_snapshot:'Tomate',quantity_display:'1x 1 kg',variant_name_snapshot:'1 kg',line_total_cents:1200,original_line_total_cents:1500},{product_name_snapshot:'Abacate',quantity_display:'1 un',line_total_cents:700}];
  expect(formatWhatsAppItems(items)).toContain('De: ~R$ 15,00~\n🔥 Por: *R$ 12,00*');
  expect(orderSavings(items)).toBe(300);
  expect(orderSavings([items[1]])).toBe(0);
  expect(DEFAULT_WHATSAPP_TEMPLATES.find(t=>t.event_type==='order_received')?.message_template).toContain('{endereco_entrega}');
  expect(DEFAULT_WHATSAPP_TEMPLATES.find(t=>t.event_type==='order_accepted')?.message_template).toContain('para seu pedido chegar.');
 });
 it('lembra somente identidade e endereço isolados por loja, e permite excluir',()=>{
  const map=new Map<string,string>();const storage={getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>map.set(k,v),removeItem:(k:string)=>map.delete(k)} as unknown as Storage;
  const identity={...emptyCheckoutIdentity(),customerName:'Maria',phone:'73999999999',street:'Rua A'};
  saveCheckoutIdentity('loja-a',{...identity,whatsappOptIn:true} as any,storage);
  expect(loadCheckoutIdentity('loja-a',storage)).toEqual(identity);
  expect(loadCheckoutIdentity('loja-b',storage)).toEqual(emptyCheckoutIdentity());
  expect([...map.values()][0]).not.toContain('whatsappOptIn');
  clearCheckoutIdentity('loja-a',storage);
  expect(loadCheckoutIdentity('loja-a',storage)).toEqual(emptyCheckoutIdentity());
 });
});
