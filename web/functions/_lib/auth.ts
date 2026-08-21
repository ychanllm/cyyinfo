import { SignJWT, jwtVerify } from 'jose';
import type { Context, Next } from 'hono';
import type { Env } from './types';

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

export async function adminAuth(c: Context<{ Bindings: Env }>, next: Next) {
  const header = c.req.header('Authorization') ?? '';
  const token = header.replace(/^Bearer\s+/i, '');
  const payload = token ? await verifyJwt(c.env, token) : null;
  if (!payload || payload.role !== 'admin') {
    return c.json({ detail: '未授权' }, 401);
  }
  c.set('admin', { id: payload.sub as number, username: payload.username as string });
  await next();
}

export async function userAuth(c: Context<{ Bindings: Env }>, next: Next) {
  const header = c.req.header('Authorization') ?? '';
  const token = header.replace(/^Bearer\s+/i, '');
  const payload = token ? await verifyJwt(c.env, token) : null;
  if (!payload || payload.role !== 'user') {
    return c.json({ detail: '请先登录' }, 401);
  }
  c.set('user', { id: payload.sub as number, username: payload.username as string });
  await next();
}
