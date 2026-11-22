import {describe,it,expect,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import StoreShareButton from '../src/web/StoreShareButton';
import {shareStore,storeShareUrl} from '../src/web/store-sharing';
describe('compartilhamento da vitrine',()=>{
 it('exibe botão com ícone e nome acessível, mesmo em páginas no celular',()=>{
  const html=renderToStaticMarkup(createElement(StoreShareButton,{storeName:'Verdurão Braga'}));
  expect(html).toContain('Compartilhar loja Verdurão Braga');
  expect(html).toContain('store-share-trigger');
 });
 it('compartilha o endereço original da loja sem busca nem fragmentos',()=>{
  expect(storeShareUrl({origin:'https://verdurao-braga.crjornada.com',pathname:'/'})).toBe('https://verdurao-braga.crjornada.com/');
  expect(storeShareUrl({origin:'https://exemplo.com',pathname:'/loja/verdurao-braga'})).toBe('https://exemplo.com/loja/verdurao-braga');
 });
 it('usa compartilhamento nativo do celular quando disponível',async()=>{
  const share=vi.fn(async()=>{});
  const clipboard={writeText:vi.fn(async()=>{})};
  expect(await shareStore({share,clipboard},'Verdurão Braga','https://exemplo.com/')).toBe('shared');
  expect(share).toHaveBeenCalledWith({title:'Verdurão Braga',text:expect.stringContaining('Verdurão Braga'),url:'https://exemplo.com/'});
  expect(clipboard.writeText).not.toHaveBeenCalled();
 });
 it('copia o link em navegadores sem compartilhamento nativo',async()=>{
  const clipboard={writeText:vi.fn(async()=>{})};
  expect(await shareStore({clipboard},'Loja','https://exemplo.com/')).toBe('copied');
  expect(clipboard.writeText).toHaveBeenCalledWith('https://exemplo.com/');
 });
 it('não copia se o usuário cancelar o compartilhamento e permite cópia manual se necessário',async()=>{
  const clipboard={writeText:vi.fn(async()=>{})};
  expect(await shareStore({share:async()=>{throw {name:'AbortError'};},clipboard},'Loja','https://exemplo.com/')).toBe('cancelled');
  expect(clipboard.writeText).not.toHaveBeenCalled();
  expect(await shareStore({},'Loja','https://exemplo.com/')).toBe('manual');
  expect(await shareStore({clipboard:{writeText:async()=>{throw Error('Sem permissão');}}},'Loja','https://exemplo.com/')).toBe('manual');
 });
});
