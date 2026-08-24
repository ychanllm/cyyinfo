import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../types';
import { userAuth, adminAuth, verifyJwt } from '../auth';
import { contentGuard } from '../guard';
import { saveUpload } from '../upload';
import { logAudit } from '../audit';

const MAX_NAME = 50;       // 菜名长度上限
const MAX_DESC = 200;      // 描述长度上限

interface DishRow {
  id: number;
  name: string;
  description: string;
  image: string | null;
  created_by_user_id: number | null;
  is_active: number;
  created_at: string;
}

// 投稿/新建共用：解析 JSON 或 multipart（可带 image 文件），返回校验后的字段
async function parseDishPayload(c: Context<{ Bindings: Env }>) {
  const isMultipart = (c.req.header('Content-Type') ?? '').startsWith('multipart/form-data');
  let name = '';
  let description = '';
  let file: File | null = null;
  if (isMultipart) {
    const body = await c.req.parseBody();
    name = String(body.name ?? '').trim();
    description = String(body.description ?? '').trim();
    if (body.image instanceof File && body.image.size > 0) file = body.image;
  } else {
    const body = await c.req.json<{ name?: string; description?: string }>().catch(() => ({}));
    name = String(body.name ?? '').trim();
    description = String(body.description ?? '').trim();
  }
  return { name, description, file };
}

function validateDish(name: string, description: string): string | null {
  if (!name) return '菜名必填';
  if (name.length > MAX_NAME) return `菜名最多 ${MAX_NAME} 字`;
  if (description.length > MAX_DESC) return `描述最多 ${MAX_DESC} 字`;
  return null;
}

async function wantCount(db: D1Database, dishId: number): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM dish_wants WHERE dish_id = ?')
    .bind(dishId).first<{ n: number }>();
  return row?.n ?? 0;
}

// ---- 公开 / 用户端 ----
const dishes = new Hono<{ Bindings: Env }>();

