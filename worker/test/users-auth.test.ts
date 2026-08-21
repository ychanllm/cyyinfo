import { SELF, env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import bcrypt from 'bcryptjs';
import { applyMigrations } from './helpers';

beforeAll(applyMigrations);
const json = { 'Content-Type': 'application/json' };

async function cleanup() {
  // 先清子表再清 users：checkins/prize_records/point_transactions 都有指向 users 的外键
  await env.DB.prepare('DELETE FROM point_transactions').run();
  await env.DB.prepare('DELETE FROM prize_records').run();
  await env.DB.prepare('DELETE FROM checkins').run();
  await env.DB.prepare('DELETE FROM users').run();
  await env.DB.prepare("DELETE FROM settings WHERE key = 'site_passcode_hash'").run();
}

function register(username: string, password: string, token?: string) {
  const headers: Record<string, string> = { ...json };
  if (token) headers.Authorization = `Bearer ${token}`;
  return SELF.fetch('http://x/api/auth/register', {
    method: 'POST', headers, body: JSON.stringify({ username, password }),
  });
}

describe('用户注册与登录', () => {
  it('站点无口令时可直接注册，注册即登录', async () => {
    await cleanup();
    const res = await register('小明', 'secret6');
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.token).toBeTruthy();
    expect(data.username).toBe('小明');

    const me = await SELF.fetch('http://x/api/auth/me', {
      headers: { Authorization: `Bearer ${data.token}` },
    });
    expect(me.status).toBe(200);
    const meData = await me.json() as any;
    expect(meData.username).toBe('小明');
    expect(meData.points).toBe(0);
    expect(meData.password_hash).toBeUndefined();
  });

  it('非法用户名/弱密码/重名（大小写不敏感）被拒绝', async () => {
    await cleanup();
    expect((await register('a', 'secret6')).status).toBe(400);
    expect((await register('validname', '12345')).status).toBe(400);
    expect((await register('Alice', 'secret6')).status).toBe(200);
    expect((await register('ALICE', 'secret6')).status).toBe(409);
  });

  it('启用口令后注册需先通过口令', async () => {
    await cleanup();
    await env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
      .bind('site_passcode_hash', bcrypt.hashSync('pw123456', 10)).run();

    expect((await register('dave', 'secret6')).status).toBe(401);

    const verify = await SELF.fetch('http://x/api/passcode/verify', {
      method: 'POST', headers: json, body: JSON.stringify({ passcode: 'pw123456' }),
    });
    expect(verify.status).toBe(200);
    const { token: guestToken } = await verify.json() as any;
    expect((await register('dave', 'secret6', guestToken)).status).toBe(200);

    await env.DB.prepare("DELETE FROM settings WHERE key = 'site_passcode_hash'").run();
  });

  it('登录成功返回 token，密码错误 401', async () => {
    await cleanup();
    await register('bob', 'secret6');

    const bad = await SELF.fetch('http://x/api/auth/login', {
      method: 'POST', headers: json, body: JSON.stringify({ username: 'bob', password: 'wrong' }),
    });
    expect(bad.status).toBe(401);

    const ok = await SELF.fetch('http://x/api/auth/login', {
      method: 'POST', headers: json, body: JSON.stringify({ username: 'BOB', password: 'secret6' }),
    });
    expect(ok.status).toBe(200);
    const data = await ok.json() as any;
    expect(data.token).toBeTruthy();
    expect(data.username).toBe('bob');
    expect(data.points).toBe(0);
  });

  it('user 角色可通过内容门禁', async () => {
    await cleanup();
    const reg = await register('carol', 'secret6');
    const { token } = await reg.json() as any;

    await env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
      .bind('site_passcode_hash', bcrypt.hashSync('pw123456', 10)).run();
    const res = await SELF.fetch('http://x/api/albums', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    await env.DB.prepare("DELETE FROM settings WHERE key = 'site_passcode_hash'").run();
  });
});
