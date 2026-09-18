import { SignJWT, jwtVerify } from 'jose';
import type { Context, Next } from 'hono';
import type { AppEnv, Env } from './types';

const encoder = new TextEncoder();

export async function signJwt(env: Env, payload: Record<string, unknown>, expireHours?: number): Promise<string> {
  const hours = expireHours ?? Number(env.JWT_EXPIRE_HOURS || 72);
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${hours}h`)
    .sign(encoder.encode(env.JWT_SECRET));
}

export async function verifyJwt(env: Env, token: string): Promise<Record<string, unknown> | null> {
  try {
    const { payload } = await jwtVerify(token, encoder.encode(env.JWT_SECRET));
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function adminAuth(c: Context<AppEnv>, next: Next) {
  const header = c.req.header('Authorization') ?? '';
  const token = header.replace(/^Bearer\s+/i, '');
  const payload = token ? await verifyJwt(c.env, token) : null;
  if (!payload || payload.role !== 'admin') {
    return c.json({ detail: '未授权' }, 401);
  }
  const id = Number(payload.sub);
  const account = await c.env.DB.prepare('SELECT id, username, auth_version FROM admin_users WHERE id = ?')
    .bind(id).first<{ id: number; username: string; auth_version: number }>();
  if (!account || (payload.auth_version !== account.auth_version
    && !(payload.auth_version === undefined && account.auth_version === 0))) {
    return c.json({ detail: 'Session expired' }, 401);
  }
  c.set('admin', { id: account.id, username: account.username });
  await next();
}

export async function userAuth(c: Context<AppEnv>, next: Next) {
  const header = c.req.header('Authorization') ?? '';
  const token = header.replace(/^Bearer\s+/i, '');
  const payload = token ? await verifyJwt(c.env, token) : null;
  if (!payload || payload.role !== 'user') {
    return c.json({ detail: '请先登录' }, 401);
  }
  const id = Number(payload.sub);
  const account = await c.env.DB.prepare('SELECT id, username, auth_version FROM users WHERE id = ?')
    .bind(id).first<{ id: number; username: string; auth_version: number }>();
  if (!account || (payload.auth_version !== account.auth_version
    && !(payload.auth_version === undefined && account.auth_version === 0))) {
    return c.json({ detail: 'Session expired' }, 401);
  }
  c.set('user', { id: account.id, username: account.username });
  await next();
}

// 内容权限门岗：管理员直接放行；注册用户持有对应授权（user_permissions）也可访问，每请求查库，撤销立即生效
export function contentAuth(permission: 'diary' | 'album') {
  return async (c: Context<AppEnv>, next: Next) => {
    const header = c.req.header('Authorization') ?? '';
    const token = header.replace(/^Bearer\s+/i, '');
    const payload = token ? await verifyJwt(c.env, token) : null;
    if (!payload) return c.json({ detail: '未授权' }, 401);
    if (payload.role === 'admin') {
      const id = Number(payload.sub);
      const account = await c.env.DB.prepare('SELECT id, username, auth_version FROM admin_users WHERE id = ?')
        .bind(id).first<{ id: number; username: string; auth_version: number }>();
      if (!account || (payload.auth_version !== account.auth_version
        && !(payload.auth_version === undefined && account.auth_version === 0))) {
        return c.json({ detail: 'Session expired' }, 401);
      }
      c.set('admin', { id: account.id, username: account.username });
      await next();
      return;
    }
    if (payload.role === 'user') {
      const id = Number(payload.sub);
      const account = await c.env.DB.prepare('SELECT id, username, auth_version FROM users WHERE id = ?')
        .bind(id).first<{ id: number; username: string; auth_version: number }>();
      if (!account || (payload.auth_version !== account.auth_version
        && !(payload.auth_version === undefined && account.auth_version === 0))) {
        return c.json({ detail: 'Session expired' }, 401);
      }
      const perm = await c.env.DB.prepare('SELECT 1 AS ok FROM user_permissions WHERE user_id = ? AND permission = ?')
        .bind(id, permission).first();
      if (!perm) return c.json({ detail: '未授权' }, 401);
      c.set('user', { id: account.id, username: account.username });
      await next();
      return;
    }
    return c.json({ detail: '未授权' }, 401);
  };
}