// 菜品榜：仅在架菜品，按想吃人数排序；带合法用户 JWT 时附 wanted_by_me
dishes.get('/', contentGuard, async (c) => {
  const db = c.env.DB;
  const { results } = await db.prepare(
    `SELECT d.id, d.name, d.description, d.image, d.created_at,
            (SELECT COUNT(*) FROM dish_wants w WHERE w.dish_id = d.id) AS want_count
     FROM dishes d WHERE d.is_active = 1
     ORDER BY want_count DESC, d.created_at DESC, d.id DESC`
  ).all<DishRow & { want_count: number }>();

  // 可选鉴权：仅用户角色有 wanted_by_me（dish_wants 只记注册用户）
  const token = (c.req.header('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const payload = token ? await verifyJwt(c.env, token) : null;
  const myWants = new Set<number>();
  if (payload?.role === 'user') {
    const { results: mine } = await db.prepare('SELECT dish_id FROM dish_wants WHERE user_id = ?')
      .bind(payload.sub as number).all<{ dish_id: number }>();
    mine.forEach((r) => myWants.add(r.dish_id));
  }
  return c.json(results.map((d) => ({ ...d, wanted_by_me: myWants.has(d.id) })));
});

// 用户投稿菜品：直接进库，无需审核
dishes.post('/', userAuth, async (c) => {
  const me = c.get('user') as { id: number; username: string };
  const { name, description, file } = await parseDishPayload(c);
  const err = validateDish(name, description);
  if (err) return c.json({ detail: err }, 400);

  let image: string | null = null;
  if (file) {
    const { key, error } = await saveUpload(c.env, file, 'image', 'dishes');
    if (error) return c.json({ detail: error }, 400);
    image = key!;
  }
  const r = await c.env.DB.prepare(
    'INSERT INTO dishes (name, description, image, created_by_user_id) VALUES (?, ?, ?, ?)'
  ).bind(name, description, image, me.id).run();
  await logAudit(c.env.DB, 'dish_create', me.username, `投稿菜品「${name}」`);
  return c.json({ id: r.meta.last_row_id, name, description, image });
});

// 想吃 toggle：已想吃则取消，否则记录（一人一菜一条）
dishes.post('/:id/want', userAuth, async (c) => {
  const me = c.get('user') as { id: number; username: string };
  const dishId = Number(c.req.param('id'));
  const dish = await c.env.DB.prepare('SELECT id, name FROM dishes WHERE id = ? AND is_active = 1')
    .bind(dishId).first<{ id: number; name: string }>();
  if (!dish) return c.json({ detail: '菜品不存在或已下架' }, 404);

  const db = c.env.DB;
  const del = await db.prepare('DELETE FROM dish_wants WHERE user_id = ? AND dish_id = ?')
    .bind(me.id, dishId).run();
  let wanted: boolean;
  if (del.meta.changes) {
    wanted = false; // 已想吃 → 取消
  } else {
    // UNIQUE(user_id, dish_id) 兜底并发重复
    await db.prepare('INSERT INTO dish_wants (user_id, dish_id) VALUES (?, ?)').bind(me.id, dishId).run();
    wanted = true;
  }
  await logAudit(db, wanted ? 'dish_want' : 'dish_unwant', me.username, `${wanted ? '想吃' : '取消想吃'}「${dish.name}」`);
  return c.json({ wanted, want_count: await wantCount(db, dishId) });
});

// ---- 管理端 ----
export const adminDishes = new Hono<{ Bindings: Env }>();

adminDishes.use('*', adminAuth);

// 全部菜品（含下架）：want_count + 想吃用户名明细 + 投稿人
adminDishes.get('/', async (c) => {
  const db = c.env.DB;
  const { results } = await db.prepare(
    `SELECT d.*, u.username AS created_by_username,
            (SELECT COUNT(*) FROM dish_wants w WHERE w.dish_id = d.id) AS want_count
     FROM dishes d LEFT JOIN users u ON u.id = d.created_by_user_id
     ORDER BY d.id DESC`
  ).all<DishRow & { created_by_username: string | null; want_count: number }>();
  const { results: wants } = await db.prepare(
    'SELECT w.dish_id, u.username FROM dish_wants w JOIN users u ON u.id = w.user_id ORDER BY w.id'
  ).all<{ dish_id: number; username: string }>();
  const wantMap = new Map<number, string[]>();
  for (const w of wants) {
    const list = wantMap.get(w.dish_id) ?? [];
    list.push(w.username);
    wantMap.set(w.dish_id, list);
  }
  return c.json(results.map((d) => ({ ...d, want_usernames: wantMap.get(d.id) ?? [] })));
});

// 管理员新建菜品（created_by_user_id 为 NULL）
adminDishes.post('/', async (c) => {
  const me = c.get('admin') as { username: string };
  const { name, description, file } = await parseDishPayload(c);
  const err = validateDish(name, description);
  if (err) return c.json({ detail: err }, 400);

  let image: string | null = null;
  if (file) {
    const { key, error } = await saveUpload(c.env, file, 'image', 'dishes');
    if (error) return c.json({ detail: error }, 400);
    image = key!;
  }
  const r = await c.env.DB.prepare('INSERT INTO dishes (name, description, image) VALUES (?, ?, ?)')
    .bind(name, description, image).run();
  await logAudit(c.env.DB, 'dish_create', me.username, `新建菜品「${name}」`);
  return c.json({ id: r.meta.last_row_id, name, description, image });
});

// 编辑名称/描述/图片，或下架/恢复（JSON 或 multipart；multipart 可带新 image 文件）
adminDishes.put('/:id', async (c) => {
  const me = c.get('admin') as { username: string };
  const dishId = Number(c.req.param('id'));
  const old = await c.env.DB.prepare('SELECT * FROM dishes WHERE id = ?').bind(dishId).first<DishRow>();
  if (!old) return c.json({ detail: '菜品不存在' }, 404);

  const isMultipart = (c.req.header('Content-Type') ?? '').startsWith('multipart/form-data');
  let fields: Record<string, unknown>;
  let file: File | null = null;
  if (isMultipart) {
    fields = await c.req.parseBody();
    if (fields.image instanceof File && (fields.image as File).size > 0) file = fields.image as File;
  } else {
    fields = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  }

  const setParts: string[] = [];
  const params: unknown[] = [];
  if (fields.name !== undefined) {
    const name = String(fields.name).trim();
    if (!name) return c.json({ detail: '菜名必填' }, 400);
    if (name.length > MAX_NAME) return c.json({ detail: `菜名最多 ${MAX_NAME} 字` }, 400);
    setParts.push('name = ?');
    params.push(name);
  }
  if (fields.description !== undefined) {
    const description = String(fields.description).trim();
    if (description.length > MAX_DESC) return c.json({ detail: `描述最多 ${MAX_DESC} 字` }, 400);
    setParts.push('description = ?');
    params.push(description);
  }
  if (fields.is_active !== undefined) {
    setParts.push('is_active = ?');
    params.push(fields.is_active ? 1 : 0);
  }
  if (file) {
    const { key, error } = await saveUpload(c.env, file, 'image', 'dishes');
    if (error) return c.json({ detail: error }, 400);
    if (old.image) await c.env.UPLOADS.delete(old.image).catch(() => {});
    setParts.push('image = ?');
    params.push(key!);
  }
  if (setParts.length) {
    params.push(dishId);
    await c.env.DB.prepare(`UPDATE dishes SET ${setParts.join(', ')} WHERE id = ?`).bind(...params).run();
  }
  if (fields.is_active !== undefined && Boolean(fields.is_active) !== Boolean(old.is_active)) {
    await logAudit(c.env.DB, fields.is_active ? 'dish_restore' : 'dish_off', me.username,
      `${fields.is_active ? '恢复' : '下架'}菜品「${old.name}」`);
  } else if (fields.name !== undefined || fields.description !== undefined || file) {
    await logAudit(c.env.DB, 'dish_update', me.username, `编辑菜品#${dishId}`);
  }
  return c.json({ ok: true });
});

// 删除菜品：连带 dish_wants（CASCADE），R2 图片一并删除
adminDishes.delete('/:id', async (c) => {
  const me = c.get('admin') as { username: string };
  const dishId = Number(c.req.param('id'));
  const dish = await c.env.DB.prepare('SELECT name, image FROM dishes WHERE id = ?')
    .bind(dishId).first<{ name: string; image: string | null }>();
  if (!dish) return c.json({ detail: '菜品不存在' }, 404);
  if (dish.image) await c.env.UPLOADS.delete(dish.image).catch(() => {});
  await c.env.DB.prepare('DELETE FROM dishes WHERE id = ?').bind(dishId).run();
  await logAudit(c.env.DB, 'dish_delete', me.username, `删除菜品「${dish.name}」`);
  return c.json({ ok: true });
});

export default dishes;
