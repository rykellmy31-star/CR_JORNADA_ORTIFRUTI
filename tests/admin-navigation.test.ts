import {describe,it,expect} from 'vitest';
import {readAdminSection,adminSectionParams,readWhatsAppTab,whatsAppTabParams} from '../src/web/admin-navigation';

describe('navegação persistente do painel',()=>{
 it('restaura todas as abas do menu a partir da URL após atualizar',()=>{
  for(const section of ['dashboard','orders','printing','products','categories','stock','customers','loyalty','reports','whatsapp','settings']){
   const next=adminSectionParams(new URLSearchParams(),section);
   expect(readAdminSection(new URLSearchParams(next.toString()))).toBe(section);
  }
 });
 it('mantém as subabas de WhatsApp ao atualizar e limpa ao trocar de seção',()=>{
  const wa=adminSectionParams(new URLSearchParams('origem=teste'),'whatsapp');
  for(const tab of ['connection','templates','auto','history']){
   const next=whatsAppTabParams(wa,tab);
   expect(readWhatsAppTab(new URLSearchParams(next.toString()))).toBe(tab);
   expect(readAdminSection(next)).toBe('whatsapp');
   expect(next.get('origem')).toBe('teste');
  }
  const history=whatsAppTabParams(wa,'history');
  const products=adminSectionParams(history,'products');
  expect(products.has('subaba')).toBe(false);
  expect(readAdminSection(products)).toBe('products');
  expect(history.get('subaba')).toBe('history');
 });
 it('usa a visão geral e conexão como padrões seguros para parâmetros inválidos',()=>{
  expect(readAdminSection(new URLSearchParams('aba=desconhecida'))).toBe('dashboard');
  expect(readWhatsAppTab(new URLSearchParams('subaba=desconhecida'))).toBe('connection');
  expect(adminSectionParams(new URLSearchParams('aba=products'),'inválida').get('aba')).toBe('products');
 });
});
