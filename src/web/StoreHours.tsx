import {getStoreStatus,parseBusinessHours,WEEKDAYS,type StoreStatus,type StoreSchedule} from '../shared/store-hours';
export function StoreStatusNotice({status}:{status:StoreStatus}){
 return <div className={'store-status-notice '+(status.open?'is-open':'is-closed')} role="status">
  <span className="store-status-dot" aria-hidden="true"/><strong>{status.label}</strong>
  {!status.open&&<small>Você pode consultar os produtos, mas os pedidos estão temporariamente suspensos.</small>}
 </div>;
}
export function StoreScheduleEditor({value,onChange,manualOpen,businessHours=''}:{value:StoreSchedule;onChange:(v:StoreSchedule)=>void;manualOpen:boolean;businessHours?:string}){
 const update=(i:number,patch:Partial<StoreSchedule['days'][number]>)=>onChange({...value,days:value.days.map((d,j)=>j===i?{...d,...patch}:d)});
 let preview:StoreStatus;
 try{preview=getStoreStatus(manualOpen,value,new Date(),businessHours);}catch{preview={open:false,label:'Confira os horários',reason:'schedule',nextOpening:null};}
 const recognizedText=parseBusinessHours(businessHours);
 return <div className="store-schedule-editor">
  <label className="check-row"><input type="checkbox" checked={value.enabled} onChange={e=>onChange(e.target.checked?(recognizedText||{...value,enabled:true}):{...value,enabled:false})}/> Personalizar os horários por dia da semana</label>
  <small>Horário de Brasília. A chave “Permitir funcionamento” fecha a loja manualmente, mesmo dentro do horário.</small>
  {!value.enabled&&recognizedText&&<small className="store-hours-hint">Os horários exibidos em “Contato e funcionamento” já controlam automaticamente a abertura e o fechamento. Ative a personalização para editar cada dia.</small>}
  {!value.enabled&&!recognizedText&&<small className="store-hours-warning">Horário não reconhecido. Para automatizar, use “Seg a Sáb: 07h às 19h • Dom: 07h às 13h” ou ative a personalização por dia.</small>}
  {value.enabled&&<small className="store-hours-hint">Esta agenda detalhada será exibida na vitrine, substituindo o texto de horário cadastrado.</small>}
  {value.enabled&&<>{[1,2,3,4,5,6,0].map(i=>{const d=value.days[i];return <div key={i} className="store-schedule-day">
   <label className="check-row"><input type="checkbox" checked={d.enabled} onChange={e=>update(i,{enabled:e.target.checked})}/>{WEEKDAYS[i]}</label>
   {d.enabled?<div className="store-schedule-times"><label>Abre<input aria-label={'Abertura '+WEEKDAYS[i]} type="time" required value={d.open} onChange={e=>update(i,{open:e.target.value})}/></label><label>Fecha<input aria-label={'Fechamento '+WEEKDAYS[i]} type="time" required value={d.close} onChange={e=>update(i,{close:e.target.value})}/></label></div>:<small>Fechado</small>}
  </div>})}<small>Se o horário de fechamento for anterior ao de abertura, o funcionamento segue até o dia seguinte.</small></>}
  <StoreStatusNotice status={preview}/>
 </div>;
}
