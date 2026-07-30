import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import type { Env } from '../types';
import { signJwt, adminAuth } from '../auth';
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

export default admin;
