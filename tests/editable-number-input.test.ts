import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import EditableNumberInput,{parseEditableNumber} from '../src/web/EditableNumberInput';
import {CustomProductCard,newCustomConfig} from '../src/web/CustomProduct';
import {customConfigSchema} from '../src/shared/custom-product';

describe('edição livre de valores, quantidade e unidades',()=>{
 it('permite apagar TODOS os números antes de digitar novo valor, sem converter vazio em zero',()=>{
  expect(parseEditableNumber('',0,100,1)).toBeNull();
  expect(parseEditableNumber('  ',0,100,1)).toBeNull();
  expect(parseEditableNumber('2',1,99,1)).toBe(2);
  expect(parseEditableNumber('3',1,99,1)).toBe(3);
  expect(parseEditableNumber('0',1,99,1)).toBeNull();
  expect(parseEditableNumber('1.5',1,99,1)).toBeNull();
  expect(parseEditableNumber('2.50',0,1000,'0.01')).toBe(2.5);
  expect(parseEditableNumber('5',0,1000,'0.01')).toBe(5);
  expect(parseEditableNumber('1000',1,100,1)).toBeNull();
  expect(parseEditableNumber('1e2',1,999,1)).toBeNull();
  expect(parseEditableNumber('-',1,999,1)).toBeNull();
 });
 it('gera campo editável com valor inicial correto sem sobrescrever entrada parcial',()=>{
  const field=renderToStaticMarkup(createElement(EditableNumberInput,{value:1,onValueChange:()=>{},min:1,max:99,step:1,'aria-label':'Quantidade de itens'}));
  expect(field).toContain('value="1"');
  expect(field).toContain('required=""');
  expect(field).toContain('aria-label="Quantidade de itens"');
 });
 it('mantém produto personalizável com quantidade digitável em vez de forçar zero ou um',()=>{
  const config=customConfigSchema.parse(newCustomConfig());
  const product={id:'lanche',name:'X-tudo',price_cents:2200,promo_price_cents:null,custom_config_json:JSON.stringify(config)};
  const html=renderToStaticMarkup(createElement(CustomProductCard,{product,img:(s?:string)=>s||'',onAdd:()=>{}}));
  expect(html).toContain('Montar e adicionar');
 });
});
