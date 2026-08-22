import { Hono } from 'hono';
import type { Env } from '../types';
import { userAuth } from '../auth';
import { contentGuard, getSetting } from '../guard';

const points = new Hono<{ Bindings: Env }>();

// ---- 签到/盲盒配置（settings 表，缺省用默认值）----
async function checkinConfig(db: D1Database) {
  const base = Number(await getSetting(db, 'checkin_base_points')) || 10;
  const bonus = Number(await getSetting(db, 'checkin_streak_bonus')) || 5;
  const max = Number(await getSetting(db, 'checkin_max_points')) || 40;
  const boxCost = Number(await getSetting(db, 'box_cost')) || 100;
  const drawMode = (await getSetting(db, 'draw_mode')) === 'wheel' ? 'wheel' : 'box';
  return { base, bonus, max, boxCost, drawMode };
}

// 以 UTC+8 的日历日为签到日
function dateStr(offsetDays = 0): string {
  return new Date(Date.now() + 8 * 3600 * 1000 + offsetDays * 86400000).toISOString().slice(0, 10);
}

function streakPoints(cfg: { base: number; bonus: number; max: number }, streakDay: number): number {
  return Math.min(cfg.base + (streakDay - 1) * cfg.bonus, cfg.max);
}

interface CheckinRow {
  checkin_date: string;
  streak_day: number;
}

async function lastCheckin(db: D1Database, userId: number): Promise<CheckinRow | null> {
  return db.prepare(
    'SELECT checkin_date, streak_day FROM checkins WHERE user_id = ? ORDER BY checkin_date DESC LIMIT 1'
  ).bind(userId).first<CheckinRow>();
}

async function balanceOf(db: D1Database, userId: number): Promise<number> {
  const row = await db.prepare('SELECT points FROM users WHERE id = ?').bind(userId).first<{ points: number }>();
  return row?.points ?? 0;
}

// ---- 路由鉴权挂载 ----
points.use('/checkin', userAuth);
points.use('/checkin/*', userAuth);
points.use('/box/*', userAuth);
points.use('/my/*', userAuth);
points.use('/prizes/:id/redeem', userAuth);
points.use('/prizes', contentGuard); // 奖品列表与站内内容同级：口令通过即可看

// ---- 签到 ----
points.post('/checkin', async (c) => {
  const me = c.get('user') as { id: number };
  const db = c.env.DB;
  const today = dateStr();
  if (await db.prepare('SELECT id FROM checkins WHERE user_id = ? AND checkin_date = ?').bind(me.id, today).first()) {
    return c.json({ detail: '今天已签到' }, 409);
  }
  const last = await lastCheckin(db, me.id);
  const streak = last && last.checkin_date === dateStr(-1) ? last.streak_day + 1 : 1;
  const cfg = await checkinConfig(db);
  const earned = streakPoints(cfg, streak);
  try {
    const [ins] = await db.batch([
      db.prepare('INSERT INTO checkins (user_id, checkin_date, streak_day, points_earned) VALUES (?, ?, ?, ?)')
        .bind(me.id, today, streak, earned),
      db.prepare('UPDATE users SET points = points + ? WHERE id = ?').bind(earned, me.id),
    ]);
    const balance = await balanceOf(db, me.id);
    await db.prepare(
      "INSERT INTO point_transactions (user_id, change, balance_after, type, ref_id) VALUES (?, ?, ?, 'checkin', ?)"
    ).bind(me.id, earned, balance, ins.meta.last_row_id).run();
    return c.json({ points_earned: earned, streak_day: streak, balance });
  } catch {
    // UNIQUE(user_id, checkin_date) 冲突 = 并发重复签到
    return c.json({ detail: '今天已签到' }, 409);
  }
});

points.get('/checkin/status', async (c) => {
  const me = c.get('user') as { id: number };
  const db = c.env.DB;
  const today = dateStr();
  const checkedIn = Boolean(
    await db.prepare('SELECT id FROM checkins WHERE user_id = ? AND checkin_date = ?').bind(me.id, today).first()
  );
  const last = await lastCheckin(db, me.id);
  const currentStreak =
    last && (last.checkin_date === today || last.checkin_date === dateStr(-1)) ? last.streak_day : 0;
  const cfg = await checkinConfig(db);
  return c.json({
    checked_in: checkedIn,
    streak_day: currentStreak,
    balance: await balanceOf(db, me.id),
    box_cost: cfg.boxCost,
    draw_mode: cfg.drawMode,
    next_points: streakPoints(cfg, currentStreak + 1),
  });
});

