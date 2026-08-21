import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import type { Env } from '../types';
import { signJwt, verifyJwt, userAuth } from '../auth';
import { rateLimit, clientIp } from '../security';
import { getSetting } from '../guard';

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
  return c.json({ token, username: user.username, points: user.points });
});

users.get('/auth/me', userAuth, async (c) => {
  const me = c.get('user') as { id: number; username: string };
  const row = await c.env.DB.prepare('SELECT id, username, points, created_at FROM users WHERE id = ?')
    .bind(me.id).first();
  if (!row) return c.json({ detail: '用户不存在' }, 404);
  return c.json(row);
});

export default users;
