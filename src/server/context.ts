import type { Context, Next } from 'hono';
import type { DbClient } from './db/adapter';
import type { MediaStorageAdapter } from './storage/r2-media';
import type { EvolutionEnvConfig } from './services/evolution-whatsapp';
import type { CloudflareDomainsConfig } from './services/cloudflare-domains';
import {
  generateId,
  timingSafeEqualStr,
  verifyJwt,
  type JwtClaims,
} from './security/crypto';

export interface AppRuntimeServices {
  db: DbClient;
  media: MediaStorageAdapter;
  jwtSecret: string;
  bootstrapSecret?: string;
  crmApiKey: string;
  crmWebhookUrl?: string;
  crmWebhookSecret?: string;
  appEnv: string;
  evolution: EvolutionEnvConfig;
  cloudflareDomains?: CloudflareDomainsConfig;
}

export type AppHonoEnv = {
  Variables: {
    services: AppRuntimeServices;
    authUser: JwtClaims;
    tenantId: string;
    tenantSlug: string;
    tenantName: string;
  };
};

export async function logAudit(
  db: DbClient,
  params: {
    tenantId?: string | null;
    actorUserId?: string | null;
    actorRole?: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    details?: Record<string, unknown>;
    ipAddress?: string | null;
  }
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO audit_logs (
           id, tenant_id, actor_user_id, actor_role, action,
           entity_type, entity_id, details_json, ip_address, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        generateId(),
        params.tenantId ?? null,
        params.actorUserId ?? null,
        params.actorRole ?? null,
        params.action,
        params.entityType,
        params.entityId ?? null,
        params.details ? JSON.stringify(params.details) : null,
        params.ipAddress ?? null,
        new Date().toISOString()
      )
      .run();
  } catch {
    // falha de log não deve derrubar transação principal
  }
}

function extractBearerToken(c: Context): string | null {
  const header = c.req.header('Authorization') || '';
  if (header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim();
  }
  return null;
}

/**
 * Middleware estrito de isolamento multiempresas para rotas `/api/admin/*`.
 * O `tenantId` é extraído EXCLUSIVAMENTE do JWT verificado no servidor e revalidado no banco,
 * garantindo que nenhuma empresa jamais acesse ou modifique dados de outra!
 */
export function requireTenantAdmin(allowedRoles?: Array<'owner' | 'manager' | 'operator'>) {
  return async (c: Context<AppHonoEnv>, next: Next) => {
    const services = c.get('services');
    const token = extractBearerToken(c);
    if (!token) {
      return c.json({ error: 'Autenticação obrigatória. Faça login no painel.' }, 401);
    }

    const claims = await verifyJwt(token, services.jwtSecret);
    if (!claims || !claims.tenantId) {
      return c.json({ error: 'Sessão inválida ou expirada. Faça login novamente.' }, 401);
    }

    if (claims.role === 'superadmin') {
      return c.json(
        { error: 'Conta Super-Admin deve utilizar o Console Central (/superadmin).' },
        403
      );
    }

    if (allowedRoles && !allowedRoles.includes(claims.role)) {
      return c.json(
        { error: 'Seu perfil de usuário não possui permissão para executar esta operação.' },
        403
      );
    }

    // Revalida usuário ativo e status da empresa em tempo real (bloqueio imediato pelo CRM!)
    const row = await services.db
      .prepare(
        `SELECT u.id as user_id, u.is_active as user_active, u.role as user_role,
                t.id as tenant_id, t.slug as tenant_slug, t.name as tenant_name,
                t.status as tenant_status, t.blocked_reason
         FROM users u
         INNER JOIN tenants t ON t.id = u.tenant_id
         WHERE u.id = ? AND u.tenant_id = ?`
      )
      .bind(claims.sub, claims.tenantId)
      .first<{
        user_id: string;
        user_active: number;
        user_role: string;
        tenant_id: string;
        tenant_slug: string;
        tenant_name: string;
        tenant_status: string;
        blocked_reason: string | null;
      }>();

    if (!row || !row.user_active) {
      return c.json({ error: 'Conta de usuário desativada ou inexistente.' }, 403);
    }

    if (row.tenant_status !== 'active') {
      return c.json(
        {
          error: `Acesso bloqueado para este estabelecimento (${row.tenant_status}). ${
            row.blocked_reason ? `Motivo: ${row.blocked_reason}` : 'Contate o suporte da CR Jornada.'
          }`,
          code: 'TENANT_BLOCKED',
        },
        403
      );
    }

    c.set('authUser', claims);
    c.set('tenantId', row.tenant_id);
    c.set('tenantSlug', row.tenant_slug);
    c.set('tenantName', row.tenant_name);
    await next();
  };
}

/**
 * Middleware para o Console Central Super-Admin da CR Jornada (`/api/superadmin/*`)
 */
export async function requireSuperAdmin(c: Context<AppHonoEnv>, next: Next) {
  const services = c.get('services');
  const token = extractBearerToken(c);
  if (!token) {
    return c.json({ error: 'Autenticação Super-Admin obrigatória.' }, 401);
  }

  const claims = await verifyJwt(token, services.jwtSecret);
  if (!claims || claims.role !== 'superadmin') {
    return c.json({ error: 'Acesso restrito à administração central da CR Jornada.' }, 403);
  }

  const user = await services.db
    .prepare(`SELECT id, is_active FROM users WHERE id = ? AND role = 'superadmin'`)
    .bind(claims.sub)
    .first<{ id: string; is_active: number }>();

  if (!user || !user.is_active) {
    return c.json({ error: 'Usuário Super-Admin inativo.' }, 403);
  }

  c.set('authUser', claims);
  await next();
}

/**
 * Middleware para a API de Integração CRM Multiempresas (`/api/crm/v1/*`).
 * Aceita tanto `X-CRM-API-Key` / `Authorization: Bearer <CRM_API_KEY>` (integração servidor-a-servidor)
 * quanto JWT válido de `superadmin` (para testes a partir do Console Central CR Jornada).
 */
export async function requireCrmIntegrationAuth(c: Context<AppHonoEnv>, next: Next) {
  const services = c.get('services');
  const apiKeyHeader = c.req.header('X-CRM-API-Key') || extractBearerToken(c) || '';

  if (
    services.crmApiKey &&
    apiKeyHeader &&
    timingSafeEqualStr(apiKeyHeader, services.crmApiKey)
  ) {
    await next();
    return;
  }

  // Também aceita JWT de Super-Admin para operação unificada
  if (apiKeyHeader.split('.').length === 3) {
    const claims = await verifyJwt(apiKeyHeader, services.jwtSecret);
    if (claims && claims.role === 'superadmin') {
      c.set('authUser', claims);
      await next();
      return;
    }
  }

  return c.json(
    {
      error: 'Credencial de integração CRM inválida ou ausente. Envie o header X-CRM-API-Key ou Authorization: Bearer <CRM_API_KEY>.',
    },
    401
  );
}
