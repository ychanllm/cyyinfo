import { env, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { applyMigrations } from './helpers';
import bcrypt from 'bcryptjs';

beforeAll(async () => { await applyMigrations(); });

describe('访客口令', () => {
  it('口令未设置时公开接口直接放行', async () => {
    const res = await SELF.fetch('http://x/api/albums');
    expect(res.status).toBe(200);
  });

  it('site/status 始终公开', async () => {
    const res = await SELF.fetch('http://x/api/site/status');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.passcode_enabled).toBe(false);
  });

  it('设置口令后公开接口返回 401，验证口令后可访问', async () => {
    await env.DB.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).bind('site_passcode_hash', bcrypt.hashSync('iloveu', 10)).run();

    const blocked = await SELF.fetch('http://x/api/albums');
    expect(blocked.status).toBe(401);

    const bad = await SELF.fetch('http://x/api/passcode/verify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode: 'wrong' }),
    });
    expect(bad.status).toBe(401);

    const ok = await SELF.fetch('http://x/api/passcode/verify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode: 'iloveu' }),
    });
    expect(ok.status).toBe(200);
    const { token } = await ok.json() as any;

    const authed = await SELF.fetch('http://x/api/albums', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(authed.status).toBe(200);

    // 还原，避免影响其他用例
    await env.DB.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).bind('site_passcode_hash', '').run();
  });
});
