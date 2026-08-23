import { SELF, env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { applyMigrations, adminToken } from './helpers';

let token: string;
beforeAll(async () => { await applyMigrations(); token = await adminToken(); });
const auth = () => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

describe('账号与设置', () => {
  it('新增账号可登录，不能删除自己', async () => {
    const me = await (await SELF.fetch('http://x/api/admin/users', { headers: auth() })).json() as any[];
    expect(me).toHaveLength(1);
    expect(me[0].password_hash).toBeUndefined();

    const del = await SELF.fetch(`http://x/api/admin/users/${me[0].id}`, { method: 'DELETE', headers: auth() });
    expect(del.status).toBe(400);

    const create = await SELF.fetch('http://x/api/admin/users', {
      method: 'POST', headers: auth(),
      body: JSON.stringify({ username: 'partner', password: 'secret123', display_name: '她' }),
    });
    expect(create.status).toBe(200);

    const login = await SELF.fetch('http://x/api/admin/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'partner', password: 'secret123' }),
    });
    expect(login.status).toBe(200);
  });

  it('设置访客口令后 status 变化，清除后恢复', async () => {
    let res = await SELF.fetch('http://x/api/admin/settings', {
      method: 'PUT', headers: auth(), body: JSON.stringify({ passcode: 'hello2026', anniversary_date: '2024-02-14' }),
    });
    expect(res.status).toBe(200);
    let status = await (await SELF.fetch('http://x/api/site/status')).json() as any;
    expect(status.passcode_enabled).toBe(true);
    expect(status.anniversary_date).toBe('2024-02-14');

    res = await SELF.fetch('http://x/api/admin/settings', {
      method: 'PUT', headers: auth(), body: JSON.stringify({ passcode: '' }),
    });
    expect(res.status).toBe(200);
    status = await (await SELF.fetch('http://x/api/site/status')).json() as any;
    expect(status.passcode_enabled).toBe(false);
  });

  it('点赞归属用户：不存在的用户 400，合法用户可设置并读回，可清空', async () => {
    const r = await env.DB.prepare("INSERT INTO users (username, password_hash) VALUES ('like_attr_user', 'x')").run();
    const uid = Number(r.meta.last_row_id);

    let res = await SELF.fetch('http://x/api/admin/settings', {
      method: 'PUT', headers: auth(), body: JSON.stringify({ admin_like_user_id: 999999 }),
    });
    expect(res.status).toBe(400);

    res = await SELF.fetch('http://x/api/admin/settings', {
      method: 'PUT', headers: auth(), body: JSON.stringify({ admin_like_user_id: uid }),
    });
    expect(res.status).toBe(200);
    const s = await (await SELF.fetch('http://x/api/admin/settings', { headers: auth() })).json() as any;
    expect(s.admin_like_user_id).toBe(String(uid));

    res = await SELF.fetch('http://x/api/admin/settings', {
      method: 'PUT', headers: auth(), body: JSON.stringify({ admin_like_user_id: '' }),
    });
    expect(res.status).toBe(200);
    const s2 = await (await SELF.fetch('http://x/api/admin/settings', { headers: auth() })).json() as any;
    expect(s2.admin_like_user_id).toBe('');
  });
});
