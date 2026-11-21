import {useEffect,useState} from 'react';
import {Bluetooth,Check,Copy,Printer,RefreshCw,ShieldCheck,Trash2,WifiOff} from 'lucide-react';

type PrintDevice={id:string;name:string;last_seen_at:string|null;created_at:string;revoked_at:string|null};
type PrintJob={id:string;order_number:number;job_type:'new_order'|'reprint';
 status:'queued'|'leased'|'printed'|'failed';attempts:number;created_at:string;
 printed_at:string|null;last_error:string|null};
type PrintData={enabled:boolean;devices:PrintDevice[];jobs:PrintJob[]};

async function api(path:string,token:string,method='GET',body?:unknown){
 const response=await fetch('/api/admin/printing'+path,{
  method,headers:{Authorization:'Bearer '+token,...(body===undefined?{}:{'Content-Type':'application/json'})},
  body:body===undefined?undefined:JSON.stringify(body)
 });
 const result:any=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(result.error||'Não foi possível atualizar a impressão.');
 return result;
}
const statusLabel:Record<PrintJob['status'],string>={
 queued:'Na fila',leased:'Enviado ao Android',printed:'Impresso',failed:'Falhou'
};
function prettyDate(value:string|null){return value?new Date(value).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}):'—';}
function isOnline(value:string|null){return !!value&&Date.now()-new Date(value).getTime()<2*60_000;}

