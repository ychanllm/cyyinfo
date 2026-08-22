import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import type { Env } from '../types';
import { signJwt, adminAuth } from '../auth';
import { getSetting, setSetting } from '../guard';
import { rateLimit, clientIp } from '../security';
import { saveUpload } from '../upload';
import { logAudit } from '../audit';

interface AdminUserRow {
  id: number;
  username: string;
  password_hash: string;
  display_name: string;
}

const admin = new Hono<{ Bindings: Env }>();

admin.post('/login', async (c) => {
  if (!rateLimit({ limit: 5, windowSec: 900, key: `login:${clientIp(c.req.raw)}` })) {
    return c.json({ detail: '尝试过于频繁，请稍后再试' }, 429);
  }
  const { username, password } = await c.req.json<{ username?: string; password?: string }>();
  if (!username || !password) return c.json({ detail: '请输入账号和密码' }, 400);

  let user = await c.env.DB.prepare('SELECT * FROM admin_users WHERE username = ?')
    .bind(username).first<AdminUserRow>();

  // 表为空时用 secret 初始化首个管理员
  if (!user) {
    const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM admin_users').first<{ n: number }>();
    if (count?.n === 0 && username === c.env.ADMIN_USERNAME) {
      const hash = bcrypt.hashSync(c.env.ADMIN_PASSWORD, 10);
      await c.env.DB.prepare('INSERT INTO admin_users (username, password_hash, display_name) VALUES (?, ?, ?)')
        .bind(username, hash, username).run();
      user = await c.env.DB.prepare('SELECT * FROM admin_users WHERE username = ?')
        .bind(username).first<AdminUserRow>();
    }
  }
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return c.json({ detail: '账号或密码错误' }, 401);
  }
  const token = await signJwt(c.env, { sub: user.id, username: user.username, role: 'admin' });
  return c.json({ token, display_name: user.display_name });
});

// 受保护子路由在此挂载（后续任务）：admin.use('/users/*', adminAuth) 等
admin.use('/albums', adminAuth);
admin.use('/albums/*', adminAuth);
admin.use('/photos', adminAuth);
admin.use('/photos/*', adminAuth);
admin.use('/users', adminAuth);
admin.use('/users/*', adminAuth);
admin.use('/diaries', adminAuth);
admin.use('/diaries/*', adminAuth);
admin.use('/diary-categories', adminAuth);
admin.use('/diary-categories/*', adminAuth);
admin.use('/music', adminAuth);
admin.use('/music/*', adminAuth);
admin.use('/messages', adminAuth);
admin.use('/messages/*', adminAuth);
admin.use('/settings', adminAuth);
admin.use('/settings/*', adminAuth);
admin.use('/site-users', adminAuth);
admin.use('/site-users/*', adminAuth);
admin.use('/reminders', adminAuth);
admin.use('/reminders/*', adminAuth);
admin.use('/changelogs', adminAuth);
admin.use('/changelogs/*', adminAuth);
admin.use('/audit-logs', adminAuth);

// ---- 账号管理 ----
admin.get('/users', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, username, display_name, created_at FROM admin_users ORDER BY id'
  ).all();
  return c.json(results);
});

admin.post('/users', async (c) => {
  const { username, password, display_name = '' } = await c.req.json();
  if (!username || !password) return c.json({ detail: '账号和密码必填' }, 400);
  if (password.length < 8) return c.json({ detail: '密码至少 8 位' }, 400);
  const dup = await c.env.DB.prepare('SELECT id FROM admin_users WHERE username = ?').bind(username).first();
  if (dup) return c.json({ detail: '账号已存在' }, 400);
  const r = await c.env.DB.prepare('INSERT INTO admin_users (username, password_hash, display_name) VALUES (?, ?, ?)')
    .bind(username, bcrypt.hashSync(password, 10), display_name).run();
  await logAudit(c.env.DB, 'user_create', (c.get('admin') as { username: string }).username, `新增管理员账号 ${username}`);
  return c.json({ id: r.meta.last_row_id });
});

admin.put('/users/:id', async (c) => {
  const { display_name, password } = await c.req.json();
  if (password && password.length < 8) return c.json({ detail: '密码至少 8 位' }, 400);
  await c.env.DB.prepare('UPDATE admin_users SET display_name = COALESCE(?, display_name), password_hash = COALESCE(?, password_hash) WHERE id = ?')
    .bind(display_name ?? null, password ? bcrypt.hashSync(password, 10) : null, c.req.param('id')).run();
  return c.json({ ok: true });
});

