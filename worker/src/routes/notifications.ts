import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import type { AppEnv } from '../types';
import { verifyJwt } from '../auth';

const notifications = new Hono<AppEnv>();

// 通知鉴权：注册用户或站长本人；auth_version 校验与 userAuth/adminAuth 一致
async function recipientAuth(c: Context<AppEnv>, next: Next) {
  const header = c.req.header('Authorization') ?? '';
  const token = header.replace(/^Bearer\s+/i, '');
  const payload = token ? await verifyJwt(c.env, token) : null;
  if (!payload || (payload.role !== 'user' && payload.role !== 'admin')) {
    return c.json({ detail: '请先登录' }, 401);
  }
  const id = Number(payload.sub);
  const table = payload.role === 'user' ? 'users' : 'admin_users';
  const account = await c.env.DB.prepare(`SELECT id, username, auth_version FROM ${table} WHERE id = ?`)
    .bind(id).first<{ id: number; username: string; auth_version: number }>();
  if (!account || (payload.auth_version !== account.auth_version
    && !(payload.auth_version === undefined && account.auth_version === 0))) {
    return c.json({ detail: 'Session expired' }, 401);
  }
  c.set('recipient', { type: payload.role as 'user' | 'admin', id: account.id });
  await next();
}

// 未读通知：count + 最近 20 条摘要（excerpt 为被回复/被评论内容的截断）
notifications.get('/notifications/unread', recipientAuth, async (c) => {
  const r = c.get('recipient');
  const db = c.env.DB;
  const { results } = await db.prepare(
    `SELECT n.id, n.type, n.actor_nickname, n.target_type, n.target_id, n.created_at,
            substr(m.content, 1, 60) AS excerpt
     FROM notifications n JOIN messages m ON m.id = n.message_id
     WHERE n.recipient_type = ? AND n.recipient_id = ? AND n.is_read = 0
     ORDER BY n.id DESC LIMIT 20`
  ).bind(r.type, r.id).all();
  const total = await db.prepare(
    'SELECT COUNT(*) AS n FROM notifications WHERE recipient_type = ? AND recipient_id = ? AND is_read = 0'
  ).bind(r.type, r.id).first<{ n: number }>();
  return c.json({ count: total?.n ?? 0, items: results });
});

// 标记已读：body.ids 为数组时标记指定 id（仅限自己的），否则全部已读
notifications.post('/notifications/read', recipientAuth, async (c) => {
  const r = c.get('recipient');
  const body = await c.req.json<{ ids?: number[] }>().catch((): { ids?: number[] } => ({}));
  const db = c.env.DB;
  if (Array.isArray(body.ids) && body.ids.length) {
    const ids = body.ids.filter((n) => Number.isInteger(n) && n > 0).slice(0, 100);
    if (ids.length) {
      const placeholders = ids.map(() => '?').join(',');
      await db.prepare(
        `UPDATE notifications SET is_read = 1 WHERE recipient_type = ? AND recipient_id = ? AND id IN (${placeholders})`
      ).bind(r.type, r.id, ...ids).run();
    }
  } else {
    await db.prepare(
      'UPDATE notifications SET is_read = 1 WHERE recipient_type = ? AND recipient_id = ?'
    ).bind(r.type, r.id).run();
  }
  return c.json({ ok: true });
});

export default notifications;
