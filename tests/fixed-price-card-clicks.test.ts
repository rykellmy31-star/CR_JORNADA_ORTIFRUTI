import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import FixedPriceProductCard from '../src/web/FixedPriceProductCard';

describe('acessos rápidos à escolha de quantidade na vitrine',()=>{
 it('exibe foto, nome e botão como ações acessíveis para abrir a escolha',()=>{
  const html=renderToStaticMarkup(createElement(FixedPriceProductCard,{
   p:{id:'tomate',name:'Tomate',image_url:'/tomate.jpg',variants:[{id:'meio-quilo',name:'Meio quilo',price_cents:750,promo_price_cents:null}]},
   getLine:()=>0,setLine:()=>{},img:(url?:string)=>url||'',money:(value:number)=>'R$ '+(value/100).toFixed(2)
  }));
  expect(html).toContain('class="product-photo fixed-product-photo-trigger"');
  expect(html).toContain('aria-label="Escolher quantidade de Tomate"');
  expect(html).toContain('class="fixed-product-name-trigger"');
  expect(html).toContain('class="add-btn fixed-open-button"');
  expect(html.match(/<button\b/g)).toHaveLength(3);
 });
});
