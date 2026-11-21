/** Consulta pública à última versão assinada do aplicativo Android.
 * A fonte é uma release pública com nome reservado para a ponte de impressão.
 * Não anuncia artifacts de Actions nem APKs unsigned/debug.
 */
export interface AndroidUpdate {
 available:boolean;
 versionCode?:number;
 versionName?:string;
 apkUrl?:string;
 sha256?:string;
 sizeBytes?:number;
 releaseNotes?:string;
}
const RELEASE_PREFIX='cr-express-print-v';
const APK_NAME='cr-jornada-express-impressao.apk';
const REPOSITORY='rykellmy31-star/CR_JORNADA_ORTIFRUTI';
const RELEASE_API='https://api.github.com/repos/'+REPOSITORY+'/releases?per_page=30';
let memo:{until:number;value:AndroidUpdate}|null=null;

export function parseAndroidRelease(releases:unknown):AndroidUpdate {
 if(!Array.isArray(releases))return {available:false};
 const matched=releases.map((r:any)=>{
  const match=typeof r?.tag_name==='string'
   ?/^cr-express-print-v([0-9]{1,9})$/.exec(r.tag_name):null;
  if(!match||r.draft||!r.published_at)return null;
  const code=Number(match[1]);
  if(!Number.isSafeInteger(code)||code<1)return null;
  const asset=Array.isArray(r.assets)
   ?r.assets.find((a:any)=>a?.name===APK_NAME):null;
  const url=asset?.browser_download_url;
  const expected='https://github.com/'+REPOSITORY+'/releases/download/'+r.tag_name+'/'+APK_NAME;
  if(url!==expected||!Number.isSafeInteger(asset.size)||asset.size<1024||asset.size>50_000_000)return null;
  const note=typeof r.body==='string'?r.body:'';
  // O CI publica checksum da própria build, não aceita URL arbitrária nas notas.
  const shaMatch=/^SHA256: ([a-f0-9]{64})\s*$/im.exec(note);
  if(!shaMatch)return null;
  return {
   available:true,versionCode:code,versionName:'1.0.'+code,
   apkUrl:url,sha256:shaMatch[1].toLowerCase(),sizeBytes:asset.size,
   releaseNotes:'Nova versão do aplicativo de impressão CR Jornada Express.'
  } as AndroidUpdate;
 }).filter((x):x is AndroidUpdate=>x!==null);
 matched.sort((a,b)=>(b.versionCode||0)-(a.versionCode||0));
 return matched[0]||{available:false};
}

export async function latestAndroidUpdate():Promise<AndroidUpdate>{
 if(memo&&Date.now()<memo.until)return memo.value;
 const response=await fetch(RELEASE_API,{
  headers:{'Accept':'application/vnd.github+json',
   'User-Agent':'CR-Jornada-Express-Android-Updates',
   'X-GitHub-Api-Version':'2022-11-28'}
 });
 if(!response.ok)throw new Error('Erro consultando versões publicadas ('+response.status+').');
 const parsed=parseAndroidRelease(await response.json());
 memo={until:Date.now()+5*60_000,value:parsed};
 return parsed;
}
