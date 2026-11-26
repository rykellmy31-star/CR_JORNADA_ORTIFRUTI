import {describe,it,expect} from 'vitest';
import {calculateCardFeeCents,calculateDeliveryFeeCents} from '../src/shared/pricing';

describe('taxa de cartão por estabelecimento',()=>{
 it('calcula débito e crédito em centavos com arredondamento half-up',()=>{
  expect(calculateCardFeeCents(10000,200)).toBe(200);
  expect(calculateCardFeeCents(10000,400)).toBe(400);
  expect(calculateCardFeeCents(10001,250)).toBe(250);
 });
 it('não cobra quando repasse está desligado ou taxa é zero',()=>{
  expect(calculateCardFeeCents(10000,400,false)).toBe(0);
  expect(calculateCardFeeCents(10000,0,true)).toBe(0);
 });
 it('rejeita percentuais ou bases inválidas',()=>{
  expect(()=>calculateCardFeeCents(-1,100)).toThrow();
  expect(()=>calculateCardFeeCents(10000,10001)).toThrow();
 });
});

describe('frete no checkout com taxa de cartão',()=>{
 it('distingue frete grátis desde zero de limite não cadastrado',()=>{
  expect(calculateDeliveryFeeCents(1000,500,0)).toBe(0);
  expect(calculateDeliveryFeeCents(1000,500,null)).toBe(500);
  expect(calculateDeliveryFeeCents(1000,500,undefined)).toBe(500);
  expect(calculateDeliveryFeeCents(999,500,1000)).toBe(500);
  expect(calculateDeliveryFeeCents(1000,500,1000)).toBe(0);
  expect(calculateCardFeeCents(1000+calculateDeliveryFeeCents(1000,500,0),400)).toBe(40);
 });
});
