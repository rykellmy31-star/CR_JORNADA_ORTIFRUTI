import { Hono } from 'hono';
import { z } from 'zod';
import { type AppHonoEnv, logAudit } from '../context';
import {
  hashPassword,
  signJwt,
  verifyJwt,
  verifyPassword,
} from '../security/crypto';

export const authRoutes = new Hono<AppHonoEnv>();

const loginSchema = z.object({
  email: z.string().email('Informe um e-mail válido.'),
  password: z.string().min(4, 'Informe sua senha.'),
});

authRoutes.post('/login', async (c) => {
  const services = c.get('services');
  const body = await c.req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message || 'Dados inválidos.' }, 400);
  }

  const email = parsed.data.email.trim().toLowerCase();
  const user = await services.db
    .prepare(
      `SELECT u.id, u.tenant_id, u.name, u.email, u.password_hash, u.role, u.is_active,
              t.slug as tenant_slug, t.name as tenant_name, t.status as tenant_status,
              t.blocked_reason, t.primary_color
       FROM users u
       LEFT JOIN tenants t ON t.id = u.tenant_id
       WHERE lower(u.email) = ?`
    )
    .bind(email)
    .first<{
      id: string;
      tenant_id: string | null;
      name: string;
      email: string;
      password_hash: string;
      role: 'superadmin' | 'owner' | 'manager' | 'operator';
      is_active: number;
      tenant_slug: string | null;
      tenant_name: string | null;
      tenant_status: string | null;
      blocked_reason: string | null;
      primary_color: string | null;
    }>();

  if (!user) {
    return c.json({ error: 'E-mail ou senha incorretos.' }, 401);
  }

  const validPwd = await verifyPassword(parsed.data.password, user.password_hash);
  if (!validPwd) {
    await logAudit(services.db, {
      tenantId: user.tenant_id,
      actorUserId: user.id,
      actorRole: user.role,
      action: 'auth.login_failed',
      entityType: 'user',
      entityId: user.id,
    });
    return c.json({ error: 'E-mail ou senha incorretos.' }, 401);
  }

  if (!user.is_active) {
    return c.json({ error: 'Sua conta de usuário está desativada.' }, 403);
  }

  if (user.role !== 'superadmin') {
    if (!user.tenant_id || user.tenant_status !== 'active') {
      return c.json(
        {
          error: `O acesso do estabelecimento "${user.tenant_name || ''}" encontra-se bloqueado (${
            user.tenant_status || 'inativo'
          }). ${user.blocked_reason ? `Motivo: ${user.blocked_reason}` : 'Contate a CR Jornada.'}`,
          code: 'TENANT_BLOCKED',
        },
        403
      );
    }
  }

  const now = new Date().toISOString();
  await services.db
    .prepare(`UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?`)
    .bind(now, now, user.id)
    .run();

  const token = await signJwt(
    {
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      tenantId: user.tenant_id,
    },
    services.jwtSecret
  );

  await logAudit(services.db, {
    tenantId: user.tenant_id,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'auth.login_success',
    entityType: 'user',
    entityId: user.id,
  });

  return c.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      tenantId: user.tenant_id,
      tenantSlug: user.tenant_slug,
      tenantName: user.tenant_name,
      primaryColor: user.primary_color,
    },
  });
});

authRoutes.get('/me', async (c) => {
  const services = c.get('services');
  const header = c.req.header('Authorization') || '';
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (!token) {
    return c.json({ error: 'Não autenticado.' }, 401);
  }

  const claims = await verifyJwt(token, services.jwtSecret);
  if (!claims) {
    return c.json({ error: 'Sessão expirada.' }, 401);
  }

  const user = await services.db
    .prepare(
      `SELECT u.id, u.tenant_id, u.name, u.email, u.role, u.is_active,
              t.slug as tenant_slug, t.name as tenant_name, t.status as tenant_status, t.primary_color
       FROM users u
       LEFT JOIN tenants t ON t.id = u.tenant_id
       WHERE u.id = ?`
    )
    .bind(claims.sub)
    .first<Record<string, any>>();

  if (!user || !user.is_active) {
    return c.json({ error: 'Usuário inativo.' }, 403);
  }

  if (user.role !== 'superadmin' && user.tenant_status !== 'active') {
    return c.json({ error: 'Estabelecimento bloqueado.', code: 'TENANT_BLOCKED' }, 403);
  }

  return c.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      tenantId: user.tenant_id,
      tenantSlug: user.tenant_slug,
      tenantName: user.tenant_name,
      primaryColor: user.primary_color,
    },
  });
});

const changePwdSchema = z.object({
  currentPassword: z.string().min(4),
  newPassword: z.string().min(8, 'A nova senha deve ter pelo menos 8 caracteres.'),
});

authRoutes.post('/change-password', async (c) => {
  const services = c.get('services');
  const header = c.req.header('Authorization') || '';
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  const claims = token ? await verifyJwt(token, services.jwtSecret) : null;
  if (!claims) return c.json({ error: 'Não autenticado.' }, 401);

  const body = await c.req.json().catch(() => null);
  const parsed = changePwdSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message || 'Dados inválidos.' }, 400);
  }

  const user = await services.db
    .prepare(`SELECT id, tenant_id, password_hash, role FROM users WHERE id = ?`)
    .bind(claims.sub)
    .first<{ id: string; tenant_id: string | null; password_hash: string; role: string }>();

  if (!user) return c.json({ error: 'Usuário não encontrado.' }, 404);

  const ok = await verifyPassword(parsed.data.currentPassword, user.password_hash);
  if (!ok) {
    return c.json({ error: 'Senha atual incorreta.' }, 400);
  }

  const newHash = await hashPassword(parsed.data.newPassword);
  await services.db
    .prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`)
    .bind(newHash, new Date().toISOString(), user.id)
    .run();

  await logAudit(services.db, {
    tenantId: user.tenant_id,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'auth.password_changed',
    entityType: 'user',
    entityId: user.id,
  });

  return c.json({ success: true });
});
