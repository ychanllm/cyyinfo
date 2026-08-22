import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../types';
import { userAuth, verifyJwt } from '../auth';
import { contentGuard } from '../guard';

const likes = new Hono<{ Bindings: Env }>();

const TARGET_TYPES = ['album', 'photo', 'diary'];

function parseTarget(type: string | undefined, idRaw: unknown): { type: string; id: number } | null {
  const id = typeof idRaw === 'string' ? Number(idRaw) : idRaw;
  if (!type || !TARGET_TYPES.includes(type)) return null;
  if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) return null;
  return { type, id };
}

async function countOf(db: D1Database, type: string, id: number): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM likes WHERE target_type = ? AND target_id = ?')
    .bind(type, id).first<{ n: number }>();
  return row?.n ?? 0;
}

// 从可选的 Authorization 中取登录用户 id（无 token / 访客或管理员 token 则视为未登录）
async function optionalUserId(c: Context<{ Bindings: Env }>): Promise<number | null> {
  const header = c.req.header('Authorization') ?? '';
  const token = header.replace(/^Bearer\s+/i, '');
  const payload = token ? await verifyJwt(c.env, token) : null;
  return payload && payload.role === 'user' ? (payload.sub as number) : null;
}

// 点赞/取消点赞（需登录用户）
likes.post('/toggle', userAuth, async (c) => {
  const me = c.get('user') as { id: number };
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
    `SELECT target_id, COUNT(*) AS n FROM likes WHERE target_type = ? AND target_id IN (${placeholders}) GROUP BY target_id`
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
