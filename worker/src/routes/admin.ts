import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import type { Env } from '../types';
import { signJwt, adminAuth } from '../auth';
import { rateLimit, clientIp } from '../security';

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
admin.use('/users', adminAuth);
admin.use('/users/*', adminAuth);

export default admin;
