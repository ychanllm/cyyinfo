import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import type { AppEnv, Env } from '../types';
import { verifyJwt } from '../auth';
import { contentGuard, getSetting } from '../guard';
import { logAudit } from '../audit';

const likes = new Hono<AppEnv>();

const TARGET_TYPES = ['album', 'photo', 'diary', 'message'];
const MAX_PER_DAY = 50; // 单用户单目标每日点赞上限（按北京时间自然日）
const MAX_DELTA = 10;   // 单次 burst 最大增量

// 北京时间（UTC+8）当日日期 YYYY-MM-DD
function todayCN(): string {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

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
async function likerAuth(c: Context<AppEnv>, next: Next) {
  const header = c.req.header('Authorization') ?? '';
  const token = header.replace(/^Bearer\s+/i, '');
  const payload = token ? await verifyJwt(c.env, token) : null;
  if (!payload || (payload.role !== 'user' && payload.role !== 'admin')) {
    return c.json({ detail: '请先登录' }, 401);
  }
  const likerId = await resolveLikerId(c.env.DB, payload);
  if (!likerId) return c.json({ detail: '管理员点赞需先在后台「设置」指定点赞归属用户' }, 400);
  // liker.id 是点赞归属（管理员时为归属用户）；liker.username 是实际操作者（写审计日志用）
  c.set('liker', { id: likerId, username: payload.username as string });
  await next();
}

// 从可选的 Authorization 中解析点赞用户 id（无 token / 访客 token 视为未登录；管理员映射到归属用户）
async function optionalUserId(c: Context<AppEnv>): Promise<number | null> {
  const header = c.req.header('Authorization') ?? '';
  const token = header.replace(/^Bearer\s+/i, '');
  const payload = token ? await verifyJwt(c.env, token) : null;
  return payload ? resolveLikerId(c.env.DB, payload) : null;
}

// 点赞/取消点赞（注册用户或配置了归属用户的管理员）
likes.post('/toggle', likerAuth, async (c) => {
  const me = c.get('liker') as { id: number; username: string };
  const body = await c.req.json<{ target_type?: string; target_id?: number }>()
    .catch((): { target_type?: string; target_id?: number } => ({}));
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
  await logAudit(db, liked ? 'like' : 'unlike', me.username, `${liked ? '点赞' : '取消点赞'} ${target.type}#${target.id}`);
  return c.json({ liked, count: await countOf(db, target.type, target.id) });
});

// 连赞：同一用户可累加多个赞（注册用户或配置了归属用户的管理员），每人每天单目标上限 50
likes.post('/burst', likerAuth, async (c) => {
  const me = c.get('liker') as { id: number; username: string };
  const body = await c.req.json<{ target_type?: string; target_id?: number; delta?: number }>()
    .catch((): { target_type?: string; target_id?: number; delta?: number } => ({}));
  const target = parseTarget(body.target_type, body.target_id);
  if (!target) return c.json({ detail: '非法点赞目标' }, 400);
  const delta = body.delta;
  if (typeof delta !== 'number' || !Number.isInteger(delta) || delta < 1 || delta > MAX_DELTA) {
    return c.json({ detail: '非法 delta' }, 400);
  }
  const db = c.env.DB;
  const today = todayCN();
  // 语句 A（幂等）：把行规范化到当日窗口——不存在则插入；存在且跨天则清零 daily_count
  await db.prepare(
    `INSERT INTO likes (user_id, target_type, target_id, count, daily_count, daily_date)
     VALUES (?, ?, ?, 0, 0, ?)
     ON CONFLICT(user_id, target_type, target_id) DO UPDATE SET
       daily_count = CASE WHEN daily_date = ? THEN daily_count ELSE 0 END,
       daily_date = ?`
  ).bind(me.id, target.type, target.id, today, today, today).run();
  // 语句 B 前读一次当日已用额度，用于计算实际增量（写审计；并发下允许轻微不准）
  const before = await db.prepare(
    'SELECT daily_count FROM likes WHERE user_id = ? AND target_type = ? AND target_id = ?'
  ).bind(me.id, target.type, target.id).first<{ daily_count: number }>();
  // 语句 B（原子扣减额度）：单条 UPDATE 内读写在 SQLite/D1 中原子，并发下后者看到前者已更新的 daily_count，不会超每日上限
  const after = await db.prepare(
    `UPDATE likes SET
       count = count + MIN(?, MAX(0, ? - daily_count)),
       daily_count = MIN(daily_count + ?, ?)
     WHERE user_id = ? AND target_type = ? AND target_id = ? AND daily_date = ?
     RETURNING daily_count`
  ).bind(delta, MAX_PER_DAY, delta, MAX_PER_DAY, me.id, target.type, target.id, today)
    .first<{ daily_count: number }>();
  const dailyUsed = after?.daily_count ?? 0;
  const applied = dailyUsed - (before?.daily_count ?? 0);
  // 额度耗尽（实际增量为 0）时不写「连赞 +0」审计
  if (applied > 0) {
    await logAudit(db, 'like_burst', me.username, `连赞 +${applied} ${target.type}#${target.id}`);
  }
  return c.json({
    liked: true,
    count: await countOf(db, target.type, target.id),
    daily_remaining: MAX_PER_DAY - dailyUsed,
  });
});

// 单个目标的计数（与公开内容同一鉴权层级；liked / daily_remaining 仅对登录用户有意义）
likes.get('/', contentGuard, async (c) => {
  const target = parseTarget(c.req.query('target_type'), c.req.query('target_id'));
  if (!target) return c.json({ detail: '非法点赞目标' }, 400);
  const db = c.env.DB;
  const userId = await optionalUserId(c);
  const mine = userId
    ? await db.prepare('SELECT id, daily_count, daily_date FROM likes WHERE user_id = ? AND target_type = ? AND target_id = ?')
        .bind(userId, target.type, target.id)
        .first<{ id: number; daily_count: number; daily_date: string | null }>()
    : null;
  const body: { count: number; liked: boolean; daily_remaining?: number } = {
    count: await countOf(db, target.type, target.id),
    liked: Boolean(mine),
  };
  if (userId) {
    body.daily_remaining = MAX_PER_DAY - (mine && mine.daily_date === todayCN() ? mine.daily_count : 0);
  }
  return c.json(body);
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
  const remainingMap = new Map<number, number>();
  const userId = await optionalUserId(c);
  if (userId) {
    const today = todayCN();
    const { results: mine } = await db.prepare(
      `SELECT target_id, daily_count, daily_date FROM likes WHERE user_id = ? AND target_type = ? AND target_id IN (${placeholders})`
    ).bind(userId, type, ...ids).all<{ target_id: number; daily_count: number; daily_date: string | null }>();
    mine.forEach((r) => {
      likedSet.add(r.target_id);
      remainingMap.set(r.target_id, MAX_PER_DAY - (r.daily_date === today ? r.daily_count : 0));
    });
  }

  const out: Record<string, { count: number; liked: boolean; daily_remaining?: number }> = {};
  for (const id of ids) {
    out[String(id)] = { count: countMap.get(id) ?? 0, liked: likedSet.has(id) };
    if (userId) out[String(id)].daily_remaining = remainingMap.get(id) ?? MAX_PER_DAY;
  }
  return c.json(out);
});

export default likes;