admin.delete('/users/:id', async (c) => {
  const me = c.get('admin') as { id: number; username: string };
  const targetId = Number(c.req.param('id'));
  if (targetId === me.id) return c.json({ detail: '不能删除当前登录账号' }, 400);
  const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM admin_users').first<{ n: number }>();
  if ((count?.n ?? 0) <= 1) return c.json({ detail: '至少保留一个账号' }, 400);
  const target = await c.env.DB.prepare('SELECT username FROM admin_users WHERE id = ?')
    .bind(targetId).first<{ username: string }>();
  await c.env.DB.prepare('DELETE FROM admin_users WHERE id = ?').bind(targetId).run();
  await logAudit(c.env.DB, 'user_delete', me.username, `删除管理员账号 ${target?.username ?? targetId}`);
  return c.json({ ok: true });
});

// ---- 注册用户管理（users 表，区别于上面的管理员账号）----
admin.get('/site-users', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, username, points, avatar, created_at FROM users ORDER BY id'
  ).all();
  return c.json(results);
});

admin.put('/site-users/:id', async (c) => {
  const { password } = await c.req.json<{ password?: string }>();
  if (!password || password.length < 6) return c.json({ detail: '密码至少 6 位' }, 400);
  const target = await c.env.DB.prepare('SELECT username FROM users WHERE id = ?')
    .bind(Number(c.req.param('id'))).first<{ username: string }>();
  const r = await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .bind(bcrypt.hashSync(password, 10), Number(c.req.param('id'))).run();
  if (!r.meta.changes) return c.json({ detail: '用户不存在' }, 404);
  await logAudit(c.env.DB, 'password_reset', (c.get('admin') as { username: string }).username, `重置用户 ${target?.username ?? c.req.param('id')} 的密码`);
  return c.json({ ok: true });
});

admin.get('/site-users/:id/checkins', async (c) => {
  const userId = Number(c.req.param('id'));
  const user = await c.env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first();
  if (!user) return c.json({ detail: '用户不存在' }, 404);
  const { results } = await c.env.DB.prepare(
    'SELECT id, checkin_date, streak_day, points_earned, created_at FROM checkins WHERE user_id = ? ORDER BY id DESC LIMIT 200'
  ).bind(userId).all();
  return c.json(results);
});

// 积分流水：box/redeem/cancel_refund 的 ref_id 指向 prize_records，联表带上奖品名
admin.get('/site-users/:id/point-transactions', async (c) => {
  const userId = Number(c.req.param('id'));
  const user = await c.env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first();
  if (!user) return c.json({ detail: '用户不存在' }, 404);
  const { results } = await c.env.DB.prepare(
    `SELECT t.id, t.change, t.balance_after, t.type, t.ref_id, t.created_at,
            p.name AS prize_name, p.name_en AS prize_name_en
     FROM point_transactions t
     LEFT JOIN prize_records r ON r.id = t.ref_id AND t.type IN ('box', 'redeem', 'cancel_refund')
     LEFT JOIN prizes p ON p.id = r.prize_id
     WHERE t.user_id = ? ORDER BY t.id DESC LIMIT 200`
  ).bind(userId).all();
  return c.json(results);
});

// ---- 站点设置 ----
admin.get('/settings', async (c) => {
  return c.json({
    site_name: await getSetting(c.env.DB, 'site_name'),
    site_name_en: await getSetting(c.env.DB, 'site_name_en'),
    anniversary_date: await getSetting(c.env.DB, 'anniversary_date'),
    passcode_enabled: Boolean(await getSetting(c.env.DB, 'site_passcode_hash')),
    background_color: await getSetting(c.env.DB, 'background_color'),
    hero_label: await getSetting(c.env.DB, 'hero_label'),
    hero_label_en: await getSetting(c.env.DB, 'hero_label_en'),
    hero_title: await getSetting(c.env.DB, 'hero_title'),
    hero_title_en: await getSetting(c.env.DB, 'hero_title_en'),
    smtp_host: await getSetting(c.env.DB, 'smtp_host'),
    smtp_port: await getSetting(c.env.DB, 'smtp_port'),
    smtp_user: await getSetting(c.env.DB, 'smtp_user'),
    smtp_pass: await getSetting(c.env.DB, 'smtp_pass'),
    default_recipient: await getSetting(c.env.DB, 'default_recipient'),
  });
});

