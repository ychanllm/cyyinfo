import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import type { Env } from '../types';
import { verifyJwt } from '../auth';
import { contentGuard, getSetting } from '../guard';

const likes = new Hono<{ Bindings: Env }>();

const TARGET_TYPES = ['album', 'photo', 'diary', 'message'];
const MAX_PER_USER = 50; // 单用户单目标连赞上限
const MAX_DELTA = 10;    // 单次 burst 最大增量

function parseTarget(type: string | undefined, idRaw: unknown): { type: string; id: number } | null {
  const id = typeof idRaw === 'string' ? Number(idRaw) : idRaw;
  if (!type || !TARGET_TYPES.includes(type)) return null;
  if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) return null;
  return { type, id };
}

async function countOf(db: D1Database, type: string, id: number): Promise<number> {
  const row = await db.prepare('SELECT COALESCE(SUM(count), 0) AS n FROM likes WHERE target_type = ? AND target_id = ?')
    .bind(type, id).first<{ n: number }>();
  return row?.n ?? 0;
}

// 解析点赞用户 id：注册用户 → 自身；管理员 → 后台「设置」里配置的点赞归属用户（settings.admin_like_user_id）
async function resolveLikerId(db: D1Database, payload: Record<string, unknown>): Promise<number | null> {
  if (payload.role === 'user') return payload.sub as number;
  if (payload.role === 'admin') {
    const configured = Number(await getSetting(db, 'admin_like_user_id'));
    if (!Number.isInteger(configured) || configured <= 0) return null;
    const u = await db.prepare('SELECT id FROM users WHERE id = ?').bind(configured).first();
    return u ? configured : null;
  }
  return null;
}

// 点赞鉴权：注册用户或管理员；管理员未配置归属用户时 400 提示
async function likerAuth(c: Context<{ Bindings: Env }>, next: Next) {
  const header = c.req.header('Authorization') ?? '';
  const token = header.replace(/^Bearer\s+/i, '');
  const payload = token ? await verifyJwt(c.env, token) : null;
  if (!payload || (payload.role !== 'user' && payload.role !== 'admin')) {
    return c.json({ detail: '请先登录' }, 401);
  }
  const likerId = await resolveLikerId(c.env.DB, payload);
  if (!likerId) return c.json({ detail: '管理员点赞需先在后台「设置」指定点赞归属用户' }, 400);
  c.set('liker', { id: likerId });
  await next();
}

// 从可选的 Authorization 中解析点赞用户 id（无 token / 访客 token 视为未登录；管理员映射到归属用户）
async function optionalUserId(c: Context<{ Bindings: Env }>): Promise<number | null> {
  const header = c.req.header('Authorization') ?? '';
  const token = header.replace(/^Bearer\s+/i, '');
  const payload = token ? await verifyJwt(c.env, token) : null;
  return payload ? resolveLikerId(c.env.DB, payload) : null;
}

// 点赞/取消点赞（注册用户或配置了归属用户的管理员）
likes.post('/toggle', likerAuth, async (c) => {
  const me = c.get('liker') as { id: number };
  const body = await c.req.json<{ target_type?: string; target_id?: number }>().catch(() => ({}));
  const target = parseTarget(body.target_type, body.target_id);
  if (!target) return c.json({ detail: '非法点赞目标' }, 400);

  const db = c.env.DB;
  const del = await db.prepare('DELETE FROM likes WHERE user_id = ? AND target_type = ? AND target_id = ?')
    .bind(me.id, target.type, target.id).run();
  let liked: boolean;
  if (del.meta.changes) {
    liked = false; // 已赞过 → 取消
  } else {
    // UNIQUE(user_id, target_type, target_id) 兜底并发重复点赞
    await db.prepare('INSERT INTO likes (user_id, target_type, target_id) VALUES (?, ?, ?)')
      .bind(me.id, target.type, target.id).run();
    liked = true;
  }
  return c.json({ liked, count: await countOf(db, target.type, target.id) });
});

// 连赞：同一用户可累加多个赞（注册用户或配置了归属用户的管理员），单用户单目标上限 50
likes.post('/burst', likerAuth, async (c) => {
  const me = c.get('liker') as { id: number };
  const body = await c.req.json<{ target_type?: string; target_id?: number; delta?: number }>().catch(() => ({}));
  const target = parseTarget(body.target_type, body.target_id);
  if (!target) return c.json({ detail: '非法点赞目标' }, 400);
  const delta = body.delta;
  if (typeof delta !== 'number' || !Number.isInteger(delta) || delta < 1 || delta > MAX_DELTA) {
    return c.json({ detail: '非法 delta' }, 400);
  }
  const db = c.env.DB;
  await db.prepare(
    `INSERT INTO likes (user_id, target_type, target_id, count) VALUES (?, ?, ?, MIN(?, ?))
     ON CONFLICT(user_id, target_type, target_id) DO UPDATE SET count = MIN(count + ?, ?)`
  ).bind(me.id, target.type, target.id, delta, MAX_PER_USER, delta, MAX_PER_USER).run();
  return c.json({ liked: true, count: await countOf(db, target.type, target.id) });
});

// 单个目标的计数（与公开内容同一鉴权层级；liked 仅对登录用户有意义）
likes.get('/', contentGuard, async (c) => {
  const target = parseTarget(c.req.query('target_type'), c.req.query('target_id'));
  if (!target) return c.json({ detail: '非法点赞目标' }, 400);
  const db = c.env.DB;
  const userId = await optionalUserId(c);
  const liked = userId
    ? Boolean(await db.prepare('SELECT id FROM likes WHERE user_id = ? AND target_type = ? AND target_id = ?')
        .bind(userId, target.type, target.id).first())
    : false;
  return c.json({ count: await countOf(db, target.type, target.id), liked });
});

// 批量计数（列表页用）：ids 逗号分隔，上限 100
likes.get('/batch', contentGuard, async (c) => {
  const type = c.req.query('target_type') ?? '';
  if (!TARGET_TYPES.includes(type)) return c.json({ detail: '非法点赞目标' }, 400);
  const ids = [...new Set(
    (c.req.query('ids') ?? '').split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0)
  )];
  if (ids.length > 100) return c.json({ detail: 'ids 最多 100 个' }, 400);
  if (!ids.length) return c.json({});

  const db = c.env.DB;
  const placeholders = ids.map(() => '?').join(',');
  const { results: counts } = await db.prepare(
    `SELECT target_id, COALESCE(SUM(count), 0) AS n FROM likes WHERE target_type = ? AND target_id IN (${placeholders}) GROUP BY target_id`
  ).bind(type, ...ids).all<{ target_id: number; n: number }>();
  const countMap = new Map(counts.map((r) => [r.target_id, r.n]));

  const likedSet = new Set<number>();
  const userId = await optionalUserId(c);
  if (userId) {
    const { results: mine } = await db.prepare(
      `SELECT target_id FROM likes WHERE user_id = ? AND target_type = ? AND target_id IN (${placeholders})`
    ).bind(userId, type, ...ids).all<{ target_id: number }>();
    mine.forEach((r) => likedSet.add(r.target_id));
  }

  const out: Record<string, { count: number; liked: boolean }> = {};
  for (const id of ids) out[String(id)] = { count: countMap.get(id) ?? 0, liked: likedSet.has(id) };
  return c.json(out);
});

export default likes;
