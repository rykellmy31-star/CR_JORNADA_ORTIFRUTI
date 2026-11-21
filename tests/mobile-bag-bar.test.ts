import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import MobileBagBar from '../src/web/MobileBagBar';
describe('atalho fixo da sacola',()=>{
 it('não aparece quando a sacola está vazia',()=>{
  expect(renderToStaticMarkup(createElement(MobileBagBar,{count:0,subtotal:0,onOpen:()=>{}}))).toBe('');
 });
 it('exibe quantidade, ação e subtotal atual',()=>{
  const html=renderToStaticMarkup(createElement(MobileBagBar,{count:2,subtotal:2290,onOpen:()=>{}}));
  expect(html).toContain('Ver sacola');
  expect(html).toContain('>2</span>');
  expect(html).toContain('R$ 22,90');
 });
});
