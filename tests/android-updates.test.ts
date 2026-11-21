import {describe,it,expect} from 'vitest';
import {parseAndroidRelease} from '../src/server/services/android-updates';

const repo='rykellmy31-star/CR_JORNADA_ORTIFRUTI';
const sha='a'.repeat(64);
function release(code:number,extra:Record<string,unknown>={}){
 const tag='cr-express-print-v'+code;
 return {
  tag_name:tag,draft:false,prerelease:true,published_at:'2026-11-21T15:00:00Z',
  body:'Atualização oficial.\n\nSHA256: '+sha,
  assets:[{name:'cr-jornada-express-impressao.apk',size:22421,
   browser_download_url:'https://github.com/'+repo+'/releases/download/'+tag+'/cr-jornada-express-impressao.apk'}],
  ...extra
 };
}
describe('canal de atualizações Android',()=>{
 it('seleciona maior versionCode para o APK assinado sem confundir outras releases',()=>{
  const result=parseAndroidRelease([
   release(200025),release(200030),{...release(200099),tag_name:'outro-produto-v200099'},release(200022)]);
  expect(result.available).toBe(true);
  expect(result.versionCode).toBe(200030);
  expect(result.sha256).toBe(sha);
  expect(result.apkUrl).toBe('https://github.com/'+repo+
   '/releases/download/cr-express-print-v200030/cr-jornada-express-impressao.apk');
 });
 it('ignora release sem checksum, em rascunho, com URL desconhecida ou APK muito grande',()=>{
  const bad=[
   release(200040,{body:'Sem checksum'}),
   release(200041,{draft:true}),
   release(200042,{assets:[{name:'cr-jornada-express-impressao.apk',size:25000,
    browser_download_url:'https://example.com/falso.apk'}]}),
   release(200043,{assets:[{name:'cr-jornada-express-impressao.apk',size:50000001,
    browser_download_url:'https://github.com/'+repo+
     '/releases/download/cr-express-print-v200043/cr-jornada-express-impressao.apk'}]})
  ];
  expect(parseAndroidRelease(bad)).toEqual({available:false});
 });
 it('sem release assinada devolve nenhum update e não publica build debug',()=>{
  expect(parseAndroidRelease([])).toEqual({available:false});
  expect(parseAndroidRelease(null)).toEqual({available:false});
  expect(parseAndroidRelease([{tag_name:'debug-1'}])).toEqual({available:false});
 });
});
