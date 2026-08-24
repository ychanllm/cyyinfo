import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppEnv } from '../types';
import { userAuth, adminAuth } from '../auth';
import { contentGuard } from '../guard';
import { saveUpload } from '../upload';
import { logAudit } from '../audit';

const MAX_NAME = 50;       // 店名长度上限
const MAX_ADDR = 100;      // 地址长度上限
const MAX_NOTE = 300;      // 备注长度上限
const MAX_DISHES = 30;     // 每家店最多想吃的菜品数
const MAX_DISH_NAME = 50;  // 菜品名长度上限
const MAX_DISH_NOTE = 100; // 菜品备注长度上限

interface StoreRow {
  id: number;
  name: string;
  address: string;
  note: string;
  image: string | null;
  created_by_user_id: number | null;
  is_active: number;
  created_at: string;
}

interface StoreDishRow {
  id: number;
  store_id: number;
  name: string;
  note: string;
  created_at: string;
}

interface DishInput { name: string; note: string }

// 投稿/新建共用：解析 JSON 或 multipart（可带 image 文件），返回校验后的字段。
// 菜品列表统一用 JSON 字符串字段 dishes（multipart 和 JSON 两种形态都好传输）。
async function parseStorePayload(c: Context<AppEnv>) {
  const isMultipart = (c.req.header('Content-Type') ?? '').startsWith('multipart/form-data');
  let name = '';
  let address = '';
  let note = '';
  let file: File | null = null;
  let dishes: DishInput[] = [];
  if (isMultipart) {
    const body = await c.req.parseBody();
    name = String(body.name ?? '').trim();
    address = String(body.address ?? '').trim();
    note = String(body.note ?? '').trim();
    if (body.image instanceof File && body.image.size > 0) file = body.image;
    dishes = parseDishList(String(body.dishes ?? ''));
  } else {
    const body = await c.req.json<{ name?: string; address?: string; note?: string; dishes?: unknown }>()
      .catch((): { name?: string; address?: string; note?: string; dishes?: unknown } => ({}));
    name = String(body.name ?? '').trim();
    address = String(body.address ?? '').trim();
    note = String(body.note ?? '').trim();
    dishes = parseDishList(JSON.stringify(body.dishes ?? []));
  }
  return { name, address, note, dishes, file };
}

function parseDishList(raw: string): DishInput[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((d) => {
      const o = (d ?? {}) as Record<string, unknown>;
      return { name: String(o.name ?? '').trim(), note: String(o.note ?? '').trim() };
    });
  } catch {
    return [];
  }
}

function validateStore(name: string, address: string, note: string, dishes: DishInput[]): string | null {
  if (!name) return '店名必填';
  if (name.length > MAX_NAME) return `店名最多 ${MAX_NAME} 字`;
  if (address.length > MAX_ADDR) return `地址最多 ${MAX_ADDR} 字`;
  if (note.length > MAX_NOTE) return `备注最多 ${MAX_NOTE} 字`;
  if (dishes.length > MAX_DISHES) return `想吃的菜品最多 ${MAX_DISHES} 道`;
  for (const d of dishes) {
    if (!d.name) return '菜品名必填';
    if (d.name.length > MAX_DISH_NAME) return `菜名最多 ${MAX_DISH_NAME} 字`;
    if (d.note.length > MAX_DISH_NOTE) return `菜品备注最多 ${MAX_DISH_NOTE} 字`;
  }
  return null;
}

async function insertDishes(db: D1Database, storeId: number, dishes: DishInput[]): Promise<void> {
  for (const d of dishes) {
    await db.prepare('INSERT INTO store_dishes (store_id, name, note) VALUES (?, ?, ?)')
      .bind(storeId, d.name, d.note).run();
  }
}

// 批量取多家店的菜品，避免 N+1
async function loadStoresWithDishes(db: D1Database, where: string, params: unknown[]) {
  const { results: storeRows } = await db.prepare(
    `SELECT s.*, u.username AS created_by_username
     FROM stores s LEFT JOIN users u ON u.id = s.created_by_user_id ${where} ORDER BY s.id DESC`
  ).bind(...params).all<StoreRow & { created_by_username: string | null }>();
  const ids = storeRows.map((s) => s.id);
  let dishRows: StoreDishRow[] = [];
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    const { results } = await db.prepare(
      `SELECT * FROM store_dishes WHERE store_id IN (${placeholders}) ORDER BY id`
    ).bind(...ids).all<StoreDishRow>();
    dishRows = results;
  }
  const byStore = new Map<number, StoreDishRow[]>();
  for (const d of dishRows) {
    const list = byStore.get(d.store_id) ?? [];
    list.push(d);
    byStore.set(d.store_id, list);
  }
  return storeRows.map((s) => ({ ...s, dishes: byStore.get(s.id) ?? [] }));
}

// ---- 公开 / 用户端 ----
const stores = new Hono<AppEnv>();