admin.put('/settings', async (c) => {
  const {
    site_name, site_name_en, anniversary_date, passcode, background_color, hero_label, hero_label_en,
    hero_title, hero_title_en,
    smtp_host, smtp_port, smtp_user, smtp_pass, default_recipient,
  } = await c.req.json();
  if (site_name !== undefined) await setSetting(c.env.DB, 'site_name', String(site_name));
  if (site_name_en !== undefined) await setSetting(c.env.DB, 'site_name_en', String(site_name_en));
  if (anniversary_date !== undefined) await setSetting(c.env.DB, 'anniversary_date', String(anniversary_date));
  if (background_color !== undefined) await setSetting(c.env.DB, 'background_color', String(background_color));
  if (hero_label !== undefined) await setSetting(c.env.DB, 'hero_label', String(hero_label));
  if (hero_label_en !== undefined) await setSetting(c.env.DB, 'hero_label_en', String(hero_label_en));
  if (hero_title !== undefined) await setSetting(c.env.DB, 'hero_title', String(hero_title));
  if (hero_title_en !== undefined) await setSetting(c.env.DB, 'hero_title_en', String(hero_title_en));
  if (smtp_host !== undefined) await setSetting(c.env.DB, 'smtp_host', String(smtp_host));
  if (smtp_port !== undefined) await setSetting(c.env.DB, 'smtp_port', String(smtp_port));
  if (smtp_user !== undefined) await setSetting(c.env.DB, 'smtp_user', String(smtp_user));
  if (smtp_pass !== undefined) await setSetting(c.env.DB, 'smtp_pass', String(smtp_pass));
  if (default_recipient !== undefined) await setSetting(c.env.DB, 'default_recipient', String(default_recipient));
  if (passcode !== undefined) {
    await setSetting(c.env.DB, 'site_passcode_hash',
      passcode === '' ? '' : bcrypt.hashSync(String(passcode), 10));
  }
  return c.json({ ok: true });
});

// ---- 相册 CRUD ----
admin.get('/albums', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM albums ORDER BY sort_order, id').all();
  return c.json(results);
});

admin.post('/albums', async (c) => {
  const { title, title_en, description = '', description_en, sort_order = 0 } = await c.req.json();
  if (!title) return c.json({ detail: '标题必填' }, 400);
  const r = await c.env.DB.prepare('INSERT INTO albums (title, title_en, description, description_en, sort_order) VALUES (?, ?, ?, ?, ?)')
    .bind(title, title_en || null, description, description_en || null, sort_order).run();
  return c.json({ id: r.meta.last_row_id, title, description, sort_order });
});

admin.put('/albums/:id', async (c) => {
  const { title, title_en, description, description_en, sort_order } = await c.req.json();
  const setParts: string[] = [];
  const params: unknown[] = [];
  if (title !== undefined) { setParts.push('title = ?'); params.push(title); }
  if (title_en !== undefined) { setParts.push('title_en = ?'); params.push(title_en || null); }
  if (description !== undefined) { setParts.push('description = ?'); params.push(description); }
  if (description_en !== undefined) { setParts.push('description_en = ?'); params.push(description_en || null); }
  if (sort_order !== undefined) { setParts.push('sort_order = ?'); params.push(sort_order); }
  if (!setParts.length) return c.json({ ok: true });
  params.push(Number(c.req.param('id')));
  await c.env.DB.prepare(`UPDATE albums SET ${setParts.join(', ')} WHERE id = ?`).bind(...params).run();
  return c.json({ ok: true });
});

