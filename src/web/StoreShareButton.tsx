import {useState} from 'react';
import {Check,Copy,Share2,X} from 'lucide-react';
import {shareStore,storeShareUrl,type ShareOutcome} from './store-sharing';
export default function StoreShareButton({storeName}:{storeName:string}){
 const [status,setStatus]=useState<ShareOutcome|null>(null);
 const [link,setLink]=useState('');
 async function onShare(){
  const url=storeShareUrl(window.location);
  setLink(url);
  setStatus(null);
  const result=await shareStore(navigator,storeName,url);
  if(result!=='shared'&&result!=='cancelled')setStatus(result);
 }
 async function copyAgain(){
  try{await navigator.clipboard.writeText(link);setStatus('copied');}
  catch{setStatus('manual');}
 }
 return <div className="store-share">
  <button type="button" className="store-share-trigger" onClick={onShare} title={'Compartilhar '+storeName} aria-label={'Compartilhar loja '+storeName}>
   <Share2 size={19} aria-hidden="true"/><span>Compartilhar</span>
  </button>
  {status&&<div className="store-share-popover" role="status">
   <button type="button" className="store-share-close" onClick={()=>setStatus(null)} aria-label="Fechar aviso de compartilhamento"><X size={15}/></button>
   {status==='copied'?<><Check size={18} aria-hidden="true"/><strong>Link da loja copiado!</strong><small>Envie para seus amigos pelo WhatsApp ou onde preferir.</small></>
    :<><Copy size={18} aria-hidden="true"/><strong>Copie o link da loja</strong><small>Selecione e copie para enviar aos seus amigos.</small><input aria-label="Endereço da loja para copiar" readOnly value={link} onFocus={e=>e.currentTarget.select()} onClick={e=>e.currentTarget.select()}/><button type="button" className="store-share-copy" onClick={copyAgain}>Copiar link</button></>}
  </div>}
 </div>;
}