// 探店店榜：仅在架门店 + 该店想吃的菜品（投稿人姓名不对公开端暴露）
stores.get('/', contentGuard, async (c) => {
  const rows = await loadStoresWithDishes(c.env.DB, 'WHERE s.is_active = 1', []);
  return c.json(rows.map(({ created_by_username, ...s }) => s));
});

// 用户投稿门店：直接进库，无需审核；菜品列表随门店一起创建
stores.post('/', userAuth, async (c) => {
  const me = c.get('user') as { id: number; username: string };
  const { name, address, note, dishes, file } = await parseStorePayload(c);
  const err = validateStore(name, address, note, dishes);
  if (err) return c.json({ detail: err }, 400);

  let image: string | null = null;
  if (file) {
    const { key, error } = await saveUpload(c.env, file, 'image', 'stores');
    if (error) return c.json({ detail: error }, 400);
    image = key!;
  }
  const r = await c.env.DB.prepare(
    'INSERT INTO stores (name, address, note, image, created_by_user_id) VALUES (?, ?, ?, ?, ?)'
  ).bind(name, address, note, image, me.id).run();
  const storeId = Number(r.meta.last_row_id);
  await insertDishes(c.env.DB, storeId, dishes);
  await logAudit(c.env.DB, 'store_create', me.username,
    `投稿门店「${name}」${dishes.length ? `（${dishes.length} 道想吃的菜）` : ''}`);
  return c.json({ id: storeId, name, address, note, image });
});

// ---- 管理端 ----
export const adminStores = new Hono<AppEnv>();

adminStores.use('*', adminAuth);

// 全部门店（含下架）+ 投稿人 + 店内菜品
adminStores.get('/', async (c) => {
  return c.json(await loadStoresWithDishes(c.env.DB, '', []));
});

// 管理员新建门店（created_by_user_id 为 NULL）
adminStores.post('/', async (c) => {
  const me = c.get('admin') as { username: string };
  const { name, address, note, dishes, file } = await parseStorePayload(c);
  const err = validateStore(name, address, note, dishes);
  if (err) return c.json({ detail: err }, 400);

  let image: string | null = null;
  if (file) {
    const { key, error } = await saveUpload(c.env, file, 'image', 'stores');
    if (error) return c.json({ detail: error }, 400);
    image = key!;
  }
  const r = await c.env.DB.prepare(
    'INSERT INTO stores (name, address, note, image) VALUES (?, ?, ?, ?)'
  ).bind(name, address, note, image).run();
  const storeId = Number(r.meta.last_row_id);
  await insertDishes(c.env.DB, storeId, dishes);
  await logAudit(c.env.DB, 'store_create', me.username, `新建门店「${name}」`);
  return c.json({ id: storeId, name, address, note, image });
});

// 编辑店名/地址/备注/封面，或下架/恢复（JSON 或 multipart；multipart 可带新 image 文件）
adminStores.put('/:id', async (c) => {
  const me = c.get('admin') as { username: string };
  const storeId = Number(c.req.param('id'));
  const old = await c.env.DB.prepare('SELECT * FROM stores WHERE id = ?').bind(storeId).first<StoreRow>();
  if (!old) return c.json({ detail: '门店不存在' }, 404);

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
  const check = (key: string, max: number, label: string): string | undefined => {
    if (fields[key] === undefined) return undefined;
    const v = String(fields[key]).trim();
    if (key === 'name' && !v) return `${label}必填`;
    if (v.length > max) return `${label}最多 ${max} 字`;
    setParts.push(`${key} = ?`);
    params.push(v);
    return undefined;
  };
  const e1 = check('name', MAX_NAME, '店名');
  if (e1) return c.json({ detail: e1 }, 400);
  const e2 = check('address', MAX_ADDR, '地址');
  if (e2) return c.json({ detail: e2 }, 400);
  const e3 = check('note', MAX_NOTE, '备注');
  if (e3) return c.json({ detail: e3 }, 400);
  if (fields.is_active !== undefined) {
    setParts.push('is_active = ?');
    params.push(fields.is_active ? 1 : 0);
  }
  if (file) {
    const { key, error } = await saveUpload(c.env, file, 'image', 'stores');
    if (error) return c.json({ detail: error }, 400);
    if (old.image) await c.env.UPLOADS.delete(old.image).catch(() => {});
    setParts.push('image = ?');
    params.push(key!);
  }
  if (setParts.length) {
    params.push(storeId);
    await c.env.DB.prepare(`UPDATE stores SET ${setParts.join(', ')} WHERE id = ?`).bind(...params).run();
  }
  if (fields.is_active !== undefined && Boolean(fields.is_active) !== Boolean(old.is_active)) {
    await logAudit(c.env.DB, fields.is_active ? 'store_restore' : 'store_off', me.username,
      `${fields.is_active ? '恢复' : '下架'}门店「${old.name}」`);
  } else if (fields.name !== undefined || fields.address !== undefined || fields.note !== undefined || file) {
    await logAudit(c.env.DB, 'store_update', me.username, `编辑门店#${storeId}`);
  }
  return c.json({ ok: true });
});