export default function PrintingPanel({token,user}: {token:string;user:any}){
 const [data,setData]=useState<PrintData|null>(null);
 const [code,setCode]=useState(''),[expiresAt,setExpiresAt]=useState('');
 const [busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const canManage=['owner','manager'].includes(user?.role||'');
 const slug=user?.tenantSlug||'';
 async function load(){setData(await api('',token));}
 useEffect(()=>{
  let alive=true;
  api('',token).then(x=>{if(alive)setData(x)}).catch(e=>{if(alive)setError(e.message)});
  const timer=window.setInterval(()=>{api('',token).then(x=>{if(alive)setData(x)}).catch(()=>{})},12_000);
  return()=>{alive=false;window.clearInterval(timer)};
 },[token]);
 async function action(label:string,fn:()=>Promise<void>){
  setError('');setNotice('');setBusy(label);
  try{await fn();await load();}catch(e:any){setError(e.message||'Falha na impressão.')}
  finally{setBusy('');}
 }
 const generate=()=>action('pair',async()=>{
  const v=await api('/pairing-codes',token,'POST');
  setCode(v.code);setExpiresAt(v.expiresAt);
  setNotice('Código criado. Digite no aplicativo Android antes de expirar.');
 });
 const toggle=()=>action('toggle',async()=>{
  const v=await api('/settings',token,'PATCH',{enabled:!data?.enabled});
  setNotice(v.enabled?'Fila ativada: novos pedidos serão enviados ao aplicativo conectado.':'Impressão automática desativada.');
 });
 const revoke=(id:string,name:string)=>{
  if(!window.confirm('Revogar o Android '+name+'? Ele deixará de receber pedidos.'))return;
  return action('revoke',async()=>{await api('/devices/'+encodeURIComponent(id),token,'DELETE');setNotice('Dispositivo revogado.');});
 };
 const reprint=(job:PrintJob)=>{
  if(!window.confirm('Gerar uma nova comanda do pedido #'+job.order_number+'?'))return;
  return action('reprint',async()=>{
   await api('/jobs/'+encodeURIComponent(job.id)+'/reprint',token,'POST');
   setNotice('Comanda enviada à fila para reimpressão.');
  });
 };
 return <div className="print-panel">
  <div className="print-heading"><div><span className="eyebrow">CR JORNADA EXPRESS · IMPRESSÃO</span>
   <h1>Impressoras</h1><p>Conecte um celular Android à impressora Bluetooth ESC/POS e receba comandas automaticamente.</p>
  </div><Printer size={29}/></div>
  {error&&<div className="error-banner" role="alert">{error}</div>}
  {notice&&<div className="success-banner" role="status">{notice}</div>}
  <section className="panel-card print-card">
   <div className="print-card-header"><div><h2>Impressão automática</h2>
    <p>O pedido será enviado para impressão assim que o cliente finalizar a compra.</p></div>
    <span className={'print-status '+(data?.enabled?'active':'inactive')}>{data?.enabled?'Ativada':'Desativada'}</span>
   </div>
   {!data?<p>Carregando configurações…</p>:<>
    <div className="print-actions">
     <button type="button" className="btn btn-primary" disabled={!canManage||!!busy} onClick={toggle}>
      {data.enabled?'Desativar impressão':'Ativar impressão'}
     </button>
     <button type="button" className="btn btn-outline" disabled={!!busy} onClick={()=>void action('refresh',load)}>
      <RefreshCw size={15}/> Atualizar
     </button>
    </div>
    <p className="print-hint">A impressão requer o aplicativo auxiliar instalado, o Bluetooth ligado e a impressora pareada.
     O Android precisa permanecer executando o serviço de impressão. Antes de conectar, as comandas ficarão aguardando.</p>
   </>}
  </section>
  <section className="panel-card print-card">
   <div className="print-card-header"><div><h2><Bluetooth size={18}/> Parear Android</h2>
    <p>No aplicativo, informe a loja <b>{slug}</b> e o código abaixo.</p></div><ShieldCheck size={21}/>
   </div>
   <button type="button" className="btn btn-outline" disabled={!canManage||!!busy} onClick={generate}>Gerar código de pareamento</button>
   {code&&<div className="print-pair-code" role="status">
    <strong>{code}</strong><button type="button" className="btn btn-xs btn-outline" onClick={()=>navigator.clipboard?.writeText(code)}><Copy size={15}/> Copiar</button>
    <small>Válido até {prettyDate(expiresAt)}. Uso único. Não compartilhe com outras lojas.</small>
   </div>}
   <div className="print-device-list">{(data?.devices||[]).map(d=><div className="print-device-row" key={d.id}>
    <span className="print-device-icon">{d.revoked_at?<WifiOff size={20}/>:<Bluetooth size={20}/>}</span>
    <div><b>{d.name}</b><small>{d.revoked_at?'Acesso revogado':isOnline(d.last_seen_at)?'Online recentemente':'Desconectado ou aguardando comunicação'} · Último contato: {prettyDate(d.last_seen_at)}</small></div>
    {canManage&&!d.revoked_at&&<button type="button" className="btn btn-xs btn-outline" disabled={!!busy} onClick={()=>revoke(d.id,d.name)}><Trash2 size={14}/> Revogar</button>}
   </div>)}
   {data?.devices.length===0&&<p className="print-hint">Nenhum Android pareado. Gere um código para começar.</p>}</div>
  </section>
  <section className="panel-card print-card">
   <div className="print-card-header"><div><h2>Comandas recentes</h2>
    <p>Histórico de impressão apenas deste estabelecimento, atualizado automaticamente.</p></div><Check size={20}/></div>
   <div className="table-wrap"><table><thead><tr><th>Pedido</th><th>Tipo</th><th>Data</th><th>Status</th><th>Tentativas</th><th></th></tr></thead>
    <tbody>{(data?.jobs||[]).map(job=><tr key={job.id}>
     <td><b>#{job.order_number}</b>{job.last_error&&<small className="cell-sub">{job.last_error}</small>}</td>
     <td>{job.job_type==='reprint'?'Reimpressão':'Nova compra'}</td>
     <td>{prettyDate(job.created_at)}</td>
     <td><span className={'print-status '+job.status}>{statusLabel[job.status]}</span></td>
     <td>{job.attempts}</td>
     <td>{canManage&&<button type="button" className="btn btn-xs btn-outline" disabled={!!busy} onClick={()=>reprint(job)}>Reimprimir</button>}</td>
    </tr>)}</tbody></table>
    {data&&data.jobs.length===0&&<p className="print-hint">Sem comandas. A impressão começa nos pedidos novos após ativar a função.</p>}
   </div>
  </section>
 </div>;
}