admin.delete('/albums/:id', async (c) => {
  // 先删 R2 里的照片文件
  const { results } = await c.env.DB.prepare('SELECT filename FROM photos WHERE album_id = ?')
    .bind(c.req.param('id')).all<{ filename: string }>();
  for (const p of results) await c.env.UPLOADS.delete(p.filename);
  await c.env.DB.prepare('DELETE FROM albums WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

admin.post('/albums/:id/cover', async (c) => {
  const { photo_id } = await c.req.json();
  await c.env.DB.prepare('UPDATE albums SET cover_photo_id = ? WHERE id = ?')
    .bind(photo_id, c.req.param('id')).run();
  return c.json({ ok: true });
});

// 后台编辑用：返回相册 + 照片（含中英说明），供后台编辑双语内容
admin.get('/albums/:id', async (c) => {
  const album = await c.env.DB.prepare('SELECT * FROM albums WHERE id = ?')
    .bind(c.req.param('id')).first();
  if (!album) return c.json({ detail: '相册不存在' }, 404);
  const { results: photos } = await c.env.DB.prepare(
    'SELECT id, filename, caption, caption_en, taken_at, sort_order FROM photos WHERE album_id = ? ORDER BY sort_order, id'
  ).bind(c.req.param('id')).all();
  return c.json({ ...album, photos });
});

// ---- 照片 ----
admin.post('/photos', async (c) => {
  const body = await c.req.parseBody();
  const file = body.file;
  const albumId = Number(body.album_id);
  const caption = String(body.caption ?? '');
  const captionEn = String(body.caption_en ?? '');
  if (!(file instanceof File) || !albumId) return c.json({ detail: '缺少文件或相册' }, 400);
  const { key, error } = await saveUpload(c.env, file, 'image', 'photos');
  if (error) return c.json({ detail: error }, 400);
  const r = await c.env.DB.prepare('INSERT INTO photos (album_id, filename, caption, caption_en) VALUES (?, ?, ?, ?)')
    .bind(albumId, key!, caption, captionEn || null).run();
  return c.json({ id: r.meta.last_row_id, filename: key, album_id: albumId, caption });
});

admin.put('/photos/:id', async (c) => {
  const { caption, caption_en, sort_order, taken_at, album_id } = await c.req.json();
  const photo = await c.env.DB.prepare('SELECT album_id FROM photos WHERE id = ?')
    .bind(c.req.param('id')).first<{ album_id: number }>();
  if (!photo) return c.json({ detail: '照片不存在' }, 404);
  // 移动到其他相册：校验目标存在；若该照片是原相册封面，清空原相册封面
  if (album_id !== undefined && album_id !== null) {
    const target = await c.env.DB.prepare('SELECT id FROM albums WHERE id = ?').bind(album_id).first();
    if (!target) return c.json({ detail: '目标相册不存在' }, 400);
    await c.env.DB.prepare('UPDATE albums SET cover_photo_id = NULL WHERE id = ? AND cover_photo_id = ?')
      .bind(photo.album_id, Number(c.req.param('id'))).run();
  }
  const setParts: string[] = [];
  const params: unknown[] = [];
  if (caption !== undefined) { setParts.push('caption = ?'); params.push(caption); }
  if (caption_en !== undefined) { setParts.push('caption_en = ?'); params.push(caption_en || null); }
  if (sort_order !== undefined) { setParts.push('sort_order = ?'); params.push(sort_order); }
  if (taken_at !== undefined) { setParts.push('taken_at = ?'); params.push(taken_at); }
  if (album_id !== undefined && album_id !== null) { setParts.push('album_id = ?'); params.push(album_id); }
  if (setParts.length) {
    params.push(Number(c.req.param('id')));
    await c.env.DB.prepare(`UPDATE photos SET ${setParts.join(', ')} WHERE id = ?`).bind(...params).run();
  }
  return c.json({ ok: true });
});

admin.delete('/photos/:id', async (c) => {
  const photo = await c.env.DB.prepare('SELECT filename FROM photos WHERE id = ?')
    .bind(c.req.param('id')).first<{ filename: string }>();
  if (photo) await c.env.UPLOADS.delete(photo.filename);
  await c.env.DB.prepare('DELETE FROM photos WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

// ---- 日记 CRUD ----
admin.get('/diaries', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT d.id, d.title, d.title_en, d.slug, d.status, d.cover_filename, d.published_at, d.created_at, d.updated_at,
            c.id AS category_id, c.name AS category_name
     FROM diaries d LEFT JOIN diary_categories c ON c.id = d.category_id ORDER BY d.id DESC`
  ).all();
  return c.json(results);
});

admin.get('/diaries/:id', async (c) => {
  const d = await c.env.DB.prepare('SELECT * FROM diaries WHERE id = ?').bind(c.req.param('id')).first();
  if (!d) return c.json({ detail: '日记不存在' }, 404);
  const { results: versions } = await c.env.DB.prepare(
    'SELECT id, version, title, content_md, saved_at FROM diary_versions WHERE diary_id = ? ORDER BY version'
  ).bind(d.id).all();
  return c.json({ ...d, versions });
});

admin.post('/diaries', async (c) => {
  const adminUser = c.get('admin') as { id: number };
  const { title, title_en, content_md = '', content_md_en, slug = null, status = 'draft', category_id = null } = await c.req.json();
  if (!title) return c.json({ detail: '标题必填' }, 400);
  if (slug) {
    const dup = await c.env.DB.prepare('SELECT id FROM diaries WHERE slug = ?').bind(slug).first();
    if (dup) return c.json({ detail: 'slug 已被占用' }, 400);
  }
  if (category_id) {
    const cat = await c.env.DB.prepare('SELECT id FROM diary_categories WHERE id = ?').bind(category_id).first();
    if (!cat) return c.json({ detail: '分类不存在' }, 400);
  }
  const publishedAt = status === 'published' ? new Date().toISOString() : null;
  const r = await c.env.DB.prepare(
    'INSERT INTO diaries (author_id, title, title_en, slug, content_md, content_md_en, status, published_at, category_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(adminUser.id, title, title_en || null, slug, content_md, content_md_en || null, status, publishedAt, category_id || null).run();
  const diaryId = r.meta.last_row_id;
  // 创建即第 1 次编辑
  await c.env.DB.prepare('INSERT INTO diary_versions (diary_id, version, title, content_md) VALUES (?, 1, ?, ?)')
    .bind(diaryId, title, content_md).run();
  return c.json({ id: diaryId });
});

admin.put('/diaries/:id', async (c) => {
  const { title, title_en, content_md, content_md_en, slug, status, category_id } = await c.req.json();
  const old = await c.env.DB.prepare('SELECT * FROM diaries WHERE id = ?').bind(c.req.param('id'))
    .first<{ status: string; published_at: string | null; title: string; content_md: string }>();
  if (!old) return c.json({ detail: '日记不存在' }, 404);
  if (slug) {
    const dup = await c.env.DB.prepare('SELECT id FROM diaries WHERE slug = ? AND id != ?')
      .bind(slug, c.req.param('id')).first();
    if (dup) return c.json({ detail: 'slug 已被占用' }, 400);
  }
  // category_id 允许写 null 清空分类，但「仅切状态」的请求不带该字段时不应改动它
  const categoryId = category_id === undefined ? undefined
    : (category_id ? Number(category_id) : null);
  if (categoryId !== undefined && categoryId !== null) {
    const cat = await c.env.DB.prepare('SELECT id FROM diary_categories WHERE id = ?').bind(categoryId).first();
    if (!cat) return c.json({ detail: '分类不存在' }, 400);
  }
  // 首次发布时记录 published_at，撤回后再发布不重置
  const publishedAt = status === 'published' && old.published_at == null
    ? new Date().toISOString() : old.published_at;
  const diaryId = Number(c.req.param('id'));
  const setParts = [
    'title = COALESCE(?, title)',
    'content_md = COALESCE(?, content_md)',
    'slug = COALESCE(?, slug)',
    'status = COALESCE(?, status)',
    'published_at = ?',
    "updated_at = datetime('now')",
  ];
  const params: unknown[] = [title ?? null, content_md ?? null, slug ?? null, status ?? null, publishedAt];
  if (title_en !== undefined) { setParts.push('title_en = ?'); params.push(title_en || null); }
  if (content_md_en !== undefined) { setParts.push('content_md_en = ?'); params.push(content_md_en || null); }
  if (categoryId !== undefined) { setParts.push('category_id = ?'); params.push(categoryId); }
  params.push(diaryId);
  await c.env.DB.prepare(`UPDATE diaries SET ${setParts.join(', ')} WHERE id = ?`).bind(...params).run();
  // 版本记录：仅当标题或正文有实际变化时新增版本（纯状态切换/封面操作不产生噪音版本）
  const newTitle = title ?? old.title;
  const newContent = content_md ?? old.content_md;
  const latest = await c.env.DB.prepare(
    'SELECT version, title, content_md FROM diary_versions WHERE diary_id = ? ORDER BY version DESC LIMIT 1'
  ).bind(diaryId).first<{ version: number; title: string; content_md: string }>();
  if (!latest || latest.title !== newTitle || latest.content_md !== newContent) {
    const nextVersion = (latest?.version ?? 0) + 1;
    await c.env.DB.prepare('INSERT INTO diary_versions (diary_id, version, title, content_md) VALUES (?, ?, ?, ?)')
      .bind(diaryId, nextVersion, newTitle, newContent).run();
  }
  return c.json({ ok: true });
});

admin.delete('/diaries/:id', async (c) => {
  const d = await c.env.DB.prepare('SELECT cover_filename FROM diaries WHERE id = ?')
    .bind(c.req.param('id')).first<{ cover_filename: string | null }>();
  if (d?.cover_filename) await c.env.UPLOADS.delete(d.cover_filename);
  await c.env.DB.prepare('DELETE FROM diaries WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

admin.post('/diaries/:id/cover', async (c) => {
  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) return c.json({ detail: '缺少文件' }, 400);
  const { key, error } = await saveUpload(c.env, file, 'image', 'covers');
  if (error) return c.json({ detail: error }, 400);
  await c.env.DB.prepare('UPDATE diaries SET cover_filename = ? WHERE id = ?')
    .bind(key!, c.req.param('id')).run();
  return c.json({ cover_filename: key });
});

// ---- 日记分类 ----
admin.get('/diary-categories', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT c.id, c.name, c.name_en, c.sort_order, COUNT(d.id) AS count
     FROM diary_categories c LEFT JOIN diaries d ON d.category_id = c.id
     GROUP BY c.id ORDER BY c.sort_order, c.id`
  ).all();
  return c.json(results);
});

admin.post('/diary-categories', async (c) => {
  const { name, name_en, sort_order = 0 } = await c.req.json();
  if (!name?.trim()) return c.json({ detail: '分类名必填' }, 400);
  const dup = await c.env.DB.prepare('SELECT id FROM diary_categories WHERE name = ?').bind(name.trim()).first();
  if (dup) return c.json({ detail: '分类已存在' }, 400);
  const nameEn = (name_en ?? '').trim() || null;
  const r = await c.env.DB.prepare('INSERT INTO diary_categories (name, name_en, sort_order) VALUES (?, ?, ?)')
    .bind(name.trim(), nameEn, sort_order).run();
  return c.json({ id: r.meta.last_row_id, name: name.trim(), name_en: nameEn, sort_order, count: 0 });
});

admin.put('/diary-categories/:id', async (c) => {
  const { name, name_en, sort_order } = await c.req.json();
  if (name !== undefined && !String(name).trim()) return c.json({ detail: '分类名不能为空' }, 400);
  if (name !== undefined) {
    const dup = await c.env.DB.prepare('SELECT id FROM diary_categories WHERE name = ? AND id != ?')
      .bind(String(name).trim(), c.req.param('id')).first();
    if (dup) return c.json({ detail: '分类已存在' }, 400);
  }
  const setParts: string[] = [];
  const params: unknown[] = [];
  if (name !== undefined) { setParts.push('name = ?'); params.push(String(name).trim()); }
  if (name_en !== undefined) { setParts.push('name_en = ?'); params.push(String(name_en).trim() || null); }
  if (sort_order !== undefined) { setParts.push('sort_order = ?'); params.push(sort_order); }
  if (setParts.length) {
    params.push(Number(c.req.param('id')));
    await c.env.DB.prepare(`UPDATE diary_categories SET ${setParts.join(', ')} WHERE id = ?`).bind(...params).run();
  }
  return c.json({ ok: true });
});

admin.delete('/diary-categories/:id', async (c) => {
  // 该分类下的日记回到未分类
  await c.env.DB.prepare('UPDATE diaries SET category_id = NULL WHERE category_id = ?').bind(c.req.param('id')).run();
  await c.env.DB.prepare('DELETE FROM diary_categories WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

// ---- 音乐专辑 ----
admin.get('/music/albums', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM music_albums ORDER BY sort_order, id').all();
  return c.json(results);
});

admin.put('/music/albums/:id', async (c) => {
  const { title, title_en, year, sort_order } = await c.req.json();
  const setParts: string[] = [];
  const params: unknown[] = [];
  if (title !== undefined) { setParts.push('title = ?'); params.push(title); }
  if (title_en !== undefined) { setParts.push('title_en = ?'); params.push(title_en || null); }
  if (year !== undefined) { setParts.push('year = ?'); params.push(year); }
  if (sort_order !== undefined) { setParts.push('sort_order = ?'); params.push(sort_order); }
  if (!setParts.length) return c.json({ ok: true });
  params.push(Number(c.req.param('id')));
  await c.env.DB.prepare(`UPDATE music_albums SET ${setParts.join(', ')} WHERE id = ?`).bind(...params).run();
  return c.json({ ok: true });
});

admin.post('/music/albums/:id/cover', async (c) => {
  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) return c.json({ detail: '缺少文件' }, 400);
  const { key, error } = await saveUpload(c.env, file, 'image', 'covers');
  if (error) return c.json({ detail: error }, 400);
  await c.env.DB.prepare('UPDATE music_albums SET cover_filename = ? WHERE id = ?')
    .bind(key!, c.req.param('id')).run();
  return c.json({ cover_filename: key });
});

// 后台编辑用：返回专辑 + 歌曲（含中英歌名）
admin.get('/music/albums/:id', async (c) => {
  const album = await c.env.DB.prepare('SELECT * FROM music_albums WHERE id = ?')
    .bind(c.req.param('id')).first();
  if (!album) return c.json({ detail: '专辑不存在' }, 404);
  const { results: songs } = await c.env.DB.prepare(
    'SELECT id, title, title_en, track_no, filename, duration FROM songs WHERE album_id = ? ORDER BY track_no, id'
  ).bind(c.req.param('id')).all();
  return c.json({ ...album, songs });
});

// ---- 歌曲 ----
admin.post('/music/songs', async (c) => {
  const body = await c.req.parseBody();
  const file = body.file;
  const albumId = Number(body.album_id);
  const title = String(body.title ?? '');
  const titleEn = String(body.title_en ?? '');
  const trackNo = Number(body.track_no ?? 0);
  if (!(file instanceof File) || !albumId || !title) return c.json({ detail: '缺少文件/专辑/歌名' }, 400);
  const { key, error } = await saveUpload(c.env, file, 'audio', 'music');
  if (error) return c.json({ detail: error }, 400);
  const r = await c.env.DB.prepare('INSERT INTO songs (album_id, title, title_en, track_no, filename) VALUES (?, ?, ?, ?, ?)')
    .bind(albumId, title, titleEn || null, trackNo, key!).run();
  return c.json({ id: r.meta.last_row_id, filename: key });
});

admin.put('/music/songs/:id', async (c) => {
  const { title, title_en, track_no } = await c.req.json();
  const setParts: string[] = [];
  const params: unknown[] = [];
  if (title !== undefined) { setParts.push('title = ?'); params.push(title); }
  if (title_en !== undefined) { setParts.push('title_en = ?'); params.push(title_en || null); }
  if (track_no !== undefined) { setParts.push('track_no = ?'); params.push(track_no); }
  if (!setParts.length) return c.json({ ok: true });
  params.push(Number(c.req.param('id')));
  await c.env.DB.prepare(`UPDATE songs SET ${setParts.join(', ')} WHERE id = ?`).bind(...params).run();
  return c.json({ ok: true });
});

admin.delete('/music/songs/:id', async (c) => {
  const s = await c.env.DB.prepare('SELECT filename FROM songs WHERE id = ?')
    .bind(c.req.param('id')).first<{ filename: string }>();
  if (s) await c.env.UPLOADS.delete(s.filename);
  await c.env.DB.prepare('DELETE FROM songs WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

// ---- 留言审核 ----
admin.get('/messages', async (c) => {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (c.req.query('pending') === '1') conditions.push('is_approved = 0');
  // 日记编辑页按目标过滤评论（target_type=diary&target_id=N）
  const targetType = c.req.query('target_type');
  const targetId = c.req.query('target_id');
  if (targetType) { conditions.push('target_type = ?'); params.push(targetType); }
  if (targetId) { conditions.push('target_id = ?'); params.push(Number(targetId)); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM messages ${where} ORDER BY id DESC LIMIT 200`
  ).bind(...params).all();
  return c.json(results);
});

admin.post('/messages/:id/approve', async (c) => {
  await c.env.DB.prepare('UPDATE messages SET is_approved = 1 WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

admin.post('/messages/:id/hide', async (c) => {
  await c.env.DB.prepare('UPDATE messages SET is_approved = 0 WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

admin.delete('/messages/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM messages WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

// 一次性导入：将 R2 photos/ 下已有文件批量录入 D1
admin.post('/photos/import-r2', async (c) => {
  const { album_id } = await c.req.json<{ album_id: number }>();
  if (!album_id) return c.json({ detail: '缺少 album_id' }, 400);
  const album = await c.env.DB.prepare('SELECT id FROM albums WHERE id = ?').bind(album_id).first();
  if (!album) return c.json({ detail: '相册不存在' }, 404);

  // 取已入库的 filename
  const { results: existing } = await c.env.DB.prepare('SELECT filename FROM photos').all<{ filename: string }>();
  const existingSet = new Set(existing.map(r => r.filename));

  const imported: string[] = [];
  const skipped: string[] = [];
  let cursor: string | undefined;

  do {
    const listed = await c.env.UPLOADS.list({ prefix: 'photos/', cursor });
    for (const obj of listed.objects) {
      if (existingSet.has(obj.key)) { skipped.push(obj.key); continue; }
      await c.env.DB.prepare('INSERT INTO photos (album_id, filename, caption) VALUES (?, ?, ?)')
        .bind(album_id, obj.key, '').run();
      imported.push(obj.key);
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  return c.json({ imported: imported.length, skipped: skipped.length, album_id });
});

// ---- 提醒事项 CRUD ----
admin.get('/reminders', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM reminders ORDER BY send_at, id'
  ).all();
  return c.json(results);
});

admin.post('/reminders', async (c) => {
  const { title, content = '', send_at, recipient = '' } = await c.req.json();
  if (!title || !send_at) return c.json({ detail: '标题和发送时间必填' }, 400);
  const r = await c.env.DB.prepare(
    'INSERT INTO reminders (title, content, send_at, recipient) VALUES (?, ?, ?, ?)'
  ).bind(String(title), String(content), String(send_at), String(recipient)).run();
  return c.json({ id: r.meta.last_row_id });
});

admin.put('/reminders/:id', async (c) => {
  const { title, content, send_at, recipient, status } = await c.req.json();
  if (!title || !send_at) return c.json({ detail: '标题和发送时间必填' }, 400);
  await c.env.DB.prepare(
    `UPDATE reminders SET title = ?, content = ?, send_at = ?, recipient = ?, status = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(String(title), String(content), String(send_at), String(recipient), status || 'pending', c.req.param('id')).run();
  return c.json({ ok: true });
});

admin.delete('/reminders/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM reminders WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

// ---- 版本更新日志 CRUD ----
admin.get('/changelogs', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM changelogs ORDER BY id DESC'
  ).all();
  return c.json(results);
});

admin.post('/changelogs', async (c) => {
  const { version, content = '' } = await c.req.json();
  if (!version || !String(version).trim()) return c.json({ detail: '版本号必填' }, 400);
  const r = await c.env.DB.prepare(
    'INSERT INTO changelogs (version, content) VALUES (?, ?)'
  ).bind(String(version).trim(), String(content)).run();
  return c.json({ id: r.meta.last_row_id });
});

admin.put('/changelogs/:id', async (c) => {
  const { version, content } = await c.req.json();
  if (!version || !String(version).trim()) return c.json({ detail: '版本号必填' }, 400);
  const r = await c.env.DB.prepare(
    'UPDATE changelogs SET version = ?, content = ? WHERE id = ?'
  ).bind(String(version).trim(), String(content ?? ''), c.req.param('id')).run();
  if (!r.meta.changes) return c.json({ detail: '记录不存在' }, 404);
  return c.json({ ok: true });
});

admin.delete('/changelogs/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM changelogs WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

// ---- 用户数据变动（自动记录，只读，最新 100 条）----
admin.get('/audit-logs', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM audit_logs ORDER BY id DESC LIMIT 100'
  ).all();
  return c.json(results);
});

export default admin;
