import QRCode from 'qrcode';
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
}

export const DEFAULT_WHATSAPP_TEMPLATES: Array<{
  event_type: WhatsAppEventType;
  title: string;
  is_enabled: number;
  message_template: string;
}> = [
  {
    event_type: 'order_received',
    title: 'Pedido Recebido (Aguardando Confirmação)',
    is_enabled: 1,
    message_template:
      'Olá, {primeiro_nome}! 🥬 Recebemos o seu pedido *#{numero_pedido}* no *{nome_estabelecimento}* e ele aguarda confirmação.\n\nValor total: *{valor_total}*\nPagamento: {forma_pagamento}{troco_info}\n\nAssim que o estabelecimento aceitar o pedido, avisaremos você por aqui!',
  },
  {
    event_type: 'order_accepted',
    title: 'Pedido Aceito (Com Resumo Completo)',
    is_enabled: 1,
    message_template:
      'Olá, {primeiro_nome}! ✅ Seu pedido *#{numero_pedido}* no *{nome_estabelecimento}* foi *ACEITO*!\n\n*Produtos solicitados:*\n{itens_pedido}\n\nSubtotal: {subtotal}\nTaxa de entrega: {taxa_entrega}\n*Total: {valor_total}*\nPagamento: {forma_pagamento}{troco_info}\n\nVocê será avisado automaticamente assim que o seu pedido sair para entrega! 🚚',
  },
  {
    event_type: 'order_preparing',
    title: 'Pedido em Preparação',
    is_enabled: 0,
    message_template:
      'Olá, {primeiro_nome}! 🧺 Estamos separando os produtos fresquinhos do seu pedido *#{numero_pedido}* no *{nome_estabelecimento}*.',
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
export async function connectOrRefreshWhatsAppQr(
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
    .first<Record<string, unknown>>();

  if (!inst) {
    throw new Error('Instância WhatsApp não encontrada para este estabelecimento.');
  }

  const instanceName = String(inst.instance_name);
  const isLive = isLiveEvolutionConfigured(envCfg);

  if (isLive) {
    const baseUrl = envCfg.evolutionApiUrl!.replace(/\/+$/, '');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      apikey: envCfg.evolutionApiKey!,
    };

    try {
      // 1. Tenta buscar conexão/QR existente ou criar a instância automaticamente
      let connectResp = await fetch(`${baseUrl}/instance/connect/${encodeURIComponent(instanceName)}`, {
        method: 'GET',
        headers,
      });

      if (connectResp.status === 404) {
        const createBody: Record<string, unknown> = {
          instanceName,
          qrcode: true,
          integration: 'WHATSAPP-BAILEYS',
        };
        if (envCfg.publicWebhookUrl && envCfg.evolutionWebhookToken) {
          createBody.webhook = {
            url: `${envCfg.publicWebhookUrl.replace(/\/+$/, '')}/api/webhooks/evolution`,
            byEvents: false,
            base64: true,
            headers: envCfg.evolutionWebhookToken
              ? { 'x-evolution-token': envCfg.evolutionWebhookToken }
              : undefined,
            events: ['QRCODE_UPDATED', 'CONNECTION_UPDATE'],
          };
        }

        const createResp = await fetch(`${baseUrl}/instance/create`, {
          method: 'POST',
          headers,
          body: JSON.stringify(createBody),
        });

        if (!createResp.ok) {
          const errTxt = await createResp.text();
          throw new Error(`Falha ao provisionar instância na Evolution API (${createResp.status}): ${errTxt.slice(0, 160)}`);
        }

        const createdData = (await createResp.json()) as Record<string, any>;
        const qrBase64 =
          createdData?.qrcode?.base64 ||
          (createdData?.qrcode?.code ? await generateSvgQrBase64(createdData.qrcode.code) : null);

        await db
          .prepare(
            `UPDATE whatsapp_instances
             SET status = 'qr_pending', qr_code_base64 = ?, qr_code_text = ?, qr_updated_at = ?,
                 provider_mode = 'evolution_live', last_error = NULL, updated_at = ?
             WHERE tenant_id = ?`
          )
          .bind(
            qrBase64,
            createdData?.qrcode?.code || null,
            now,
            now,
            tenantId
          )
          .run();
      } else if (connectResp.ok) {
        const data = (await connectResp.json()) as Record<string, any>;
        if (data?.instance?.state === 'open' || data?.state === 'open') {
          await db
            .prepare(
              `UPDATE whatsapp_instances
               SET status = 'connected', qr_code_base64 = NULL, qr_code_text = NULL,
                   connected_at = COALESCE(connected_at, ?), last_checked_at = ?,
                   provider_mode = 'evolution_live', last_error = NULL, updated_at = ?
               WHERE tenant_id = ?`
            )
            .bind(now, now, now, tenantId)
            .run();
        } else {
          const qrBase64 =
            data?.base64 ||
            data?.qrcode?.base64 ||
            (data?.code ? await generateSvgQrBase64(data.code) : null);

          await db
            .prepare(
              `UPDATE whatsapp_instances
               SET status = 'qr_pending', qr_code_base64 = ?, qr_code_text = ?, qr_updated_at = ?,
                   provider_mode = 'evolution_live', last_error = NULL, updated_at = ?
               WHERE tenant_id = ?`
            )
            .bind(qrBase64, data?.code || null, now, now, tenantId)
            .run();
        }
      } else {
        throw new Error(`Evolution API retornou HTTP ${connectResp.status} ao solicitar QR Code.`);
      }
    } catch (err: any) {
      const msg = sanitizeEvolutionError(err?.message || 'Erro de comunicação com o servidor Evolution API.', envCfg);
      await db
        .prepare(
          `UPDATE whatsapp_instances SET last_error = ?, updated_at = ? WHERE tenant_id = ?`
        )
        .bind(msg, now, tenantId)
        .run();
      throw new Error(msg);
    }
  } else {
    // Modo Homologação Integrado (quando EVOLUTION_API_URL ainda não foi configurada)
    const tokenNonce = crypto.randomUUID().slice(0, 12);
    const pairingPayload = `2@CRJORNADA_EVOLUTION:${instanceName}:${tokenNonce}:${Date.now()}`;
    const qrSvgDataUri = await generateSvgQrBase64(pairingPayload);

    await db
      .prepare(
        `UPDATE whatsapp_instances
         SET status = 'qr_pending',
             qr_code_base64 = ?,
             qr_code_text = ?,
             qr_updated_at = ?,
             provider_mode = 'homologation',
             last_error = NULL,
             updated_at = ?
         WHERE tenant_id = ?`
      )
      .bind(qrSvgDataUri, pairingPayload, now, now, tenantId)
      .run();
  }

  return getSanitizedWhatsAppStatus(db, tenantId, envCfg);
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
        } else {
          await db
            .prepare(
              `UPDATE whatsapp_instances
               SET status = 'disconnected', last_checked_at = ?, provider_mode = 'evolution_live', updated_at = ?
               WHERE tenant_id = ?`
            )
            .bind(now, now, tenantId)
            .run();
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
    const baseUrl = envCfg.evolutionApiUrl!.replace(/\/+$/, '');
    try {
      await fetch(`${baseUrl}/instance/logout/${encodeURIComponent(inst.instance_name)}`, {
        method: 'DELETE',
        headers: { apikey: envCfg.evolutionApiKey! },
      });
    } catch {
      // prossegue com limpeza local do status
    }
  }

  await db
    .prepare(
      `UPDATE whatsapp_instances
       SET status = 'disconnected',
           connected_phone = NULL,
           profile_name = NULL,
           qr_code_base64 = NULL,
           qr_code_text = NULL,
           connected_at = NULL,
           last_error = NULL,
           updated_at = ?
       WHERE tenant_id = ?`
    )
    .bind(now, tenantId)
    .run();

  return getSanitizedWhatsAppStatus(db, tenantId, envCfg);
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
    status: (inst?.status as 'disconnected' | 'qr_pending' | 'connected') || 'disconnected',
    connected_phone: inst?.connected_phone ? formatPhoneBR(inst.connected_phone) : null,
    connected_phone_raw: inst?.connected_phone || null,
    profile_name: inst?.profile_name || null,
    qr_code_base64: inst?.qr_code_base64 || null,
    qr_updated_at: inst?.qr_updated_at || null,
    connected_at: inst?.connected_at || null,
    last_checked_at: inst?.last_checked_at || null,
    provider_mode: isLive ? 'evolution_live' : 'homologation',
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
    .replace(/\{status_pedido\}/g, vars.status_pedido);
}

