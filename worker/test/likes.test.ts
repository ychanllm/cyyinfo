import { SELF, env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { applyMigrations, registerUser } from './helpers';

let alice: { id: number; token: string };
let bob: { id: number; token: string };
const auth = (u: { token: string }) => ({
  Authorization: `Bearer ${u.token}`,
  'Content-Type': 'application/json',
});

beforeAll(async () => {
  await applyMigrations();
  alice = await registerUser('likes_alice');
  bob = await registerUser('likes_bob');
  await env.DB.prepare('DELETE FROM likes').run();
});

const toggle = (user: { token: string }, target_type: string, target_id: number) =>
  SELF.fetch('http://x/api/likes/toggle', {
    method: 'POST',
    headers: auth(user),
    body: JSON.stringify({ target_type, target_id }),
  });

describe('点赞', () => {
  it('未登录 toggle 401', async () => {
    const res = await SELF.fetch('http://x/api/likes/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_type: 'diary', target_id: 1 }),
    });
    expect(res.status).toBe(401);
  });

  it('非法 target_type / target_id 返回 400', async () => {
    expect((await toggle(alice, 'song', 1)).status).toBe(400);
    expect((await toggle(alice, 'diary', 0)).status).toBe(400);
    expect((await toggle(alice, 'diary', 1.5)).status).toBe(400);

    const badGet = await SELF.fetch('http://x/api/likes?target_type=song&target_id=1');
    expect(badGet.status).toBe(400);
    const badBatch = await SELF.fetch('http://x/api/likes/batch?target_type=song&ids=1');
    expect(badBatch.status).toBe(400);
    const tooMany = await SELF.fetch(
      `http://x/api/likes/batch?target_type=photo&ids=${Array.from({ length: 101 }, (_, i) => i + 1).join(',')}`
    );
    expect(tooMany.status).toBe(400);
  });

  it('点赞/取消往返：count 与 liked 正确变化', async () => {
    let res = await toggle(alice, 'diary', 9001);
    expect(res.status).toBe(200);
    expect(await res.json() as any).toEqual({ liked: true, count: 1 });

    let get = await SELF.fetch('http://x/api/likes?target_type=diary&target_id=9001', { headers: auth(alice) });
    expect(await get.json() as any).toEqual({ count: 1, liked: true });

    // 未登录查看：count 在，liked 无意义（false）
    get = await SELF.fetch('http://x/api/likes?target_type=diary&target_id=9001');
    expect(await get.json() as any).toEqual({ count: 1, liked: false });

    res = await toggle(alice, 'diary', 9001);
    expect(await res.json() as any).toEqual({ liked: false, count: 0 });

    get = await SELF.fetch('http://x/api/likes?target_type=diary&target_id=9001', { headers: auth(alice) });
    expect(await get.json() as any).toEqual({ count: 0, liked: false });
  });

  it('UNIQUE 约束：重复插入同一目标不重复计数', async () => {
    await toggle(alice, 'photo', 9002);
    // 绕过 toggle 直接重复插入，应被 UNIQUE 拒绝
    await expect(
      env.DB.prepare('INSERT INTO likes (user_id, target_type, target_id) VALUES (?, ?, ?)')
        .bind(alice.id, 'photo', 9002).run()
    ).rejects.toThrow();
    const get = await SELF.fetch('http://x/api/likes?target_type=photo&target_id=9002');
    expect((await get.json() as any).count).toBe(1);
    await toggle(alice, 'photo', 9002); // 清理
  });

  it('batch 返回各目标计数与当前用户 liked', async () => {
    await toggle(alice, 'album', 9003);
    await toggle(alice, 'album', 9004);
    await toggle(bob, 'album', 9003);

    const res = await SELF.fetch('http://x/api/likes/batch?target_type=album&ids=9003,9004,9005', { headers: auth(alice) });
    expect(res.status).toBe(200);
    expect(await res.json() as any).toEqual({
      '9003': { count: 2, liked: true },
      '9004': { count: 1, liked: true },
      '9005': { count: 0, liked: false },
    });

    // 未登录：计数相同，liked 全 false
    const anon = await SELF.fetch('http://x/api/likes/batch?target_type=album&ids=9003,9004');
    expect(await anon.json() as any).toEqual({
      '9003': { count: 2, liked: false },
      '9004': { count: 1, liked: false },
    });

    await toggle(alice, 'album', 9003);
    await toggle(alice, 'album', 9004);
    await toggle(bob, 'album', 9003);
  });
});
