import QRCode from 'qrcode';
import {formatWhatsAppItems,orderSavings} from '../../shared/order-presentation';
import {recordWhatsAppDisconnection,processPendingTelegramAlerts,telegramAlertsConfigured} from './telegram-alerts';
import type { DbClient } from '../db/adapter';
import { generateId } from '../security/crypto';
import {
  extractFirstName,
  formatBRL,
  formatPhoneBR,
  normalizePhoneBR,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  type OrderStatus,
  type PaymentMethod,
} from '../../shared/pricing';

export type WhatsAppEventType =
  | 'order_received'
  | 'order_accepted'
  | 'order_preparing'
  | 'order_out_for_delivery'
  | 'order_delivered'
  | 'order_cancelled';

export interface EvolutionEnvConfig {
  evolutionApiUrl?: string;
  evolutionApiKey?: string;
  publicWebhookUrl?: string;
  evolutionWebhookToken?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
}

export const DEFAULT_WHATSAPP_TEMPLATES: Array<{
  event_type: WhatsAppEventType;
  title: string;
  is_enabled: number;
  message_template: string;
}> = [
  {
    event_type: 'order_received',
    title: 'Pedido recebido (Detalhes da compra)',
    is_enabled: 1,
    message_template:
      "Oba! Recebemos seu pedido! 🥳\n\n🥬 *{nome_estabelecimento}*\n\nPedido *nº {numero_pedido}*\n\n*🛒 Itens do pedido:*\n\n{itens_pedido}\n\n─────────────────\n*Subtotal:* {subtotal}\n🛵 *Entrega:* {taxa_entrega}\n💰 *Total: {valor_total}*{economia_info}\n\n─────────────────\n💳 *Pagamento:* {forma_pagamento}{troco_info}\n\n🏠 *Endereço de entrega:*\n{endereco_entrega}\n\n📋 *Status:* Pedido recebido\n\nAvisaremos você assim que seu pedido avançar para a próxima etapa.\n\nObrigado pela preferência! 💚",
  },
  {
    event_type: 'order_accepted',
    title: 'Pedido aceito (Previsão de entrega)',
    is_enabled: 1,
    message_template:
      "🥳 Oba! Seu pedido foi aceito!\n\nO seu pedido *Nº {numero_pedido}* está em preparação.\n\n⏱️ A previsão estimada é de *{previsao_entrega}* para seu pedido chegar.\n\n🥬 *{nome_estabelecimento}*",
  },
  {
    event_type: 'order_preparing',
    title: 'Pedido em Preparação',
    is_enabled: 0,
    message_template:
      'Olá, {primeiro_nome}! 🧺 Estamos separando os produtos do seu pedido *#{numero_pedido}* no *{nome_estabelecimento}*.',
  },
  {
    event_type: 'order_out_for_delivery',
    title: 'Pedido Saiu para Entrega',
    is_enabled: 1,
    message_template:
      'Olá, {primeiro_nome}! 🛵 Seu pedido *#{numero_pedido}* do *{nome_estabelecimento}* acaba de sair para entrega!\n\nEndereço: {endereco_entrega}\nTotal na entrega: *{valor_total}* ({forma_pagamento}{troco_info})\n\nEm breve estará chegando ao seu endereço!',
  },
  {
    event_type: 'order_delivered',
    title: 'Pedido Entregue',
    is_enabled: 0,
    message_template:
      'Olá, {primeiro_nome}! 💚 Seu pedido *#{numero_pedido}* do *{nome_estabelecimento}* foi entregue com sucesso. Muito obrigado pela preferência!',
  },
  {
    event_type: 'order_cancelled',
    title: 'Pedido Cancelado',
    is_enabled: 1,
    message_template:
      'Olá, {primeiro_nome}. Informamos que o pedido *#{numero_pedido}* no *{nome_estabelecimento}* foi cancelado ({status_pedido}). Caso tenha dúvidas, responda esta mensagem.',
  },
];

export function buildTenantInstanceName(slug: string, tenantId: string): string {
  const cleanSlug = slug.replace(/[^a-z0-9]/gi, '_').toLowerCase().slice(0, 24);
  const suffix = tenantId.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 8);
  return `crj_${cleanSlug}_${suffix}`;
}

