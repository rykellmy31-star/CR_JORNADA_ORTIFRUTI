import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {isTouchZoomGesture} from '../src/web/mobile-viewport';

describe('Correção de zoom involuntário e tela deslocada no iPhone',()=>{
 it('não bloqueia scroll com um dedo nem a interação normal',()=>{
   expect(isTouchZoomGesture(1,true)).toBe(false);
   expect(isTouchZoomGesture(0,true)).toBe(false);
   expect(isTouchZoomGesture(2,false)).toBe(false);
 });
 it('bloqueia a pinça em dispositivo móvel',()=>{
   expect(isTouchZoomGesture(2,true)).toBe(true);
   expect(isTouchZoomGesture(3,true)).toBe(true);
 });
 it('instala proteção Safari e define viewport sem zoom do navegador',()=>{
   const html=readFileSync('index.html','utf8');
   expect(html).toMatch(/name="viewport"/);
   expect(html).toMatch(/width=device-width/);
   expect(html).toMatch(/maximum-scale=1/);
   expect(html).toMatch(/user-scalable=no/);
   const main=readFileSync('src/web/main.tsx','utf8');
   expect(main).toContain('installMobileViewportGuards()');
   const src=readFileSync('src/web/mobile-viewport.ts','utf8');
   expect(src).toContain("'gesturestart'");
   expect(src).toContain("'touchmove'");
   expect(src).toContain('passive:false');
 });
 it('impede transbordamento horizontal sem bloquear o swipe das categorias',()=>{
   const css=readFileSync('src/web/styles.css','utf8');
   expect(css).toMatch(/overflow-x:clip/);
   expect(css).toContain('.category-chips,.filter-scroll,.table-wrap{touch-action:pan-x pan-y}');
   expect(css).toContain('font-size:16px!important');
 });
});