// ---- 奖品列表（商城 + 盲盒预览），双语惯例：英文为空回退中文 ----
interface PrizeRow {
  id: number;
  name: string;
  description: string;
  image: string;
  points_cost: number;
  box_weight: number;
  stock: number;
}

points.get('/prizes', async (c) => {
  const isEn = c.req.query('lang') === 'en';
  const sql = isEn
    ? `SELECT id, image, points_cost, box_weight, stock,
              COALESCE(NULLIF(name_en,''), name) AS name,
              COALESCE(NULLIF(description_en,''), description) AS description
       FROM prizes WHERE is_active = 1 ORDER BY sort_order, id`
    : `SELECT id, name, description, image, points_cost, box_weight, stock
       FROM prizes WHERE is_active = 1 ORDER BY sort_order, id`;
  const { results } = await c.env.DB.prepare(sql).all<PrizeRow>();
  return c.json(results.map((p) => ({
    ...p,
    in_box: p.box_weight > 0 && p.stock !== 0,
    in_stock: p.stock !== 0,
  })));
});

// ---- 盲盒 ----
points.post('/box/draw', async (c) => {
  const me = c.get('user') as { id: number };
  const db = c.env.DB;
  const { boxCost } = await checkinConfig(db);

  // 先条件扣积分，余额不足直接失败
  const deduct = await db.prepare('UPDATE users SET points = points - ? WHERE id = ? AND points >= ?')
    .bind(boxCost, me.id, boxCost).run();
  if (!deduct.meta.changes) return c.json({ detail: '积分不足' }, 400);
  const refund = () => db.prepare('UPDATE users SET points = points + ? WHERE id = ?').bind(boxCost, me.id).run();

  try {
    const { results: pool } = await db.prepare(
      'SELECT * FROM prizes WHERE is_active = 1 AND box_weight > 0 AND stock != 0'
    ).all<PrizeRow & { is_active: number; sort_order: number }>();
    if (!pool.length) {
      await refund();
      return c.json({ detail: '奖池为空' }, 409);
    }

    // 按权重加权随机
    const total = pool.reduce((s, p) => s + p.box_weight, 0);
    let r = Math.random() * total;
    let prize = pool[pool.length - 1];
    for (const p of pool) {
      r -= p.box_weight;
      if (r <= 0) { prize = p; break; }
    }

    // 减库存（有限库存时）+ 写中奖记录，一个批次
    const stmts = [];
    if (prize.stock > 0) {
      stmts.push(db.prepare('UPDATE prizes SET stock = stock - 1 WHERE id = ? AND stock > 0').bind(prize.id));
    }
    stmts.push(
      db.prepare("INSERT INTO prize_records (user_id, prize_id, source, points_spent) VALUES (?, ?, 'box', ?)")
        .bind(me.id, prize.id, boxCost)
    );
    const batchRes = await db.batch(stmts);
    if (prize.stock > 0 && !batchRes[0].meta.changes) {
      // 并发下刚好被抽空：删掉同批插入的孤儿记录并退积分
      const orphanId = batchRes[batchRes.length - 1].meta.last_row_id;
      await db.batch([
        db.prepare('DELETE FROM prize_records WHERE id = ?').bind(orphanId),
        db.prepare('UPDATE users SET points = points + ? WHERE id = ?').bind(boxCost, me.id),
      ]);
      return c.json({ detail: '奖品刚被抽完，请再试一次' }, 409);
    }
    const recordId = batchRes[batchRes.length - 1].meta.last_row_id;
    const balance = await balanceOf(db, me.id);
    await db.prepare(
      "INSERT INTO point_transactions (user_id, change, balance_after, type, ref_id) VALUES (?, ?, ?, 'box', ?)"
    ).bind(me.id, -boxCost, balance, recordId).run();

    return c.json({
      prize: { id: prize.id, name: prize.name, description: prize.description, image: prize.image },
      balance,
    });
  } catch (e) {
    // 兜底：任何意外错误都退积分，避免扣分无记录
    await refund().catch(() => {});
    throw e;
  }
});