export async function ensureTenantWhatsAppSetup(
  db: DbClient,
  tenantId: string,
  slug: string,
  envConfig?: EvolutionEnvConfig
): Promise<void> {
  const now = new Date().toISOString();
  const mode =
    envConfig?.evolutionApiUrl && envConfig?.evolutionApiKey ? 'evolution_live' : 'homologation';

  const existingInst = await db
    .prepare(`SELECT id FROM whatsapp_instances WHERE tenant_id = ?`)
    .bind(tenantId)
    .first<{ id: string }>();

  if (!existingInst) {
    await db
      .prepare(
        `INSERT INTO whatsapp_instances (
           id, tenant_id, instance_name, status, provider_mode, created_at, updated_at
         ) VALUES (?, ?, ?, 'disconnected', ?, ?, ?)`
      )
      .bind(
        generateId(),
        tenantId,
        buildTenantInstanceName(slug, tenantId),
        mode,
        now,
        now
      )
      .run();
  }

  const { results: existingTemplates } = await db
    .prepare(`SELECT event_type FROM whatsapp_templates WHERE tenant_id = ?`)
    .bind(tenantId)
    .all<{ event_type: string }>();

  const existingSet = new Set(existingTemplates.map((t) => t.event_type));
  for (const tpl of DEFAULT_WHATSAPP_TEMPLATES) {
    if (!existingSet.has(tpl.event_type)) {
      await db
        .prepare(
          `INSERT INTO whatsapp_templates (
             id, tenant_id, event_type, title, message_template, is_enabled, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          generateId(),
          tenantId,
          tpl.event_type,
          tpl.title,
          tpl.message_template,
          tpl.is_enabled,
          now
        )
        .run();
    }
  }
}

async function generateSvgQrBase64(textPayload: string): Promise<string> {
  const svg = await QRCode.toString(textPayload, {
    type: 'svg',
    margin: 2,
    width: 280,
    color: {
      dark: '#052e16',
      light: '#ffffff',
    },
  });
  const encoded = btoa(unescape(encodeURIComponent(svg)));
  return `data:image/svg+xml;base64,${encoded}`;
}

function isLiveEvolutionConfigured(cfg: EvolutionEnvConfig): boolean {
  return Boolean(cfg.evolutionApiUrl?.trim() && cfg.evolutionApiKey?.trim());
}

function sanitizeEvolutionError(message: string, cfg: EvolutionEnvConfig): string {
  let safe = String(message || 'Falha no serviço WhatsApp.');
  if (cfg.evolutionApiUrl) safe = safe.split(cfg.evolutionApiUrl).join('[endpoint privado]');
  if (cfg.evolutionApiKey) safe = safe.split(cfg.evolutionApiKey).join('[credencial protegida]');
  return safe.slice(0, 240);
}

/**
 * Cria/conecta a instância isolada do estabelecimento na Evolution API e retorna o QR Code interno,
 * NUNCA expondo a URL privada ou Global API Key da Evolution API.
 */
/** Garante que o QR recebido da Evolution seja uma imagem válida no navegador. */
export async function normalizeEvolutionQrImage(payload: any): Promise<string | null> {
  const raw=payload?.qrcode?.base64||payload?.base64||payload?.qrcode?.codeImage||payload?.codeImage||null;
  if(typeof raw==='string'&&raw.trim()){
    const code=raw.trim();
    if(/^data:image\/(png|jpe?g|webp|svg\+xml);base64,/i.test(code))return code;
    if(/^[A-Za-z0-9+/=\r\n]+$/.test(code)&&code.length>40)
      return 'data:image/png;base64,'+code.replace(/\s/g,'');
  }
  const text=payload?.qrcode?.code||payload?.code||null;
  return typeof text==='string'&&text.startsWith('2@')?generateSvgQrBase64(text):null;
}
const evolutionWebhook = (cfg: EvolutionEnvConfig) => {
  if(!cfg.evolutionWebhookToken||!cfg.publicWebhookUrl)return null;
  const base=cfg.publicWebhookUrl.replace(/\/+$/,'');
  if(!base.startsWith('https://'))return null;
  return {
    enabled:true,
    url:base+'/api/webhooks/evolution',
    byEvents:false,
    base64:true,
    headers:{'x-evolution-token':cfg.evolutionWebhookToken},
    events:['QRCODE_UPDATED','CONNECTION_UPDATE','MESSAGES_UPSERT']
  };
};
async function configureEvolutionWebhook(baseUrl:string,instance:string,headers:Record<string,string>,cfg:EvolutionEnvConfig){
  const webhook=evolutionWebhook(cfg);
  if(!webhook)return false;
  const payload=JSON.stringify({webhook});
  // APIs v2 usam /webhook/set; versões recentes também expõem /event/webhook/set.
  for(const segment of ['webhook/set','event/webhook/set']){
    const response=await fetch(baseUrl+'/'+segment+'/'+encodeURIComponent(instance),{
      method:'POST',headers,body:payload
    });
    if(response.ok)return true;
    if(response.status!==404&&response.status!==405)
      throw new Error('Não foi possível configurar o webhook Evolution (HTTP '+response.status+').');
  }
  throw new Error('Servidor Evolution não oferece endpoint de configuração do webhook compatível.');
}

/**
 * Cria somente a instância pertencente ao tenant autenticado e devolve QR real.
 * Nenhum acesso externo é feito sem credenciais e nenhuma instância alheia é modificada.
 */
export async function connectOrRefreshWhatsAppQr(
  db: DbClient, tenantId: string, slug: string, envCfg: EvolutionEnvConfig
) {
  await ensureTenantWhatsAppSetup(db,tenantId,slug,envCfg);
  if(!isLiveEvolutionConfigured(envCfg))
    throw new Error('Evolution API ainda não configurada. Peça a configuração ao administrador CR Jornada.');
  const baseUrl=envCfg.evolutionApiUrl!.replace(/\/+$/,'');
  if(!baseUrl.startsWith('https://'))throw new Error('A Evolution API precisa usar HTTPS para proteger as credenciais.');
  const now=new Date().toISOString();
  const row=await db.prepare('SELECT instance_name FROM whatsapp_instances WHERE tenant_id=?')
    .bind(tenantId).first<{instance_name:string}>();
  if(!row)throw new Error('A instância não foi encontrada para esta loja.');
  const instanceName=row.instance_name;
  const headers={'Content-Type':'application/json',apikey:envCfg.evolutionApiKey!};
  const connect=()=>fetch(baseUrl+'/instance/connect/'+encodeURIComponent(instanceName),{headers});
  let webhookWarning:string|null=null;
  try {
    let resp=await connect(),data:any=null;
    if(resp.status===404){
      const createBody:any={instanceName,qrcode:true,integration:'WHATSAPP-BAILEYS',
        rejectCall:true,groupsIgnore:true,readMessages:false,readStatus:false};
      const webhook=evolutionWebhook(envCfg);
      if(webhook)createBody.webhook=webhook;
      const creation=await fetch(baseUrl+'/instance/create',{
        method:'POST',headers,body:JSON.stringify(createBody)
      });
      if(creation.ok)data=await creation.json();
      else if(creation.status!==409)
        throw new Error('Falha ao criar instância do estabelecimento (HTTP '+creation.status+').');
      if(!data?.qrcode?.base64 && !data?.qrcode?.code && !data?.base64){
        resp=await connect();
        if(!resp.ok)throw new Error('Instância criada, mas QR ainda não disponível (HTTP '+resp.status+'). Atualize o QR novamente em alguns segundos.');
        data=await resp.json();
      }
    }else if(resp.ok)data=await resp.json();
    else throw new Error('Evolution API recusou a conexão da instância (HTTP '+resp.status+').');

    // Em caso de instância criada anteriormente, atualiza o webhook apenas dela.
    try{
      if(!evolutionWebhook(envCfg))webhookWarning='Configure a chave de webhook para sincronizar o status automaticamente.';
      else {await configureEvolutionWebhook(baseUrl,instanceName,headers,envCfg);await db.prepare('UPDATE whatsapp_instances SET webhook_events_version=2 WHERE tenant_id=?').bind(tenantId).run();}
    }catch(e:any){webhookWarning=sanitizeEvolutionError(String(e?.message||'Falha de webhook'),envCfg);}
    const state=String(data?.instance?.state||data?.state||'').toLowerCase();
    const connected=state==='open';
    const qr=connected?null:await normalizeEvolutionQrImage(data);
    const qrText=connected?null:String(data?.qrcode?.code||data?.code||'')||null;
    await db.prepare(`UPDATE whatsapp_instances SET status=?,qr_code_base64=?,
      qr_code_text=?,qr_updated_at=?,connected_at=CASE WHEN ?='connected' THEN COALESCE(connected_at,?) ELSE connected_at END,
      last_checked_at=?,provider_mode='evolution_live',last_error=?,updated_at=?
      WHERE tenant_id=?`).bind(connected?'connected':'qr_pending',qr,qrText,now,
      connected?'connected':'qr_pending',now,now,webhookWarning,now,tenantId).run();
    return getSanitizedWhatsAppStatus(db,tenantId,envCfg);
  }catch(e:any){
    const msg=sanitizeEvolutionError(String(e?.message||'Falha de comunicação com a Evolution API'),envCfg);
    await db.prepare('UPDATE whatsapp_instances SET last_error=?,updated_at=? WHERE tenant_id=?')
      .bind(msg,now,tenantId).run();
    throw new Error(msg);
  }
}

/**
 * Consulta o estado atual da conexão na Evolution API (se configurada) e retorna
 * o estado sanitizado (sem credenciais técnicas ou URL privada).
 */
export async function checkWhatsAppConnectionStatus(
  db: DbClient,
  tenantId: string,
  slug: string,
  envCfg: EvolutionEnvConfig
) {
  await ensureTenantWhatsAppSetup(db, tenantId, slug, envCfg);
  const now = new Date().toISOString();

  const inst = await db
    .prepare(`SELECT * FROM whatsapp_instances WHERE tenant_id = ?`)
    .bind(tenantId)
    .first<Record<string, any>>();

  if (inst && isLiveEvolutionConfigured(envCfg)) {
    const baseUrl = envCfg.evolutionApiUrl!.replace(/\/+$/, '');
    const headers: Record<string, string> = {
      apikey: envCfg.evolutionApiKey!,
    };
    if(inst.status==='connected'&&Number(inst.webhook_events_version||0)<2&&envCfg.publicWebhookUrl&&envCfg.evolutionWebhookToken){
      try{await configureEvolutionWebhook(baseUrl,inst.instance_name,{'Content-Type':'application/json',...headers},envCfg);await db.prepare('UPDATE whatsapp_instances SET webhook_events_version=2 WHERE tenant_id=?').bind(tenantId).run();}catch{/* a próxima consulta tentará novamente */}
    }
    try {
      const stateResp = await fetch(
        `${baseUrl}/instance/connectionState/${encodeURIComponent(inst.instance_name)}`,
        { method: 'GET', headers }
      );
      if (stateResp.ok) {
        const stateData = (await stateResp.json()) as Record<string, any>;
        const rawState = stateData?.instance?.state || stateData?.state || 'close';
        let connectedPhone = inst.connected_phone as string | null;
        let profileName = inst.profile_name as string | null;

        if (rawState === 'open') {
          // Busca o número conectado na instância
          try {
            const infoResp = await fetch(
              `${baseUrl}/instance/fetchInstances?instanceName=${encodeURIComponent(inst.instance_name)}`,
              { method: 'GET', headers }
            );
            if (infoResp.ok) {
              const infoJson = (await infoResp.json()) as any;
              const entry = Array.isArray(infoJson) ? infoJson[0] : infoJson?.instance || infoJson;
              const ownerJid: string = entry?.ownerJid || entry?.owner || '';
              if (ownerJid) {
                connectedPhone = ownerJid.split('@')[0];
              }
              if (entry?.profileName) {
                profileName = entry.profileName;
              }
            }
          } catch {
            // mantém telefone anterior
          }

          await db
            .prepare(
              `UPDATE whatsapp_instances
               SET status = 'connected',
                   connected_phone = COALESCE(?, connected_phone),
                   profile_name = COALESCE(?, profile_name),
                   qr_code_base64 = NULL,
                   qr_code_text = NULL,
                   connected_at = COALESCE(connected_at, ?),
                   last_checked_at = ?,
                   provider_mode = 'evolution_live',
                   last_error = NULL,
                   updated_at = ?
               WHERE tenant_id = ?`
            )
            .bind(connectedPhone, profileName, now, now, now, tenantId)
            .run();
        } else if (rawState === 'connecting' && inst.qr_code_base64) {
          await db
            .prepare(`UPDATE whatsapp_instances SET last_checked_at = ? WHERE tenant_id = ?`)
            .bind(now, tenantId)
            .run();
        } else if (['close','closed','disconnected'].includes(String(rawState).toLowerCase())) {
          if(await recordWhatsAppDisconnection(db,tenantId,'monitor')){
            await processPendingTelegramAlerts(db,envCfg).catch(()=>undefined);
          }
        }
      }
    } catch (err: any) {
      await db
        .prepare(
          `UPDATE whatsapp_instances SET last_error = ?, last_checked_at = ? WHERE tenant_id = ?`
        )
        .bind(sanitizeEvolutionError(err?.message || 'Falha ao consultar Evolution API', envCfg), now, tenantId)
        .run();
    }
  }

  return getSanitizedWhatsAppStatus(db, tenantId, envCfg);
}

/**
 * Desconecta a sessão WhatsApp do estabelecimento.
 */
export async function disconnectWhatsAppInstance(
  db: DbClient,
  tenantId: string,
  envCfg: EvolutionEnvConfig
) {
  const now = new Date().toISOString();
  const inst = await db
    .prepare(`SELECT * FROM whatsapp_instances WHERE tenant_id = ?`)
    .bind(tenantId)
    .first<Record<string, any>>();

  if (inst && isLiveEvolutionConfigured(envCfg)) {
    const baseUrl=envCfg.evolutionApiUrl!.replace(/\/+$/,'');
    try {
      const response=await fetch(baseUrl+'/instance/logout/'+encodeURIComponent(inst.instance_name),{
        method:'DELETE',headers:{apikey:envCfg.evolutionApiKey!}
      });
      if(!response.ok && ![404,410].includes(response.status))
        throw new Error('Evolution recusou a desconexão (HTTP '+response.status+').');
    }catch(err:any){
      throw new Error('Não foi possível confirmar a desconexão na Evolution. '+(
        String(err?.message||'').startsWith('Evolution recusou')?err.message:'Verifique a conexão com o servidor.'));
    }
  }

  const changed=await recordWhatsAppDisconnection(db,tenantId,'panel');
  if(!changed){
    await db.prepare(`UPDATE whatsapp_instances SET status='disconnected',
      connected_phone=NULL,profile_name=NULL,qr_code_base64=NULL,
      qr_code_text=NULL,connected_at=NULL,updated_at=?
      WHERE tenant_id=? AND status!='connected'`).bind(now,tenantId).run();
  }else {
    await processPendingTelegramAlerts(db,envCfg).catch(()=>undefined);
  }
  return getSanitizedWhatsAppStatus(db,tenantId,envCfg);
}

/**
 * Apenas em modo de homologação local (sem servidor Evolution externo configurado),
 * permite confirmar o pareamento simulado do QR Code com o número do lojista para testar todo o fluxo!
 */
export async function confirmHomologationQrScan(
  db: DbClient,
  tenantId: string,
  phone: string,
  profileName: string,
  envCfg: EvolutionEnvConfig
) {
  if (isLiveEvolutionConfigured(envCfg)) {
    throw new Error('Em modo Evolution API de produção, escaneie o QR Code diretamente no aplicativo WhatsApp.');
  }
  const now = new Date().toISOString();
  const normalizedPhone = normalizePhoneBR(phone || '5573999112233');

  await db
    .prepare(
      `UPDATE whatsapp_instances
       SET status = 'connected',
           connected_phone = ?,
           profile_name = ?,
           qr_code_base64 = NULL,
           qr_code_text = NULL,
           connected_at = ?,
           last_checked_at = ?,
           last_error = NULL,
           updated_at = ?
       WHERE tenant_id = ?`
    )
    .bind(normalizedPhone, profileName || 'WhatsApp Comercial', now, now, now, tenantId)
    .run();

  return getSanitizedWhatsAppStatus(db, tenantId, envCfg);
}

export async function getSanitizedWhatsAppStatus(
  db: DbClient,
  tenantId: string,
  envCfg: EvolutionEnvConfig
) {
  const inst = await db
    .prepare(
      `SELECT instance_name, status, connected_phone, profile_name,
              qr_code_base64, qr_updated_at, connected_at, last_checked_at,
              provider_mode, last_error, updated_at
       FROM whatsapp_instances
       WHERE tenant_id = ?`
    )
    .bind(tenantId)
    .first<Record<string, any>>();

  const isLive = isLiveEvolutionConfigured(envCfg);

  return {
    instance_name: inst?.instance_name || null,
    status: isLive ? ((inst?.status as 'disconnected' | 'qr_pending' | 'connected') || 'disconnected') : 'disconnected',
    connected_phone: inst?.connected_phone ? formatPhoneBR(inst.connected_phone) : null,
    connected_phone_raw: inst?.connected_phone || null,
    profile_name: inst?.profile_name || null,
    qr_code_base64: isLive ? (inst?.qr_code_base64 || null) : null,
    qr_updated_at: inst?.qr_updated_at || null,
    connected_at: inst?.connected_at || null,
    last_checked_at: inst?.last_checked_at || null,
    provider_mode: isLive ? 'evolution_live' : 'not_configured',
    configured: isLive,
    webhook_configured: Boolean(envCfg.publicWebhookUrl && envCfg.evolutionWebhookToken),
    telegram_alerts_configured: telegramAlertsConfigured(envCfg),
    last_error: inst?.last_error ? sanitizeEvolutionError(inst.last_error, envCfg) : null,
  };
}

/**
 * Renderiza um template de mensagem com todas as variáveis transacionais do pedido.
 */
export function renderWhatsAppOrderTemplate(
  template: string,
  vars: {
    primeiro_nome: string;
    nome_completo: string;
    nome_estabelecimento: string;
    numero_pedido: string;
    itens_pedido: string;
    subtotal: string;
    taxa_entrega: string;
    valor_total: string;
    forma_pagamento: string;
    troco_info: string;
    endereco_entrega: string;
    status_pedido: string;
    economia_info?:string;
    previsao_entrega?:string;
  }
): string {
  return template
    .replace(/\{primeiro_nome\}/g, vars.primeiro_nome)
    .replace(/\{nome_completo\}/g, vars.nome_completo)
    .replace(/\{nome_estabelecimento\}/g, vars.nome_estabelecimento)
    .replace(/\{numero_pedido\}/g, vars.numero_pedido)
    .replace(/\{itens_pedido\}/g, vars.itens_pedido)
    .replace(/\{subtotal\}/g, vars.subtotal)
    .replace(/\{taxa_entrega\}/g, vars.taxa_entrega)
    .replace(/\{valor_total\}/g, vars.valor_total)
    .replace(/\{forma_pagamento\}/g, vars.forma_pagamento)
    .replace(/\{troco_info\}/g, vars.troco_info)
    .replace(/\{endereco_entrega\}/g, vars.endereco_entrega)
    .replace(/\{status_pedido\}/g, vars.status_pedido)
    .replace(/\{economia_info\}/g,vars.economia_info||'')
    .replace(/\{previsao_entrega\}/g,vars.previsao_entrega||'30 a 40 minutos');
}

/**
 * Enfileira (com chave de idempotência anti-duplicação) e dispara imediatamente
 * a notificação transacional do ciclo do pedido via WhatsApp.
 */
/** Notifica o responsável interno por novos pedidos, sem depender do opt-in do cliente. */
export async function enqueueAndDispatchStaffOrderNotification(
  db: DbClient,
  tenantId: string,
  orderId: string,
  envCfg: EvolutionEnvConfig
): Promise<{queued:boolean;status:string;queueId?:string}> {
  const tenant=await db.prepare(`SELECT name,whatsapp_order_recipient_phone FROM tenants WHERE id=?`)
    .bind(tenantId).first<{name:string;whatsapp_order_recipient_phone:string|null}>();
  const recipient=normalizePhoneBR(String(tenant?.whatsapp_order_recipient_phone||''));
  if(!tenant||!recipient)return {queued:false,status:'recipient_not_configured'};
  const order=await db.prepare(`SELECT * FROM orders WHERE id=? AND tenant_id=? AND deleted_at IS NULL`)
    .bind(orderId,tenantId).first<Record<string,any>>();
  if(!order)return {queued:false,status:'order_not_found'};
  const {results:items}=await db.prepare(`SELECT product_name_snapshot,variant_name_snapshot,quantity_display,line_total_cents,customization_snapshot FROM order_items WHERE order_id=? AND tenant_id=? ORDER BY rowid`)
    .bind(orderId,tenantId).all<any>();
  const itemsText=formatWhatsAppItems(items);
  const address=[`${order.address_street}, nº ${order.address_number}`,order.address_neighborhood,order.address_complement,order.address_reference?`Ref.: ${order.address_reference}`:null].filter(Boolean).join(', ');
  const payment=PAYMENT_METHOD_LABELS[order.payment_method as PaymentMethod]||order.payment_method;
  const change=order.payment_method==='cash'&&order.needs_change&&order.change_for_cents
    ? `\\nTroco para: ${formatBRL(order.change_for_cents)}` : '';
  const message=[
    `🛎️ *NOVO PEDIDO — ${tenant.name}*`,
    `Pedido: *#${order.order_number}*`,
    `Cliente: ${order.customer_name}`,
    `WhatsApp: ${formatPhoneBR(order.customer_phone)}`,
    '',
    '*ITENS DO PEDIDO*',
    itemsText,
    '',
    `Subtotal: ${formatBRL(order.subtotal_cents)}`,
    `Entrega: ${order.delivery_fee_cents===0?'GRÁTIS':formatBRL(order.delivery_fee_cents)}`,
    `*TOTAL: ${formatBRL(order.total_cents)}*`,
    `Pagamento: ${payment}${change}`,
    '',
    `Endereço: ${address}`,
  ].join('\\n');
  const idempotencyKey=`${orderId}:staff_order_received:${recipient}`;
  const existing=await db.prepare(`SELECT id,status FROM whatsapp_message_queue WHERE tenant_id=? AND idempotency_key=?`)
    .bind(tenantId,idempotencyKey).first<{id:string;status:string}>();
  if(existing)return {queued:false,status:`duplicate_prevented:${existing.status}`,queueId:existing.id};
  const now=new Date().toISOString(),queueId=generateId();
  await db.prepare(`INSERT INTO whatsapp_message_queue(id,tenant_id,order_id,event_type,idempotency_key,recipient_phone,recipient_name,rendered_message,status,attempts,max_attempts,next_retry_at,created_at,updated_at)
    VALUES(?,?,?,'staff_order_received',?,?,?,?, 'pending',0,3,?,?,?)`)
    .bind(queueId,tenantId,orderId,idempotencyKey,recipient,'Responsável pelos pedidos',message,now,now,now).run();
  const sent=await dispatchQueuedMessageById(db,tenantId,queueId,envCfg);
  return {queued:true,status:sent.status,queueId};
}

export async function enqueueAndDispatchOrderWhatsAppNotification(
  db: DbClient,
  tenantId: string,
  orderId: string,
  eventType: WhatsAppEventType,
  envCfg: EvolutionEnvConfig
): Promise<{ queued: boolean; status: string; queueId?: string }> {
  const tenant = await db
    .prepare(`SELECT id, name, slug, delivery_eta_text FROM tenants WHERE id = ?`)
    .bind(tenantId)
    .first<{ id: string; name: string; slug: string; delivery_eta_text:string }>();

  if (!tenant) return { queued: false, status: 'tenant_not_found' };

  await ensureTenantWhatsAppSetup(db, tenantId, tenant.slug, envCfg);

  const idempotencyKey = `${orderId}:${eventType}`;
  const existing = await db
    .prepare(
      `SELECT id, status FROM whatsapp_message_queue
       WHERE tenant_id = ? AND idempotency_key = ?`
    )
    .bind(tenantId, idempotencyKey)
    .first<{ id: string; status: string }>();

  // Prevenção estrita de mensagens duplicadas!
  if (existing) {
    return { queued: false, status: `duplicate_prevented:${existing.status}`, queueId: existing.id };
  }

  const order = await db
    .prepare(`SELECT * FROM orders WHERE id = ? AND tenant_id = ?`)
    .bind(orderId, tenantId)
    .first<Record<string, any>>();

  if (!order) return { queued: false, status: 'order_not_found' };

  const tpl = await db
    .prepare(
      `SELECT message_template, is_enabled
       FROM whatsapp_templates
       WHERE tenant_id = ? AND event_type = ?`
    )
    .bind(tenantId, eventType)
    .first<{ message_template: string; is_enabled: number }>();

  if (!tpl) {
    return { queued: false, status: 'template_missing' };
  }

  const now = new Date().toISOString();
  const queueId = generateId();
  if (!tpl.is_enabled) {
    await db.prepare(
      `INSERT INTO whatsapp_message_queue (
         id, tenant_id, order_id, event_type, idempotency_key,
         recipient_phone, recipient_name, rendered_message,
         status, attempts, max_attempts, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'skipped_disabled', 0, 3, ?, ?)`
    ).bind(queueId, tenantId, orderId, eventType, idempotencyKey,
      normalizePhoneBR(order.customer_phone), order.customer_name,
      '[Envio ignorado: este modelo de mensagem está desativado]', now, now).run();
    return { queued: false, status: 'template_disabled', queueId };
  }

  if (!order.whatsapp_opt_in) {
    await db
      .prepare(
        `INSERT INTO whatsapp_message_queue (
           id, tenant_id, order_id, event_type, idempotency_key,
           recipient_phone, recipient_name, rendered_message,
           status, attempts, max_attempts, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'skipped_no_optin', 0, 3, ?, ?)`
      )
      .bind(
        queueId,
        tenantId,
        orderId,
        eventType,
        idempotencyKey,
        normalizePhoneBR(order.customer_phone),
        order.customer_name,
        '[Envio ignorado: cliente desmarcou autorização de notificações via WhatsApp]',
        now,
        now
      )
      .run();
    return { queued: false, status: 'skipped_no_optin', queueId };
  }

  const { results: items } = await db
    .prepare(
      `SELECT product_name_snapshot, variant_name_snapshot, quantity_display, line_total_cents, original_line_total_cents, customization_snapshot
       FROM order_items
       WHERE order_id = ? AND tenant_id = ?`
    )
    .bind(orderId, tenantId)
    .all<{
      product_name_snapshot: string;
      quantity_display: string;
      line_total_cents: number;
      variant_name_snapshot:string|null;
      original_line_total_cents:number|null;
      customization_snapshot:string|null;
    }>();

  const itemsText=formatWhatsAppItems(items);
  const savings=orderSavings(items);

  const paymentLabel =
    PAYMENT_METHOD_LABELS[order.payment_method as PaymentMethod] || order.payment_method;
  const trocoInfo =
    order.payment_method === 'cash' && order.needs_change && order.change_for_cents
      ? ` (Troco para ${formatBRL(order.change_for_cents)} → Troco: ${formatBRL(
          order.change_amount_cents || 0
        )})`
      : order.payment_method === 'cash'
        ? ' (Sem necessidade de troco)'
        : '';

  const addressParts = [
    `${order.address_street}, nº ${order.address_number}`,
    order.address_neighborhood,
    order.address_complement,
    order.address_reference ? `Ref: ${order.address_reference}` : null,
  ].filter(Boolean);

  const statusLabel =
    ORDER_STATUS_LABELS[order.status as OrderStatus] || String(order.status);

  const rendered = renderWhatsAppOrderTemplate(tpl.message_template, {
    primeiro_nome: extractFirstName(order.customer_name),
    nome_completo: order.customer_name,
    nome_estabelecimento: tenant.name,
    numero_pedido: String(order.order_number),
    itens_pedido: itemsText,
    subtotal: formatBRL(order.subtotal_cents),
    taxa_entrega:
      order.delivery_fee_cents === 0 ? 'GRÁTIS' : formatBRL(order.delivery_fee_cents),
    valor_total: formatBRL(order.total_cents),
    forma_pagamento: paymentLabel,
    troco_info: trocoInfo,
    endereco_entrega: addressParts.join('\n'),
    economia_info:savings>0?'\n🎉 *Você economizou '+formatBRL(savings)+'!*':'',
    previsao_entrega:tenant.delivery_eta_text||'30 a 40 minutos',
    status_pedido: order.cancel_reason
      ? `${statusLabel} — ${order.cancel_reason}`
      : statusLabel,
  });

  await db
    .prepare(
      `INSERT INTO whatsapp_message_queue (
         id, tenant_id, order_id, event_type, idempotency_key,
         recipient_phone, recipient_name, rendered_message,
         status, attempts, max_attempts, next_retry_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, 3, ?, ?, ?)`
    )
    .bind(
      queueId,
      tenantId,
      orderId,
      eventType,
      idempotencyKey,
      normalizePhoneBR(order.customer_phone),
      order.customer_name,
      rendered,
      now,
      now,
      now
    )
    .run();

  const dispatchResult = await dispatchQueuedMessageById(db, tenantId, queueId, envCfg);
  return { queued: true, status: dispatchResult.status, queueId };
}

/**
 * Tenta enviar uma mensagem específica da fila, controlando tentativas e backoff exponencial.
 */
export async function dispatchQueuedMessageById(
  db: DbClient,
  tenantId: string,
  queueId: string,
  envCfg: EvolutionEnvConfig
): Promise<{ status: string; error?: string }> {
  const msg = await db
    .prepare(`SELECT * FROM whatsapp_message_queue WHERE id = ? AND tenant_id = ?`)
    .bind(queueId, tenantId)
    .first<Record<string, any>>();

  if (!msg) return { status: 'not_found' };
  if (msg.status === 'sent') return { status: 'sent' };
  if (msg.status === 'skipped_no_optin' || msg.status === 'skipped_disabled')
    return {status:msg.status};
  // Nunca emitir avisos de pedidos cancelados e removidos da operação.
  if(msg.order_id){
    const order=await db.prepare('SELECT deleted_at FROM orders WHERE id=? AND tenant_id=?')
      .bind(msg.order_id,tenantId).first<{deleted_at:string|null}>();
    if(!order||order.deleted_at){
      await db.prepare(`UPDATE whatsapp_message_queue SET status='failed',
        last_error='Pedido removido da lista do estabelecimento',
        next_retry_at=NULL,updated_at=? WHERE id=? AND tenant_id=? AND status!='sent'`)
        .bind(new Date().toISOString(),queueId,tenantId).run();
      return {status:'skipped_removed'};
    }
  }

  const inst = await db
    .prepare(`SELECT * FROM whatsapp_instances WHERE tenant_id = ?`)
    .bind(tenantId)
    .first<Record<string, any>>();

  const now = new Date().toISOString();
  const attemptNum = Number(msg.attempts || 0) + 1;
  const maxAttempts = Number(msg.max_attempts || 3);

  // Manter mensagens na fila enquanto não houver conexão real, sem consumir
  // tentativas nem informar envio bem-sucedido. Evitar disparos de eventos antigos.
  if (!isLiveEvolutionConfigured(envCfg) || !inst || inst.status !== 'connected') {
    const stale = Date.now() - Date.parse(String(msg.created_at)) > 24*60*60*1000;
    const status = stale ? 'failed' : 'pending';
    const errText = !isLiveEvolutionConfigured(envCfg)
      ? 'Evolution API não configurada. Aguardando conexão real.'
      : 'WhatsApp desconectado. Aguardando a conexão do estabelecimento.';
    const retryAt = new Date(Date.now() + 120000).toISOString();
    await db.prepare(`UPDATE whatsapp_message_queue
      SET status=?,next_retry_at=?,last_error=?,updated_at=?
      WHERE id=? AND tenant_id=? AND status IN ('pending','failed')`)
      .bind(status,stale?null:retryAt,errText,now,queueId,tenantId).run();
    return {status,error:errText};
  }

  const isLive = isLiveEvolutionConfigured(envCfg);

  if (isLive) {
    const baseUrl = envCfg.evolutionApiUrl!.replace(/\/+$/, '');
    try {
      const resp = await fetch(
        `${baseUrl}/message/sendText/${encodeURIComponent(inst.instance_name)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: envCfg.evolutionApiKey!,
          },
          body: JSON.stringify({
            number: msg.recipient_phone,
            text: msg.rendered_message,
            delay: 600,
          }),
        }
      );

      if (!resp.ok) {
        throw new Error(`Evolution API não aceitou a mensagem (HTTP ${resp.status}).`);
      }

      const data = (await resp.json()) as Record<string, any>;
      const providerId = data?.key?.id || data?.messageId || `evo_${generateId().slice(0, 10)}`;

      await db
        .prepare(
          `UPDATE whatsapp_message_queue
           SET status = 'sent', attempts = ?, sent_at = ?, provider_message_id = ?,
               last_error = NULL, updated_at = ?
           WHERE id = ? AND tenant_id = ?`
        )
        .bind(attemptNum, now, providerId, now, queueId, tenantId)
        .run();

      return { status: 'sent' };
    } catch (err: any) {
      const backoffSeconds = Math.min(600, Math.pow(2, attemptNum) * 30);
      const nextRetry = new Date(Date.now() + backoffSeconds * 1000).toISOString();
      const newStatus = attemptNum >= maxAttempts ? 'failed' : 'pending';
      const errMsg = sanitizeEvolutionError(err?.message || 'Erro de rede ao enviar via Evolution API', envCfg);

      await db
        .prepare(
          `UPDATE whatsapp_message_queue
           SET status = ?, attempts = ?, next_retry_at = ?, last_error = ?, updated_at = ?
           WHERE id = ? AND tenant_id = ?`
        )
        .bind(newStatus, attemptNum, nextRetry, errMsg, now, queueId, tenantId)
        .run();

      return { status: newStatus, error: errMsg };
    }
  }
  // Em produção, nunca registrar envio simulado como 'sent'.
  return { status:'pending', error:'Evolution API ainda não configurada.' };
}

/**
 * Processador agendado (Cron Trigger Cloudflare Workers / Retry Worker) para reenviar
 * mensagens pendentes com tentativas controladas.
 */
export async function processPendingWhatsAppQueue(
  db: DbClient,
  envCfg: EvolutionEnvConfig,
  limit: number = 25
): Promise<{ processed: number; sent: number }> {
  const now = new Date().toISOString();
  const { results } = await db
    .prepare(
      `SELECT id, tenant_id
       FROM whatsapp_message_queue
       WHERE status = 'pending'
         AND attempts < max_attempts
         AND (next_retry_at IS NULL OR next_retry_at <= ?)
       ORDER BY created_at ASC
       LIMIT ?`
    )
    .bind(now, limit)
    .all<{ id: string; tenant_id: string }>();

  let sent = 0;
  for (const row of results) {
    const res = await dispatchQueuedMessageById(db, row.tenant_id, row.id, envCfg);
    if (res.status === 'sent') sent++;
  }
  return { processed: results.length, sent };
}

function normalizeIncomingWhatsAppText(value:string):string {
 return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
}
function incomingMessageText(data:any):string {
 const m=data?.message||{};
 return String(m.conversation||m.extendedTextMessage?.text||m.imageMessage?.caption||m.videoMessage?.caption||m.documentMessage?.caption||m.buttonsResponseMessage?.selectedDisplayText||m.listResponseMessage?.title||'').trim();
}
function incomingRuleScore(message:string,keywords:string[]):number {
 const normalized=normalizeIncomingWhatsAppText(message);if(!normalized)return 0;
 let best=0;
 for(const keyword of keywords){
  const phrase=normalizeIncomingWhatsAppText(keyword);if(!phrase)continue;
  if(normalized===phrase)return 1;
  if(normalized.includes(phrase)){best=Math.max(best,.96);continue;}
  const words=phrase.split(' ').filter(w=>w.length>2);
  if(words.length>=2){const actual=new Set(normalized.split(' '));const hits=words.filter(w=>actual.has(w)).length;best=Math.max(best,(hits/words.length)*.82);}
 }
 return best;
}
export async function handleIncomingWhatsAppAutoReply(db:DbClient,tenantId:string,data:any,envCfg:EvolutionEnvConfig):Promise<{handled:boolean;reason?:string}> {
 const key=data?.key||{},jid=String(key.remoteJid||data?.remoteJid||'');
 if(key.fromMe===true||!jid||jid.endsWith('@g.us')||jid==='status@broadcast')return{handled:false,reason:'ignored_sender'};
 const text=incomingMessageText(data),providerId=String(key.id||data?.messageId||'');
 if(!text||!providerId)return{handled:false,reason:'no_text_or_id'};
 const inst=await db.prepare('SELECT instance_name,status FROM whatsapp_instances WHERE tenant_id=?').bind(tenantId).first<any>();
 if(!inst||inst.status!=='connected'||!isLiveEvolutionConfigured(envCfg))return{handled:false,reason:'not_connected'};
 const settings=await db.prepare('SELECT * FROM whatsapp_auto_reply_settings WHERE tenant_id=?').bind(tenantId).first<any>();
 if(!settings||settings.enabled!==1)return{handled:false,reason:'disabled'};
 if(settings.business_hours_only===1){
  const clock=new Intl.DateTimeFormat('en-GB',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date());
  if(clock<settings.start_time||clock>settings.end_time)return{handled:false,reason:'outside_business_hours'};
 }
 const now=new Date().toISOString(),customerPhone=jid.split('@')[0],normalizedText=normalizeIncomingWhatsAppText(text);
 if(settings.pause_on_human===1){
  const resumePhrases=['voltar bot','reativar robo','reativar atendimento automatico','retomar bot'];
  if(resumePhrases.some(phrase=>normalizedText.includes(phrase))){
   await db.prepare('DELETE FROM whatsapp_auto_reply_sessions WHERE tenant_id=? AND customer_phone=?').bind(tenantId,customerPhone).run();
   return{handled:false,reason:'automation_resumed'};
  }
  const session=await db.prepare('SELECT paused_until FROM whatsapp_auto_reply_sessions WHERE tenant_id=? AND customer_phone=?').bind(tenantId,customerPhone).first<any>();
  if(session?.paused_until>now)return{handled:false,reason:'human_handoff_active'};
 }
 const eventId=generateId();
 const inserted=await db.prepare("INSERT OR IGNORE INTO whatsapp_auto_reply_events(id,tenant_id,provider_message_id,status,created_at,updated_at) VALUES(?,?,?,'pending',?,?)").bind(eventId,tenantId,providerId,now,now).run();
 if(!inserted.meta.changes){
  const old=await db.prepare('SELECT status FROM whatsapp_auto_reply_events WHERE tenant_id=? AND provider_message_id=?').bind(tenantId,providerId).first<any>();
  if(old?.status!=='failed')return{handled:false,reason:'duplicate'};
 }
 const {results}=await db.prepare("SELECT id,title,intent,keywords_json,reply_text,priority FROM whatsapp_auto_replies WHERE tenant_id=? AND is_enabled=1 ORDER BY priority DESC,created_at ASC").bind(tenantId).all<any>();
 let chosen:any=null,bestScore=.69;
 const intentPhrases:Record<string,string[]>={greeting:['oi','ola','bom dia','boa tarde','boa noite','tudo bem','como vai'],order:['quero pedir','fazer compra','quero encomendar','quero comprar','como comprar','como faco pedido','gostaria de pedir','quero fazer uma encomenda','me manda o link da loja'],order_status:['cadê meu pedido','onde esta meu pedido','meu pedido ja saiu','acompanhar compra','consultar pedido','ver meu pedido','status da entrega','previsao do pedido'],human:['atendente','falar com atendente','quero falar com atendente','preciso falar com atendente','preciso de um atendente','chamar atendente','falar com pessoa','falar com uma pessoa','quero falar com uma pessoa','quero falar com pessoa','falar com humano','quero falar com humano','atendimento humano','quero atendimento humano','quero atendimento','atendimento com pessoa','atendimento com humano','falar com alguem','quero falar com alguem','quero conversar com alguem','quero falar com funcionario','falar com funcionario','quero conversar com atendente','conversar com uma pessoa','preciso de ajuda','quero falar com alguem da loja','pessoa de verdade','me transfere para um atendente','pode me passar para um atendente','tem um atendente ai']};
 for(const rule of results){let keywords:string[]=[];try{keywords=JSON.parse(rule.keywords_json||'[]');}catch{}const expanded=[...keywords,...(intentPhrases[String(rule.intent||'')]||[])];const score=incomingRuleScore(text,expanded);if(score>bestScore){bestScore=score;chosen=rule;}}
 let dynamicOrderReply='';
 if(chosen?.intent==='order_status'){
  const normalizedPhone=normalizePhoneBR(customerPhone);
  const order=await db.prepare('SELECT order_number,status FROM orders WHERE tenant_id=? AND customer_phone=? ORDER BY created_at DESC LIMIT 1').bind(tenantId,normalizedPhone).first<any>();
  if(order){
   const labels:any={received:'recebido e aguardando confirmação',accepted:'aceito pela loja',preparing:'em preparação',out_for_delivery:'saiu para entrega',delivered:'entregue',cancelled:'cancelado'};
   dynamicOrderReply='Olá! 😊 Seu pedido nº '+order.order_number+' está '+(labels[order.status]||order.status)+'.';
  }else dynamicOrderReply='Não encontrei um pedido recente vinculado a este número. Confira se está falando pelo mesmo WhatsApp usado na compra ou envie o número do pedido para nossa equipe.';
 }
 const template=dynamicOrderReply||chosen?.reply_text||settings.fallback_message;
 if(!template){
  await db.prepare("UPDATE whatsapp_auto_reply_events SET status='ignored',updated_at=? WHERE tenant_id=? AND provider_message_id=?").bind(now,tenantId,providerId).run();
  return{handled:false,reason:'no_match'};
 }
 const phone=customerPhone,name=String(data?.pushName||'').trim();
 const reply=String(template).split('{nome_cliente}').join(name).split('{link_loja}').join(String(settings.store_url||''));
 try{
  const base=envCfg.evolutionApiUrl!.replace(/\/+$/,'');
  const response=await fetch(base+'/message/sendText/'+encodeURIComponent(inst.instance_name),{
   method:'POST',headers:{'Content-Type':'application/json',apikey:envCfg.evolutionApiKey!},
   body:JSON.stringify({number:phone,text:reply,delay:500})
  });
  if(!response.ok)throw new Error('Evolution sendText HTTP '+response.status);
  const sentAt=new Date().toISOString();
  await db.prepare("UPDATE whatsapp_auto_reply_events SET status='sent',matched_rule_id=?,error_message=NULL,updated_at=? WHERE tenant_id=? AND provider_message_id=?").bind(chosen?.id||null,sentAt,tenantId,providerId).run();
  if(chosen?.intent==='human'){
   if(settings.pause_on_human===1){
    const until=new Date(Date.now()+86400000).toISOString();
    await db.prepare('INSERT INTO whatsapp_auto_reply_sessions(tenant_id,customer_phone,paused_until,updated_at) VALUES(?,?,?,?) ON CONFLICT(tenant_id,customer_phone) DO UPDATE SET paused_until=excluded.paused_until,updated_at=excluded.updated_at').bind(tenantId,phone,until,sentAt).run();
   }
   // Usa o mesmo destinatário já configurado para receber os pedidos da loja.
   try{
    const destination=await db.prepare('SELECT name,whatsapp_order_recipient_phone FROM tenants WHERE id=?').bind(tenantId).first<any>();
    const notifyNumber=normalizePhoneBR(String(destination?.whatsapp_order_recipient_phone||''));
    if(notifyNumber){
     const when=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}).format(new Date());
     const notification=[
      '🔔 *NOVO PEDIDO DE ATENDIMENTO HUMANO*',
      '',
      '🏪 *Loja:* '+String(destination?.name||'Estabelecimento'),
      '👤 *Cliente:* '+(name||'Não informado'),
      '📱 *WhatsApp do cliente:* '+phone,
      '💬 *Mensagem recebida:* '+text,
      '🕒 *Solicitação:* '+when,
      '',
      'Entre em contato com o cliente pelo número informado para continuar o atendimento.'
     ].join('\n');
     const notifyResponse=await fetch(base+'/message/sendText/'+encodeURIComponent(inst.instance_name),{
      method:'POST',headers:{'Content-Type':'application/json',apikey:envCfg.evolutionApiKey!},
      body:JSON.stringify({number:notifyNumber,text:notification,delay:500})
     });
     if(!notifyResponse.ok)throw new Error('Evolution sendText HTTP '+notifyResponse.status);
     return{handled:true,reason:'human_handoff_notified'};
    }
    return{handled:true,reason:'human_handoff_no_recipient'};
   }catch(notifyError:any){
    const detail=String(notifyError?.message||'notification_failed').slice(0,140);
    await db.prepare("UPDATE whatsapp_auto_reply_events SET error_message=?,updated_at=? WHERE tenant_id=? AND provider_message_id=?")
     .bind('Falha ao notificar atendimento humano: '+detail,new Date().toISOString(),tenantId,providerId).run();
    return{handled:true,reason:'human_handoff_notification_failed'};
   }
  }
  return{handled:true,reason:chosen?'matched_rule':'fallback'};
 }catch(error:any){
  await db.prepare("UPDATE whatsapp_auto_reply_events SET status='failed',matched_rule_id=?,error_message=?,updated_at=? WHERE tenant_id=? AND provider_message_id=?").bind(chosen?.id||null,String(error?.message||'send_failed').slice(0,180),new Date().toISOString(),tenantId,providerId).run();
  return{handled:false,reason:'send_failed'};
 }
}
