import {useEffect,useState} from 'react';
import {ArrowDown,ArrowUp,Image as ImageIcon,Plus,Trash2} from 'lucide-react';
import {prepareBrandImage,IMAGE_ACCEPT} from './image-upload';

type Banner={id:string;image_url:string;mobile_image_url:string|null;sort_order:number;is_active:number};

function withTimeout<T>(promise:Promise<T>,ms:number,message:string):Promise<T>{
 let timer:number|undefined;
 return Promise.race([
  promise,
  new Promise<T>((_,reject)=>{timer=window.setTimeout(()=>reject(new Error(message)),ms);})
 ]).finally(()=>{if(timer!==undefined)window.clearTimeout(timer);});
}

async function api(path:string,token:string,method='GET',body?:unknown,timeoutMs=45000){
 const controller=new AbortController();
 const timer=window.setTimeout(()=>controller.abort(),timeoutMs);
 try{
  const response=await fetch('/api/admin/'+path,{
   method,signal:controller.signal,
   headers:{Authorization:'Bearer '+token,...(body===undefined?{}:{'Content-Type':'application/json'})},
   body:body===undefined?undefined:JSON.stringify(body)
  });
  const data:any=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||`O servidor recusou a operação (HTTP ${response.status}).`);
  return data;
 }catch(error:any){
  if(error?.name==='AbortError')throw new Error('O servidor demorou mais que 45 segundos para responder. Tente novamente; a tela não ficará presa em Enviando.');
  if(error instanceof TypeError)throw new Error('Falha de conexão com o servidor durante o envio. Verifique a internet e tente novamente.');
  throw error;
 }finally{window.clearTimeout(timer);}
}

/** Banners próprios de cada estabelecimento, com etapas e falhas de envio visíveis. */
export default function CarouselManager({token}:{token:string}){
 const [banners,setBanners]=useState<Banner[]>([]);
 const [busy,setBusy]=useState('');
 const [phase,setPhase]=useState('');
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 async function refresh(){
  const result=await api('banners',token);
  setBanners(result.banners||[]);
 }
 useEffect(()=>{void refresh().catch(e=>setError(e.message));},[token]);

 async function upload(e:React.ChangeEvent<HTMLInputElement>,mode:'new'|'desktop'|'mobile',id?:string){
  const input=e.currentTarget,file=input.files?.[0];
  if(!file)return;
  setError('');setNotice('');setBusy(id||'new');
  try{
   setPhase('Preparando imagem…');
   const dataUri=await withTimeout(
    prepareBrandImage(file,'banner'),30000,
    'A preparação da imagem demorou mais de 30 segundos. Tente uma imagem JPG ou PNG menor.'
   );
   setPhase('Enviando imagem…');
   const result=await api('media/upload',token,'POST',{dataUri,folder:'banners'},45000);
   setPhase('Salvando banner…');
   if(mode==='new')await api('banners',token,'POST',{imageUrl:result.url},20000);
   else await api('banners/'+id,token,'PATCH',mode==='mobile'?{mobileImageUrl:result.url}:{imageUrl:result.url},20000);
   setPhase('Atualizando vitrine…');
   await refresh();
   setNotice('Banner salvo e atualizado na vitrine!');
  }catch(err:any){
   setError(err.message||'Não foi possível enviar o banner. Tente novamente.');
  }finally{
   input.value='';
   setBusy('');
   setPhase('');
  }
 }

 async function edit(banner:Banner,action:'up'|'down'|'toggle'|'delete'|'clear-mobile'){
  if(action==='delete'&&!window.confirm('Excluir este banner da vitrine?'))return;
  setBusy(banner.id);setError('');setNotice('');setPhase('Atualizando banner…');
  try{
   if(action==='delete')await api('banners/'+banner.id,token,'DELETE',undefined,20000);
   else await api('banners/'+banner.id,token,'PATCH',
    action==='toggle'?{active:!banner.is_active}:
    action==='clear-mobile'?{mobileImageUrl:null}:{direction:action},20000);
   await refresh();
   setNotice('Banners atualizados na vitrine.');
  }catch(err:any){setError(err.message||'Não foi possível alterar o banner.');}
  finally{setBusy('');setPhase('');}
 }

 const addLabel=busy==='new'?(phase||'Enviando…'):'Adicionar banner';
 return <section className="panel-card settings-card banner-manager-panel" aria-label="Carrossel de banners">
  <div className="panel-heading"><div><h2>Banners da vitrine</h2>
   <p>Carrossel automático a cada 6 segundos, com ordem editável.</p></div><ImageIcon size={19}/></div>
  <p className="banner-manager-help">A arte aparece inteira, sem cortes ou textos por cima.
   Dimensões indicadas: <b>computador 1800 × 600 px (3:1)</b> e
   <b> celular 1080 × 810 px (4:3)</b>. A imagem exclusiva para celular é opcional.
   Até 10 banners.</p>
  {error&&<div className="error-banner" role="alert">{error}</div>}
  {notice&&<div className="success-banner" role="status">{notice}</div>}
  <label className="banner-manager-add"><Plus size={17}/> {addLabel}
   <input type="file" accept={IMAGE_ACCEPT} aria-label="Adicionar banner principal"
    disabled={!!busy||banners.length>=10} onChange={e=>upload(e,'new')}/>
  </label>
  {banners.length===0&&<p className="banner-manager-message">Nenhum banner cadastrado. A vitrine exibe a imagem padrão.</p>}
  <div className="banner-manager-list">{banners.map((banner,i)=>
   <div key={banner.id} className="banner-manager-row">
    <div className="banner-manager-preview">
     <img src={banner.image_url} alt={`Prévia do banner ${i+1}`}/>
     <span>{i+1}º banner · {banner.is_active?'Visível':'Oculto'}</span>
    </div>
    <div className="banner-manager-actions">
     <button type="button" className="btn btn-xs btn-outline" disabled={!!busy||i===0}
      onClick={()=>edit(banner,'up')}><ArrowUp size={14}/> Subir</button>
     <button type="button" className="btn btn-xs btn-outline" disabled={!!busy||i===banners.length-1}
      onClick={()=>edit(banner,'down')}><ArrowDown size={14}/> Descer</button>
     <button type="button" className="btn btn-xs btn-outline" disabled={!!busy}
      onClick={()=>edit(banner,'toggle')}>{banner.is_active?'Ocultar':'Mostrar'}</button>
     <button type="button" className="btn btn-xs btn-outline" disabled={!!busy}
      onClick={()=>edit(banner,'delete')}><Trash2 size={14}/> Excluir</button>
    </div>
    <div className="banner-manager-uploads">
     <label>Trocar imagem principal
      <input type="file" accept={IMAGE_ACCEPT} disabled={!!busy} onChange={e=>upload(e,'desktop',banner.id)}/>
     </label>
     <label>Imagem para celular (opcional)
      <input type="file" accept={IMAGE_ACCEPT} disabled={!!busy} onChange={e=>upload(e,'mobile',banner.id)}/>
     </label>
     {banner.mobile_image_url&&<div className="banner-manager-mobile">
      <img src={banner.mobile_image_url} alt={`Prévia da versão para celular ${i+1}`}/>
      <button type="button" className="btn btn-xs btn-outline" disabled={!!busy}
       onClick={()=>edit(banner,'clear-mobile')}>Remover versão para celular</button>
     </div>}
    </div>
   </div>)}</div>
 </section>;
}
