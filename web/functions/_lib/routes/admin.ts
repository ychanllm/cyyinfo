import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import type { Env } from '../types';
import { signJwt, adminAuth } from '../auth';
import { getSetting, setSetting } from '../guard';
import { rateLimit, clientIp } from '../security';
import { saveUpload } from '../upload';

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
admin.use('/music', adminAuth);
admin.use('/music/*', adminAuth);
admin.use('/messages', adminAuth);
admin.use('/messages/*', adminAuth);
admin.use('/settings', adminAuth);
admin.use('/settings/*', adminAuth);
admin.use('/reminders', adminAuth);
admin.use('/reminders/*', adminAuth);

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
  const me = c.get('admin') as { id: number };
  const targetId = Number(c.req.param('id'));
  if (targetId === me.id) return c.json({ detail: '不能删除当前登录账号' }, 400);
  const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM admin_users').first<{ n: number }>();
  if ((count?.n ?? 0) <= 1) return c.json({ detail: '至少保留一个账号' }, 400);
  await c.env.DB.prepare('DELETE FROM admin_users WHERE id = ?').bind(targetId).run();
  return c.json({ ok: true });
});

// ---- 站点设置 ----
admin.get('/settings', async (c) => {
  return c.json({
    site_name: await getSetting(c.env.DB, 'site_name'),
    anniversary_date: await getSetting(c.env.DB, 'anniversary_date'),
    passcode_enabled: Boolean(await getSetting(c.env.DB, 'site_passcode_hash')),
    background_color: await getSetting(c.env.DB, 'background_color'),
    hero_label: await getSetting(c.env.DB, 'hero_label'),
    hero_title: await getSetting(c.env.DB, 'hero_title'),
    smtp_host: await getSetting(c.env.DB, 'smtp_host'),
    smtp_port: await getSetting(c.env.DB, 'smtp_port'),
    smtp_user: await getSetting(c.env.DB, 'smtp_user'),
    smtp_pass: await getSetting(c.env.DB, 'smtp_pass'),
    default_recipient: await getSetting(c.env.DB, 'default_recipient'),
  });
});

admin.put('/settings', async (c) => {
  const {
    site_name, anniversary_date, passcode, background_color, hero_label, hero_title,
    smtp_host, smtp_port, smtp_user, smtp_pass, default_recipient,
  } = await c.req.json();
  if (site_name !== undefined) await setSetting(c.env.DB, 'site_name', String(site_name));
  if (anniversary_date !== undefined) await setSetting(c.env.DB, 'anniversary_date', String(anniversary_date));
  if (background_color !== undefined) await setSetting(c.env.DB, 'background_color', String(background_color));
  if (hero_label !== undefined) await setSetting(c.env.DB, 'hero_label', String(hero_label));
  if (hero_title !== undefined) await setSetting(c.env.DB, 'hero_title', String(hero_title));
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
  const { title, description = '', sort_order = 0 } = await c.req.json();
  if (!title) return c.json({ detail: '标题必填' }, 400);
  const r = await c.env.DB.prepare('INSERT INTO albums (title, description, sort_order) VALUES (?, ?, ?)')
    .bind(title, description, sort_order).run();
  return c.json({ id: r.meta.last_row_id, title, description, sort_order });
});