// 删除门店：店内菜品 CASCADE，R2 封面一并删除
adminStores.delete('/:id', async (c) => {
  const me = c.get('admin') as { username: string };
  const storeId = Number(c.req.param('id'));
  const store = await c.env.DB.prepare('SELECT name, image FROM stores WHERE id = ?')
    .bind(storeId).first<{ name: string; image: string | null }>();
  if (!store) return c.json({ detail: '门店不存在' }, 404);
  if (store.image) await c.env.UPLOADS.delete(store.image).catch(() => {});
  await c.env.DB.prepare('DELETE FROM stores WHERE id = ?').bind(storeId).run();
  await logAudit(c.env.DB, 'store_delete', me.username, `删除门店「${store.name}」`);
  return c.json({ ok: true });
});

// ---- 店内菜品 CRUD ----
adminStores.post('/:id/dishes', async (c) => {
  const me = c.get('admin') as { username: string };
  const storeId = Number(c.req.param('id'));
  const store = await c.env.DB.prepare('SELECT name FROM stores WHERE id = ?')
    .bind(storeId).first<{ name: string }>();
  if (!store) return c.json({ detail: '门店不存在' }, 404);
  const { name, note = '' } = await c.req.json<{ name?: string; note?: string }>();
  const dishName = String(name ?? '').trim();
  if (!dishName) return c.json({ detail: '菜品名必填' }, 400);
  if (dishName.length > MAX_DISH_NAME) return c.json({ detail: `菜名最多 ${MAX_DISH_NAME} 字` }, 400);
  const dishNote = String(note).trim();
  if (dishNote.length > MAX_DISH_NOTE) return c.json({ detail: `备注最多 ${MAX_DISH_NOTE} 字` }, 400);
  const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM store_dishes WHERE store_id = ?')
    .bind(storeId).first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_DISHES) return c.json({ detail: `想吃的菜品最多 ${MAX_DISHES} 道` }, 400);
  const r = await c.env.DB.prepare('INSERT INTO store_dishes (store_id, name, note) VALUES (?, ?, ?)')
    .bind(storeId, dishName, dishNote).run();
  await logAudit(c.env.DB, 'store_dish_create', me.username, `给「${store.name}」添加菜品「${dishName}」`);
  return c.json({ id: r.meta.last_row_id, store_id: storeId, name: dishName, note: dishNote });
});

adminStores.put('/:id/dishes/:dishId', async (c) => {
  const me = c.get('admin') as { username: string };
  const dishId = Number(c.req.param('dishId'));
  const old = await c.env.DB.prepare(
    'SELECT d.*, s.name AS store_name FROM store_dishes d JOIN stores s ON s.id = d.store_id WHERE d.id = ?'
  ).bind(dishId).first<StoreDishRow & { store_name: string }>();
  if (!old) return c.json({ detail: '菜品不存在' }, 404);
  const { name, note } = await c.req.json<{ name?: string; note?: string }>();
  const setParts: string[] = [];
  const params: unknown[] = [];
  if (name !== undefined) {
    const v = String(name).trim();
    if (!v) return c.json({ detail: '菜品名必填' }, 400);
    if (v.length > MAX_DISH_NAME) return c.json({ detail: `菜名最多 ${MAX_DISH_NAME} 字` }, 400);
    setParts.push('name = ?');
    params.push(v);
  }
  if (note !== undefined) {
    const v = String(note).trim();
    if (v.length > MAX_DISH_NOTE) return c.json({ detail: `备注最多 ${MAX_DISH_NOTE} 字` }, 400);
    setParts.push('note = ?');
    params.push(v);
  }
  if (setParts.length) {
    params.push(dishId);
    await c.env.DB.prepare(`UPDATE store_dishes SET ${setParts.join(', ')} WHERE id = ?`).bind(...params).run();
  }
  await logAudit(c.env.DB, 'store_dish_update', me.username, `编辑「${old.store_name}」的菜品#${dishId}`);
  return c.json({ ok: true });
});

adminStores.delete('/:id/dishes/:dishId', async (c) => {
  const me = c.get('admin') as { username: string };
  const dishId = Number(c.req.param('dishId'));
  const dish = await c.env.DB.prepare(
    'SELECT d.name, s.name AS store_name FROM store_dishes d JOIN stores s ON s.id = d.store_id WHERE d.id = ?'
  ).bind(dishId).first<{ name: string; store_name: string }>();
  if (!dish) return c.json({ detail: '菜品不存在' }, 404);
  await c.env.DB.prepare('DELETE FROM store_dishes WHERE id = ?').bind(dishId).run();
  await logAudit(c.env.DB, 'store_dish_delete', me.username, `删除「${dish.store_name}」的菜品「${dish.name}」`);
  return c.json({ ok: true });
});

export default stores;
