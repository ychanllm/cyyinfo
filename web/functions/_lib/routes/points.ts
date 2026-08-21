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
  return { base, bonus, max, boxCost };
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
    next_points: streakPoints(cfg, currentStreak + 1),
  });
});

export default points;