// ---- 兑换 ----
points.post('/prizes/:id/redeem', async (c) => {
  const me = c.get('user') as { id: number };
  const db = c.env.DB;
  const prize = await db.prepare('SELECT * FROM prizes WHERE id = ? AND is_active = 1')
    .bind(c.req.param('id')).first<PrizeRow & { is_active: number }>();
  if (!prize) return c.json({ detail: '奖品不存在' }, 404);
  if (prize.points_cost <= 0) return c.json({ detail: '该奖品不可直接兑换' }, 409);
  if (prize.stock === 0) return c.json({ detail: '库存不足' }, 409);

  const deduct = await db.prepare('UPDATE users SET points = points - ? WHERE id = ? AND points >= ?')
    .bind(prize.points_cost, me.id, prize.points_cost).run();
  if (!deduct.meta.changes) return c.json({ detail: '积分不足' }, 400);
  const refund = () => db.prepare('UPDATE users SET points = points + ? WHERE id = ?').bind(prize.points_cost, me.id).run();

  try {
    const stmts = [];
    if (prize.stock > 0) {
      stmts.push(db.prepare('UPDATE prizes SET stock = stock - 1 WHERE id = ? AND stock > 0').bind(prize.id));
    }
    stmts.push(
      db.prepare("INSERT INTO prize_records (user_id, prize_id, source, points_spent) VALUES (?, ?, 'redeem', ?)")
        .bind(me.id, prize.id, prize.points_cost)
    );
    const batchRes = await db.batch(stmts);
    if (prize.stock > 0 && !batchRes[0].meta.changes) {
      // 并发下刚好被抽空：删掉同批插入的孤儿记录并退积分
      const orphanId = batchRes[batchRes.length - 1].meta.last_row_id;
      await db.batch([
        db.prepare('DELETE FROM prize_records WHERE id = ?').bind(orphanId),
        db.prepare('UPDATE users SET points = points + ? WHERE id = ?').bind(prize.points_cost, me.id),
      ]);
      return c.json({ detail: '库存不足' }, 409);
    }
    const recordId = batchRes[batchRes.length - 1].meta.last_row_id;
    const balance = await balanceOf(db, me.id);
    await db.prepare(
      "INSERT INTO point_transactions (user_id, change, balance_after, type, ref_id) VALUES (?, ?, ?, 'redeem', ?)"
    ).bind(me.id, -prize.points_cost, balance, recordId).run();

    return c.json({ record_id: recordId, balance });
  } catch (e) {
    // 兜底：任何意外错误都退积分，避免扣分无记录
    await refund().catch(() => {});
    throw e;
  }
});

// ---- 我的奖品 ----
points.get('/my/prizes', async (c) => {
  const me = c.get('user') as { id: number };
  const isEn = c.req.query('lang') === 'en';
  const nameCol = isEn ? "COALESCE(NULLIF(p.name_en,''), p.name)" : 'p.name';
  const descCol = isEn ? "COALESCE(NULLIF(p.description_en,''), p.description)" : 'p.description';
  const { results } = await c.env.DB.prepare(
    `SELECT r.id, r.prize_id, r.source, r.points_spent, r.status, r.created_at, r.used_at,
            ${nameCol} AS name, ${descCol} AS description, p.image
     FROM prize_records r JOIN prizes p ON p.id = r.prize_id
     WHERE r.user_id = ? ORDER BY r.id DESC LIMIT 200`
  ).bind(me.id).all();
  return c.json(results);
});

points.post('/my/prizes/:id/use', async (c) => {
  const me = c.get('user') as { id: number };
  const r = await c.env.DB.prepare(
    "UPDATE prize_records SET status = 'used', used_at = datetime('now') WHERE id = ? AND user_id = ? AND status = 'pending'"
  ).bind(c.req.param('id'), me.id).run();
  if (!r.meta.changes) return c.json({ detail: '记录不存在或已处理' }, 409);
  return c.json({ ok: true });
});

export default points;
