/**
 * Alertas Telegram do WhatsApp (independentes das notificações aos clientes).
 * Somente o backend acessa o bot e o chat, por GitHub Secrets / Worker Secrets.
 * Transições são protegidas por UPDATE condicional + inserção no mesmo lote.
 */
import type { DbClient } from '../db/adapter';
import { runConditionalTransaction, StockConflictError } from '../db/adapter';
import { generateId } from '../security/crypto';

export interface TelegramAlertConfig {
  telegramBotToken?: string;
  telegramChatId?: string;
}
export interface WhatsAppMonitorConfig extends TelegramAlertConfig {
  evolutionApiUrl?: string;
  evolutionApiKey?: string;
}
export type DisconnectSource='panel'|'webhook'|'monitor';
export const telegramAlertsConfigured=(cfg:TelegramAlertConfig)=>
  Boolean(cfg.telegramBotToken?.trim()&&cfg.telegramChatId?.trim());

/**
 * Registra uma única ocorrência quando a conexão realmente muda de conectada
 * para desconectada. Webhook repetido e desconexão manual simultânea não geram
 * notificações duplicadas. Nunca sinaliza desconexão em primeira instalação.
 */
export async function recordWhatsAppDisconnection(
  db:DbClient,tenantId:string,source:DisconnectSource
):Promise<boolean>{
  const inst=await db.prepare(`SELECT instance_name,status FROM whatsapp_instances
    WHERE tenant_id=?`).bind(tenantId).first<{instance_name:string;status:string}>();
  if(!inst || inst.status!=='connected')return false;
  const now=new Date().toISOString();
  try{
    await runConditionalTransaction(db,[
      {
        stmt:db.prepare(`UPDATE whatsapp_instances SET status='disconnected',
          connected_phone=NULL,profile_name=NULL,connected_at=NULL,
          qr_code_base64=NULL,qr_code_text=NULL,provider_mode='evolution_live',
          last_checked_at=?,updated_at=? WHERE tenant_id=? AND status='connected'`)
          .bind(now,now,tenantId),
        requireChanges:1,
        failErrorMessage:'Instância já havia sido desconectada por outra solicitação.'
      },{
        stmt:db.prepare(`INSERT INTO whatsapp_disconnect_alerts
          (id,tenant_id,instance_name,source,status,attempts,next_retry_at,created_at,updated_at)
          VALUES(?,?,?,?,'pending',0,?,?,?)`)
          .bind(generateId(),tenantId,inst.instance_name,source,now,now,now)
      }
    ]);
    return true;
  }catch(err){
    if(err instanceof StockConflictError)return false;
    throw err;
  }
}

interface AlertRow {
 id:string;tenant_id:string;instance_name:string;source:DisconnectSource;
 attempts:number;created_at:string;tenant_name:string;
}
export function formatDisconnectTelegramAlert(row:AlertRow):string{
  const origin=row.source==='panel'?'Desconexão pelo painel':
    row.source==='webhook'?'Detectada pela Evolution (webhook)':'Detectada pelo monitor automático';
  const date=new Date(row.created_at).toLocaleString('pt-BR',{
    timeZone:'America/Bahia',dateStyle:'short',timeStyle:'medium'
  });
  return [
    '🚨 CR JORNADA HORTIFRUTI — WHATSAPP DESCONECTADO',
    '',
    '🏪 Estabelecimento: '+row.tenant_name,
    '📱 Instância: '+row.instance_name,
    '🔎 Origem: '+origin,
    '🕒 Horário (Bahia): '+date,
    '',
    '⚠️ Verifique a conexão na aba WhatsApp do painel e leia o QR Code novamente.'
  ].join('\n');
}

export async function processPendingTelegramAlerts(
  db:DbClient,cfg:TelegramAlertConfig,limit=20
):Promise<{processed:number;sent:number;configured:boolean}>{
  if(!telegramAlertsConfigured(cfg))return {processed:0,sent:0,configured:false};
  const now=new Date().toISOString();
  const {results}=await db.prepare(`SELECT a.id,a.tenant_id,a.instance_name,a.source,
    a.attempts,a.created_at,t.name AS tenant_name FROM whatsapp_disconnect_alerts a
    JOIN tenants t ON t.id=a.tenant_id
    WHERE a.status='pending' AND a.attempts<6
      AND (a.next_retry_at IS NULL OR a.next_retry_at<=?)
    ORDER BY a.created_at ASC LIMIT ?`)
    .bind(now,Math.max(1,Math.min(50,limit))).all<AlertRow>();
  let sent=0;
  for(const alert of results){
    const attempts=alert.attempts+1;
    try{
      const response=await fetch('https://api.telegram.org/bot'+cfg.telegramBotToken+'/sendMessage',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          chat_id:cfg.telegramChatId,
          text:formatDisconnectTelegramAlert(alert),
          disable_web_page_preview:true
        })
      });
      // HTTP 200 sem ok=true não significa entrega aceita pelo Telegram.
      const payload=await response.json().catch(()=>({})) as {ok?:boolean};
      if(!response.ok||payload.ok!==true)throw new Error('Telegram rejeitou o alerta (HTTP '+response.status+').');
      await db.prepare(`UPDATE whatsapp_disconnect_alerts
        SET status='sent',attempts=?,sent_at=?,next_retry_at=NULL,
            last_error=NULL,updated_at=? WHERE id=? AND status='pending'`)
        .bind(attempts,new Date().toISOString(),new Date().toISOString(),alert.id).run();
      sent++;
    }catch{
      const retry=new Date(Date.now()+Math.min(1800000,120000*Math.pow(2,attempts-1))).toISOString();
      await db.prepare(`UPDATE whatsapp_disconnect_alerts
        SET status=?,attempts=?,next_retry_at=?,last_error=?,updated_at=?
        WHERE id=? AND status='pending'`)
        .bind(attempts>=6?'failed':'pending',attempts,attempts>=6?null:retry,
          'Falha ao entregar alerta. Verifique bot, chat ID e permissões.',
          new Date().toISOString(),alert.id).run();
    }
  }
  return {processed:results.length,sent,configured:true};
}

/** Verificação a cada 2 minutos. Não alerta por falhas de rede nem status transitório. */
export async function monitorWhatsAppDisconnections(
  db:DbClient,cfg:WhatsAppMonitorConfig,limit=40
):Promise<number>{
  if(!cfg.evolutionApiUrl||!cfg.evolutionApiKey)return 0;
  const {results:connections}=await db.prepare(`SELECT tenant_id,instance_name
    FROM whatsapp_instances WHERE status='connected' ORDER BY tenant_id LIMIT ?`)
    .bind(Math.min(Math.max(limit,1),100)).all<{tenant_id:string;instance_name:string}>();
  let detected=0;
  for(const instance of connections){
    try{
      const resp=await fetch(cfg.evolutionApiUrl.replace(/\/+$/,'')+
        '/instance/connectionState/'+encodeURIComponent(instance.instance_name),
        {headers:{apikey:cfg.evolutionApiKey}});
      if(!resp.ok)continue;
      const raw=await resp.json() as any;
      const state=String(raw?.instance?.state||raw?.state||'').toLowerCase();
      if(['close','closed','disconnected'].includes(state)){
        if(await recordWhatsAppDisconnection(db,instance.tenant_id,'monitor'))detected++;
      }
    }catch{
      // Instabilidade da Evolution não é prova de desconexão; evita alarme falso.
    }
  }
  return detected;
}