admin.put('/albums/:id', async (c) => {
  const { title, description, sort_order } = await c.req.json();
  await c.env.DB.prepare('UPDATE albums SET title = COALESCE(?, title), description = COALESCE(?, description), sort_order = COALESCE(?, sort_order) WHERE id = ?')
    .bind(title ?? null, description ?? null, sort_order ?? null, c.req.param('id')).run();
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

// ---- 照片 ----
admin.post('/photos', async (c) => {
  const body = await c.req.parseBody();
  const file = body.file;
  const albumId = Number(body.album_id);
  const caption = String(body.caption ?? '');
  if (!(file instanceof File) || !albumId) return c.json({ detail: '缺少文件或相册' }, 400);
  const { key, error } = await saveUpload(c.env, file, 'image', 'photos');
  if (error) return c.json({ detail: error }, 400);
  const r = await c.env.DB.prepare('INSERT INTO photos (album_id, filename, caption) VALUES (?, ?, ?)')
    .bind(albumId, key!, caption).run();
  return c.json({ id: r.meta.last_row_id, filename: key, album_id: albumId, caption });
});

admin.put('/photos/:id', async (c) => {
  const { caption, sort_order, taken_at } = await c.req.json();
  await c.env.DB.prepare('UPDATE photos SET caption = COALESCE(?, caption), sort_order = COALESCE(?, sort_order), taken_at = COALESCE(?, taken_at) WHERE id = ?')
    .bind(caption ?? null, sort_order ?? null, taken_at ?? null, c.req.param('id')).run();
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
    'SELECT id, title, slug, status, cover_filename, published_at, created_at, updated_at FROM diaries ORDER BY id DESC'
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
  const { title, content_md = '', slug = null, status = 'draft' } = await c.req.json();
  if (!title) return c.json({ detail: '标题必填' }, 400);
  if (slug) {
    const dup = await c.env.DB.prepare('SELECT id FROM diaries WHERE slug = ?').bind(slug).first();
    if (dup) return c.json({ detail: 'slug 已被占用' }, 400);
  }
  const publishedAt = status === 'published' ? new Date().toISOString() : null;
  const r = await c.env.DB.prepare(
    'INSERT INTO diaries (author_id, title, slug, content_md, status, published_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(adminUser.id, title, slug, content_md, status, publishedAt).run();
  const diaryId = r.meta.last_row_id;
  // 创建即第 1 次编辑
  await c.env.DB.prepare('INSERT INTO diary_versions (diary_id, version, title, content_md) VALUES (?, 1, ?, ?)')
    .bind(diaryId, title, content_md).run();
  return c.json({ id: diaryId });
});

admin.put('/diaries/:id', async (c) => {
  const { title, content_md, slug, status } = await c.req.json();
  const old = await c.env.DB.prepare('SELECT * FROM diaries WHERE id = ?').bind(c.req.param('id'))
    .first<{ status: string; published_at: string | null; title: string; content_md: string }>();
  if (!old) return c.json({ detail: '日记不存在' }, 404);
  if (slug) {
    const dup = await c.env.DB.prepare('SELECT id FROM diaries WHERE slug = ? AND id != ?')
      .bind(slug, c.req.param('id')).first();
    if (dup) return c.json({ detail: 'slug 已被占用' }, 400);
  }
  // 首次发布时记录 published_at，撤回后再发布不重置
  const publishedAt = status === 'published' && old.published_at == null
    ? new Date().toISOString() : old.published_at;
  const diaryId = Number(c.req.param('id'));
  await c.env.DB.prepare(
    `UPDATE diaries SET title = COALESCE(?, title), content_md = COALESCE(?, content_md),
     slug = COALESCE(?, slug), status = COALESCE(?, status), published_at = ?,
     updated_at = datetime('now') WHERE id = ?`
  ).bind(title ?? null, content_md ?? null, slug ?? null, status ?? null, publishedAt, diaryId).run();
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

// ---- 音乐专辑 ----
admin.get('/music/albums', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM music_albums ORDER BY sort_order, id').all();
  return c.json(results);
});

admin.put('/music/albums/:id', async (c) => {
  const { title, year, sort_order } = await c.req.json();
  await c.env.DB.prepare('UPDATE music_albums SET title = COALESCE(?, title), year = COALESCE(?, year), sort_order = COALESCE(?, sort_order) WHERE id = ?')
    .bind(title ?? null, year ?? null, sort_order ?? null, c.req.param('id')).run();
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

// ---- 歌曲 ----
admin.post('/music/songs', async (c) => {
  const body = await c.req.parseBody();
  const file = body.file;
  const albumId = Number(body.album_id);
  const title = String(body.title ?? '');
  const trackNo = Number(body.track_no ?? 0);
  if (!(file instanceof File) || !albumId || !title) return c.json({ detail: '缺少文件/专辑/歌名' }, 400);
  const { key, error } = await saveUpload(c.env, file, 'audio', 'music');
  if (error) return c.json({ detail: error }, 400);
  const r = await c.env.DB.prepare('INSERT INTO songs (album_id, title, track_no, filename) VALUES (?, ?, ?, ?)')
    .bind(albumId, title, trackNo, key!).run();
  return c.json({ id: r.meta.last_row_id, filename: key });
});

admin.put('/music/songs/:id', async (c) => {
  const { title, track_no } = await c.req.json();
  await c.env.DB.prepare('UPDATE songs SET title = COALESCE(?, title), track_no = COALESCE(?, track_no) WHERE id = ?')
    .bind(title ?? null, track_no ?? null, c.req.param('id')).run();
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
  const pendingOnly = c.req.query('pending') === '1';
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM messages ${pendingOnly ? 'WHERE is_approved = 0' : ''} ORDER BY id DESC LIMIT 200`
  ).all();
  return c.json(results);
});

admin.post('/messages/:id/approve', async (c) => {
  await c.env.DB.prepare('UPDATE messages SET is_approved = 1 WHERE id = ?').bind(c.req.param('id')).run();
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

export default admin;