/**
 * Enfileira (com chave de idempotência anti-duplicação) e dispara imediatamente
 * a notificação transacional do ciclo do pedido via WhatsApp.
 */
export async function enqueueAndDispatchOrderWhatsAppNotification(
  db: DbClient,
  tenantId: string,
  orderId: string,
  eventType: WhatsAppEventType,
  envCfg: EvolutionEnvConfig
): Promise<{ queued: boolean; status: string; queueId?: string }> {
  const tenant = await db
    .prepare(`SELECT id, name, slug FROM tenants WHERE id = ?`)
    .bind(tenantId)
    .first<{ id: string; name: string; slug: string }>();

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
      `SELECT product_name_snapshot, quantity_display, line_total_cents
       FROM order_items
       WHERE order_id = ? AND tenant_id = ?`
    )
    .bind(orderId, tenantId)
    .all<{
      product_name_snapshot: string;
      quantity_display: string;
      line_total_cents: number;
    }>();

  const itemsText = items
    .map(
      (it) =>
        `• ${it.product_name_snapshot} (${it.quantity_display}) — ${formatBRL(it.line_total_cents)}`
    )
    .join('\n');

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
      order.delivery_fee_cents === 0 ? 'Grátis' : formatBRL(order.delivery_fee_cents),
    valor_total: formatBRL(order.total_cents),
    forma_pagamento: paymentLabel,
    troco_info: trocoInfo,
    endereco_entrega: addressParts.join(' - '),
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

  const inst = await db
    .prepare(`SELECT * FROM whatsapp_instances WHERE tenant_id = ?`)
    .bind(tenantId)
    .first<Record<string, any>>();

  const now = new Date().toISOString();
  const attemptNum = Number(msg.attempts || 0) + 1;
  const maxAttempts = Number(msg.max_attempts || 3);

  if (!inst || inst.status !== 'connected') {
    const backoffSeconds = Math.min(300, Math.pow(2, attemptNum) * 30);
    const nextRetry = new Date(Date.now() + backoffSeconds * 1000).toISOString();
    const newStatus = attemptNum >= maxAttempts ? 'failed' : 'pending';
    const errText =
      'Instância WhatsApp desconectada no estabelecimento. Conecte o WhatsApp para disparar mensagens pendentes.';

    await db
      .prepare(
        `UPDATE whatsapp_message_queue
         SET status = ?, attempts = ?, next_retry_at = ?, last_error = ?, updated_at = ?
         WHERE id = ? AND tenant_id = ?`
      )
      .bind(newStatus, attemptNum, nextRetry, errText, now, queueId, tenantId)
      .run();

    return { status: newStatus, error: errText };
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
        const bodyTxt = await resp.text();
        throw new Error(`Evolution HTTP ${resp.status}: ${bodyTxt.slice(0, 180)}`);
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
  } else {
    // Homologation Gateway: instância conectada -> registra envio homologado auditável
    const simMsgId = `homolog_${generateId().slice(0, 12)}`;
    await db
      .prepare(
        `UPDATE whatsapp_message_queue
         SET status = 'sent', attempts = ?, sent_at = ?, provider_message_id = ?,
             last_error = NULL, updated_at = ?
         WHERE id = ? AND tenant_id = ?`
      )
      .bind(attemptNum, now, simMsgId, now, queueId, tenantId)
      .run();

    return { status: 'sent' };
  }
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
