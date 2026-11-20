import {describe,expect,it} from 'vitest';
import {countCartItems,removeCartSelection} from '../src/shared/cart';

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


describe('botão Remover da cesta',()=>{
 it('remove o item completo sem precisar reduzir 12 unidades uma por uma',()=>{
  const banana={product:{id:'banana'},purchaseMode:'unit',quantity:12};
  const melancia={product:{id:'melancia'},purchaseMode:'unit',quantity:1};
  const updated=removeCartSelection([banana,melancia],banana);
  expect(updated).toEqual([melancia]);
  expect(countCartItems(updated)).toBe(1);
 });
 it('remove somente a modalidade selecionada, preservando outras do mesmo produto',()=>{
  const peso={product:{id:'banana'},purchaseMode:'weight',quantity:400};
  const unidades={product:{id:'banana'},purchaseMode:'unit',quantity:2};
  expect(removeCartSelection([peso,unidades],peso)).toEqual([unidades]);
 });
 it('permite esvaziar a cesta e zera o contador',()=>{
  const item={product:{id:'banana'},purchaseMode:'weight',quantity:400};
  const updated=removeCartSelection([item],item);
  expect(updated).toEqual([]);
  expect(countCartItems(updated)).toBe(0);
 });
 it('preserva outra embalagem do mesmo produto',()=>{
  const cartela={product:{id:'ovos'},variant:{id:'30'},purchaseMode:'variants',quantity:1};
  const duzia={product:{id:'ovos'},variant:{id:'12'},purchaseMode:'variants',quantity:2};
  expect(removeCartSelection([cartela,duzia],cartela)).toEqual([duzia]);
 });
});
