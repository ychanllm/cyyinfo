import { Hono } from 'hono';
import type { Env } from '../types';
import { adminAuth } from '../auth';
import { getSetting, setSetting } from '../guard';
import { saveUpload } from '../upload';

const ap = new Hono<{ Bindings: Env }>();

ap.use('/prizes', adminAuth);
ap.use('/prizes/*', adminAuth);
ap.use('/prize-records', adminAuth);
ap.use('/prize-records/*', adminAuth);
ap.use('/checkin-settings', adminAuth);

// ---- 奖品 CRUD ----
ap.get('/prizes', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM prizes ORDER BY sort_order, id').all();
  return c.json(results);
});

ap.post('/prizes', async (c) => {
  const {
    name, name_en = '', description = '', description_en = '',
    points_cost = 0, box_weight = 0, stock = -1, sort_order = 0,
  } = await c.req.json();
  if (!name?.trim()) return c.json({ detail: '奖品名必填' }, 400);
  for (const [k, v] of Object.entries({ points_cost, box_weight, sort_order })) {
    if (!Number.isInteger(v) || (v as number) < 0) return c.json({ detail: `${k} 必须是非负整数` }, 400);
  }
  if (!Number.isInteger(stock) || stock < -1) return c.json({ detail: '库存必须是 ≥ -1 的整数（-1 为无限）' }, 400);
  const r = await c.env.DB.prepare(
    `INSERT INTO prizes (name, name_en, description, description_en, points_cost, box_weight, stock, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(name.trim(), name_en.trim(), description.trim(), description_en.trim(),
    points_cost, box_weight, stock, sort_order).run();
  return c.json({ id: r.meta.last_row_id });
});

ap.put('/prizes/:id', async (c) => {
  const body = await c.req.json();
  if (body.name !== undefined && !String(body.name).trim()) return c.json({ detail: '奖品名不能为空' }, 400);
  const fields = ['name', 'name_en', 'description', 'description_en', 'points_cost', 'box_weight', 'stock', 'is_active', 'sort_order'];
  const setParts: string[] = [];
  const params: unknown[] = [];
  for (const f of fields) {
    if (body[f] === undefined) continue;
    if (['points_cost', 'box_weight', 'is_active', 'sort_order'].includes(f)) {
      if (!Number.isInteger(body[f]) || body[f] < 0) return c.json({ detail: `${f} 必须是非负整数` }, 400);
    }
    if (f === 'stock' && (!Number.isInteger(body[f]) || body[f] < -1)) {
      return c.json({ detail: '库存必须是 ≥ -1 的整数（-1 为无限）' }, 400);
    }
    setParts.push(`${f} = ?`);
    params.push(typeof body[f] === 'string' ? body[f].trim() : body[f]);
  }
  if (setParts.length) {
    params.push(Number(c.req.param('id')));
    await c.env.DB.prepare(`UPDATE prizes SET ${setParts.join(', ')} WHERE id = ?`).bind(...params).run();
  }
  return c.json({ ok: true });
});

ap.delete('/prizes/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const used = await c.env.DB.prepare('SELECT id FROM prize_records WHERE prize_id = ? LIMIT 1').bind(id).first();
  if (used) {
    // 有中奖/兑换记录引用，软删保留数据
    await c.env.DB.prepare('UPDATE prizes SET is_active = 0 WHERE id = ?').bind(id).run();
  } else {
    await c.env.DB.prepare('DELETE FROM prizes WHERE id = ?').bind(id).run();
  }
  return c.json({ ok: true });
});

ap.post('/prizes/:id/image', async (c) => {
  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) return c.json({ detail: '缺少文件' }, 400);
  const { key, error } = await saveUpload(c.env, file, 'image', 'prizes');
  if (error) return c.json({ detail: error }, 400);
  await c.env.DB.prepare('UPDATE prizes SET image = ? WHERE id = ?').bind(key!, c.req.param('id')).run();
  return c.json({ image: key });
});

// ---- 中奖/兑换记录 ----
ap.get('/prize-records', async (c) => {
  const status = c.req.query('status');
  const userId = Number(c.req.query('user_id')) || 0;
  const conds: string[] = [];
  const args: unknown[] = [];
  if (status && ['pending', 'used', 'cancelled'].includes(status)) {
    conds.push('r.status = ?');
    args.push(status);
  }
  if (userId > 0) {
    conds.push('r.user_id = ?');
    args.push(userId);
  }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const { results } = await c.env.DB.prepare(
    `SELECT r.*, u.username, p.name AS prize_name, p.name_en AS prize_name_en, p.image AS prize_image
     FROM prize_records r
     JOIN users u ON u.id = r.user_id
     JOIN prizes p ON p.id = r.prize_id
     ${where} ORDER BY r.id DESC LIMIT 200`
  ).bind(...args).all();
  return c.json(results);
});

ap.post('/prize-records/:id/use', async (c) => {
  const r = await c.env.DB.prepare(
    "UPDATE prize_records SET status = 'used', used_at = datetime('now') WHERE id = ? AND status = 'pending'"
  ).bind(c.req.param('id')).run();
  if (!r.meta.changes) return c.json({ detail: '记录不存在或已处理' }, 409);
  return c.json({ ok: true });
});

ap.post('/prize-records/:id/cancel', async (c) => {
  const rec = await c.env.DB.prepare(
    "SELECT id, user_id, points_spent FROM prize_records WHERE id = ? AND status = 'pending'"
  ).bind(c.req.param('id')).first<{ id: number; user_id: number; points_spent: number }>();
  if (!rec) return c.json({ detail: '记录不存在或已处理' }, 409);
  const [upd] = await c.env.DB.batch([
    c.env.DB.prepare("UPDATE prize_records SET status = 'cancelled' WHERE id = ? AND status = 'pending'").bind(rec.id),
    c.env.DB.prepare('UPDATE users SET points = points + ? WHERE id = ?').bind(rec.points_spent, rec.user_id),
  ]);
  if (!upd.meta.changes) return c.json({ detail: '记录不存在或已处理' }, 409);
  const balance = (await c.env.DB.prepare('SELECT points FROM users WHERE id = ?')
    .bind(rec.user_id).first<{ points: number }>())!.points;
  await c.env.DB.prepare(
    "INSERT INTO point_transactions (user_id, change, balance_after, type, ref_id) VALUES (?, ?, ?, 'cancel_refund', ?)"
  ).bind(rec.user_id, rec.points_spent, balance, rec.id).run();
  return c.json({ ok: true });
});

// ---- 签到设置 ----
const CHECKIN_DEFAULTS: Record<string, string> = {
  checkin_base_points: '10',
  checkin_streak_bonus: '5',
  checkin_max_points: '40',
  box_cost: '100',
};

ap.get('/checkin-settings', async (c) => {
  const out: Record<string, string> = {};
  for (const [k, def] of Object.entries(CHECKIN_DEFAULTS)) {
    out[k] = (await getSetting(c.env.DB, k)) || def;
  }
  return c.json(out);
});

ap.put('/checkin-settings', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const writes: [string, string][] = [];
  for (const k of Object.keys(CHECKIN_DEFAULTS)) {
    const v = body[k];
    if (v === undefined) continue;
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) return c.json({ detail: `${k} 必须是正整数` }, 400);
    writes.push([k, String(n)]);
  }
  for (const [k, v] of writes) await setSetting(c.env.DB, k, v);
  return c.json({ ok: true });
});

export default ap;
