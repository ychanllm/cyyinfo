import { SELF, env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { applyMigrations, adminToken, registerUser } from './helpers';

let admin: string;
let user: { id: number; token: string };

beforeAll(async () => {
  await applyMigrations();
  admin = await adminToken();
  user = await registerUser('notify_target');
});

const postNotify = (body: Record<string, unknown>, token: string | null = admin) =>
  SELF.fetch('http://x/api/admin/notifications', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

describe('管理员直发用户提醒', () => {
  it('发送成功：用户未读里 type=message 且 detail 直通', async () => {
    const res = await postNotify({ user_id: user.id, content: '记得签到哦' });
    expect(res.status).toBe(200);
    const n = await env.DB.prepare(
      "SELECT type, message_id, actor_nickname, target_type, target_id, detail, is_read FROM notifications WHERE recipient_type = 'user' AND recipient_id = ? ORDER BY id DESC"
    ).bind(user.id).first<any>();
    expect(n).toMatchObject({
      type: 'message', message_id: null, target_type: 'message',
      target_id: null, detail: '记得签到哦', is_read: 0,
    });
    // 用户侧未读接口能拿到 detail（detail 类直通，不走 excerpt）
    const unread = await SELF.fetch('http://x/api/notifications/unread', {
      headers: { Authorization: `Bearer ${user.token}` },
    });
    const data = (await unread.json()) as any;
    const item = data.items.find((i: any) => i.type === 'message' && i.detail === '记得签到哦');
    expect(item).toBeTruthy();
    expect(item.excerpt).toBeNull();
  });

  it('内容首尾空白会被 trim；空内容 400', async () => {
    const res = await postNotify({ user_id: user.id, content: '  带空格  ' });
    expect(res.status).toBe(200);
    const n = await env.DB.prepare(
      "SELECT detail FROM notifications WHERE recipient_type = 'user' AND recipient_id = ? AND type = 'message' ORDER BY id DESC"
    ).bind(user.id).first<{ detail: string }>();
    expect(n?.detail).toBe('带空格');
    expect((await postNotify({ user_id: user.id, content: '   ' })).status).toBe(400);
    expect((await postNotify({ user_id: user.id })).status).toBe(400);
  });

  it('内容超 200 字 → 400；用户不存在 → 404；非法 user_id → 400', async () => {
    expect((await postNotify({ user_id: user.id, content: 'x'.repeat(201) })).status).toBe(400);
    expect((await postNotify({ user_id: 999999, content: 'hi' })).status).toBe(404);
    expect((await postNotify({ user_id: 'abc', content: 'hi' })).status).toBe(400);
  });

  it('非管理员 token → 401；用户 token 也被拒', async () => {
    expect((await postNotify({ user_id: user.id, content: 'hi' }, null)).status).toBe(401);
    expect((await postNotify({ user_id: user.id, content: 'hi' }, user.token)).status).toBe(401);
  });
});
