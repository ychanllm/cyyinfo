import { env, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { applyMigrations } from './helpers';

beforeAll(async () => { await applyMigrations(); });

describe('admin auth', () => {
  it('首管理员用 secret 初始化并可登录', async () => {
    const res = await SELF.fetch('http://x/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: env.ADMIN_USERNAME, password: env.ADMIN_PASSWORD }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.token).toBeTruthy();
  });

  it('密码错误返回 401', async () => {
    const res = await SELF.fetch('http://x/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: env.ADMIN_USERNAME, password: 'wrong' }),
    });
    expect(res.status).toBe(401);
    expect((await res.json() as any).detail).toBeTruthy();
  });

  it('无 token 访问受保护路由返回 401', async () => {
    const res = await SELF.fetch('http://x/api/admin/users');
    expect(res.status).toBe(401);
  });
});
