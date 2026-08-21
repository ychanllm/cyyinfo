import type { Context, Next } from 'hono';
import type { Env } from './types';
import { verifyJwt } from './auth';

export async function getSetting(db: D1Database, key: string): Promise<string> {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? '';
}

export async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, value).run();
}

// 公开内容守卫：口令为空放行，否则要求 admin/guest/user JWT
export async function contentGuard(c: Context<{ Bindings: Env }>, next: Next) {
  const hash = await getSetting(c.env.DB, 'site_passcode_hash');
  if (!hash) return next();
  const header = c.req.header('Authorization') ?? '';
  const token = header.replace(/^Bearer\s+/i, '');
  const payload = token ? await verifyJwt(c.env, token) : null;
  if (!payload || (payload.role !== 'guest' && payload.role !== 'admin' && payload.role !== 'user')) {
    return c.json({ detail: '需要访客口令' }, 401);
  }
  await next();
}
