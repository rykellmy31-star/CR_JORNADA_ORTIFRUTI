import {useEffect,useState} from 'react';
import {Gift,Check,Search} from 'lucide-react';
import {formatBRL,parseBRLToCents} from '../shared/pricing';
import {defaultLoyalty,loyaltyGap,type LoyaltyConfig} from '../shared/loyalty';
export function LoyaltyNotice({config,subtotal}:{config?:LoyaltyConfig|null;subtotal:number}){
 if(!config?.enabled)return null;
 const gap=loyaltyGap(config,subtotal)!;
 return <div className="loyalty-notice" role="status"><Gift size={22} aria-hidden="true"/><div>
 <b>{gap>0?'Faltam '+formatBRL(gap)+' para ganhar 1 ponto fidelidade!':'Você garantirá 1 ponto fidelidade nesta compra!'}</b>
 <small>{gap>0?'Adicione mais produtos e fique mais perto do seu prêmio.':'O ponto será confirmado quando o pedido for entregue.'}</small>
 <div className="loyalty-progress" aria-hidden="true"><span style={{width:Math.min(100,subtotal/config.minimumCents*100)+'%'}}/></div>
 <small>{config.goal} ponto(s) = {config.reward} 🎁</small>
 </div></div>;
}
type Account={customer_id:string;name:string;phone:string;progress:number;goal:number;reward_name:string;total_points:number};
type Reward={id:string;name:string;phone:string;reward_name:string;points_used:number;created_at:string;redeemed_at:string|null};
type Data={config:LoyaltyConfig;accounts:Account[];rewards:Reward[]};
export function LoyaltyPanel({request}:{request:(path:string,options?:RequestInit)=>Promise<any>}){
 const [data,setData]=useState<Data|null>(null),[config,setConfig]=useState(defaultLoyalty),[minimum,setMinimum]=useState('40,00'),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[search,setSearch]=useState('');
 async function load(){const x:Data=await request('/admin/loyalty');setData(x);setConfig(x.config);setMinimum((x.config.minimumCents/100).toFixed(2).replace('.',','));}
 useEffect(()=>{load().catch(e=>setError(e.message));},[]);
 async function save(e:React.FormEvent){e.preventDefault();setBusy(true);setError('');setNotice('');try{await request('/admin/loyalty',{method:'PUT',body:JSON.stringify({...config,minimumCents:parseBRLToCents(minimum)})});await load();setNotice('Programa de fidelidade atualizado.');}catch(e:any){setError(e.message);}finally{setBusy(false);}}
 async function redeem(id:string){if(!window.confirm('Confirmar que o prêmio foi entregue ao cliente?'))return;setBusy(true);setError('');try{await request('/admin/loyalty/rewards/'+id+'/redeem',{method:'POST',body:'{}'});await load();setNotice('Resgate registrado.');}catch(e:any){setError(e.message);}finally{setBusy(false);}}
 const matches=(x:{name:string;phone:string})=>(x.name+' '+x.phone).toLowerCase().includes(search.toLowerCase());
 return <div className="loyalty-page">
 <div className="page-head"><div><span className="eyebrow">RELACIONAMENTO</span><h1>Fidelidade</h1><p>Incentive novas compras e premie seus clientes.</p></div></div>
 {error&&<div className="error-banner">{error}</div>}{notice&&<div className="success-banner" role="status">{notice}</div>}
 <form className="panel-card settings-card" onSubmit={save}>
 <div className="settings-toggle"><span><b>Programa de fidelidade {config.enabled?'ativo':'desativado'}</b><small>Ative para divulgar o programa e pontuar novas compras.</small></span><label className="switch"><input type="checkbox" checked={config.enabled} onChange={e=>setConfig({...config,enabled:e.target.checked})}/><span/></label></div>
 <div className="form-grid"><label>Valor mínimo por compra (R$)<input required value={minimum} inputMode="decimal" onChange={e=>setMinimum(e.target.value)}/></label>
 <label>Pontos para ganhar prêmio<input required type="number" min={1} max={100} value={config.goal} onChange={e=>setConfig({...config,goal:Number(e.target.value)})}/></label>
 <label className="full">Qual é o prêmio?<input required maxLength={150} value={config.reward} onChange={e=>setConfig({...config,reward:e.target.value})}/></label></div>
 <small>1 ponto por pedido entregue que atinja o mínimo nos produtos, após descontos e sem frete. Pedidos cancelados não pontuam. O ciclo em andamento mantém a meta e o prêmio prometidos. Pausar o programa não apaga pontos nem prêmios.</small>
 <button type="submit" className="btn btn-primary" disabled={busy||!data}><Check size={16}/> Salvar regras</button>
 </form>
 <div className="panel-card toolbar"><div className="store-search"><Search size={16}/><input placeholder="Buscar cliente pelo nome ou telefone" value={search} onChange={e=>setSearch(e.target.value)}/></div></div>
 <section className="panel-card"><div className="panel-heading"><h2>Progresso dos clientes</h2></div><div className="table-wrap"><table><thead><tr><th>Cliente</th><th>Pontos no ciclo</th><th>Prêmio</th><th>Total acumulado</th></tr></thead><tbody>{(data?.accounts||[]).filter(matches).map(a=><tr key={a.customer_id}><td><b>{a.name}</b><small className="cell-sub">{a.phone}</small></td><td>{a.progress} / {a.goal}</td><td>{a.reward_name}</td><td>{a.total_points}</td></tr>)}</tbody></table></div>{!data?.accounts.length&&<div className="empty-table">Nenhum ponto registrado ainda.</div>}</section>
 <section className="panel-card"><div className="panel-heading"><h2>Prêmios conquistados</h2></div><div className="table-wrap"><table><thead><tr><th>Cliente</th><th>Prêmio</th><th>Situação</th><th>Ação</th></tr></thead><tbody>{(data?.rewards||[]).filter(matches).map(r=><tr key={r.id}><td><b>{r.name}</b><small className="cell-sub">{r.phone}</small></td><td>{r.reward_name}</td><td>{r.redeemed_at?'Resgatado':'Disponível'}</td><td>{!r.redeemed_at&&<button className="btn btn-xs btn-outline" disabled={busy} onClick={()=>redeem(r.id)}>Registrar resgate</button>}</td></tr>)}</tbody></table></div>{!data?.rewards.length&&<div className="empty-table">Nenhum prêmio conquistado ainda.</div>}</section>
 </div>;
}
