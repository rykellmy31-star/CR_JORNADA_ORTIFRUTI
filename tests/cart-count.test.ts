import {describe,expect,it} from 'vitest';
import {countCartItems} from '../src/shared/cart';

describe('contagem de itens na cesta por produto diferente',()=>{
 it('conta quatro produtos, sem somar gramas nem unidades',()=>{
  const cart=[
   {product:{id:'banana'},purchaseMode:'weight',quantity:400},
   {product:{id:'abacaxi'},purchaseMode:'weight',quantity:300},
   {product:{id:'beterraba'},purchaseMode:'unit',quantity:2},
   {product:{id:'melancia'},purchaseMode:'unit',quantity:1},
  ];
  expect(countCartItems(cart)).toBe(4);
  expect(cart.reduce((total,line)=>total+line.quantity,0)).toBe(703);
 });
 it('não conta duas opções de compra do mesmo produto como dois itens',()=>{
  expect(countCartItems([
   {product:{id:'banana'},purchaseMode:'weight',quantity:400},
   {product:{id:'banana'},purchaseMode:'unit',quantity:2},
  ])).toBe(1);
 });
 it('atualiza o indicador quando a cesta fica vazia',()=>{
  expect(countCartItems([])).toBe(0);
  expect(countCartItems([{product:{id:'banana'},quantity:100}])).toBe(1);
 });
});
