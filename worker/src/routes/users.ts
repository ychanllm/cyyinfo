import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import type { Env } from '../types';
import { signJwt, verifyJwt, userAuth } from '../auth';
import { rateLimit, clientIp } from '../security';
import { getSetting } from '../guard';
import { saveUpload } from '../upload';
import { logAudit } from '../audit';

const users = new Hono<{ Bindings: Env }>();

// 用户名：2-20 位字母/数字/下划线/中文
const USERNAME_RE = /^[\w一-龥]{2,20}$/;

interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  points: number;
}

users.post('/auth/register', async (c) => {
  if (!rateLimit({ limit: 30, windowSec: 900, key: `register:${clientIp(c.req.raw)}` })) {
    return c.json({ detail: '尝试过于频繁，请稍后再试' }, 429);
  }
  // 站点启用口令时，注册前必须先通过口令（guest/admin/user JWT 均可）
  const passHash = await getSetting(c.env.DB, 'site_passcode_hash');
  if (passHash) {
    const header = c.req.header('Authorization') ?? '';
    const payload = header ? await verifyJwt(c.env, header.replace(/^Bearer\s+/i, '')) : null;
    if (!payload || !['guest', 'admin', 'user'].includes(payload.role as string)) {
      return c.json({ detail: '请先通过访客口令' }, 401);
    }
  }
  const { username, password } = await c.req.json<{ username?: string; password?: string }>();
  const name = (username ?? '').trim();
  if (!USERNAME_RE.test(name)) return c.json({ detail: '用户名需为 2-20 位字母、数字、下划线或中文' }, 400);
  if (!password || password.length < 6) return c.json({ detail: '密码至少 6 位' }, 400);
  const dup = await c.env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(name).first();
  if (dup) return c.json({ detail: '用户名已被注册' }, 409);
  const r = await c.env.DB.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
    .bind(name, bcrypt.hashSync(password, 10)).run();
  await logAudit(c.env.DB, 'user_register', name, `用户 ${name} 注册`);
  const token = await signJwt(c.env, { sub: r.meta.last_row_id, username: name, role: 'user' }, 24 * 7);
  return c.json({ token, username: name });
});

users.post('/auth/login', async (c) => {
  if (!rateLimit({ limit: 5, windowSec: 900, key: `userlogin:${clientIp(c.req.raw)}` })) {
    return c.json({ detail: '尝试过于频繁，请稍后再试' }, 429);
  }
  const { username, password } = await c.req.json<{ username?: string; password?: string }>();
  if (!username || !password) return c.json({ detail: '请输入用户名和密码' }, 400);
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE username = ?')
    .bind(username.trim()).first<UserRow>();
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return c.json({ detail: '用户名或密码错误' }, 401);
  }
  const token = await signJwt(c.env, { sub: user.id, username: user.username, role: 'user' }, 24 * 7);
  await logAudit(c.env.DB, 'user_login', user.username, `用户 ${user.username} 登录`);
  return c.json({ token, username: user.username, points: user.points });
});

users.get('/auth/me', userAuth, async (c) => {
  const me = c.get('user') as { id: number; username: string };
  const row = await c.env.DB.prepare('SELECT id, username, points, avatar, created_at FROM users WHERE id = ?')
    .bind(me.id).first();
  if (!row) return c.json({ detail: '用户不存在' }, 404);
  return c.json(row);
});

// 头像上传：仅图片且 ≤ 5MB，旧头像文件随之删除
const MAX_AVATAR = 5 * 1024 * 1024;
users.post('/users/me/avatar', userAuth, async (c) => {
  const me = c.get('user') as { id: number };
  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) return c.json({ detail: '缺少文件' }, 400);
  if (file.size > MAX_AVATAR) return c.json({ detail: '文件过大' }, 400);
  const { key, error } = await saveUpload(c.env, file, 'image', 'avatars');
  if (error) return c.json({ detail: error }, 400);
  const old = await c.env.DB.prepare('SELECT avatar FROM users WHERE id = ?')
    .bind(me.id).first<{ avatar: string | null }>();
  await c.env.DB.prepare('UPDATE users SET avatar = ? WHERE id = ?').bind(key!, me.id).run();
  if (old?.avatar) await c.env.UPLOADS.delete(old.avatar).catch(() => {});
  await logAudit(c.env.DB, 'avatar_update', (c.get('user') as { username: string }).username, `用户更换头像`);
  return c.json({ avatar: key });
});

export default users;
