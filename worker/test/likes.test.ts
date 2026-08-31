import { SELF, env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { applyMigrations, registerUser, adminToken } from './helpers';

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
    expect(await get.json() as any).toEqual({ count: 1, liked: true, daily_remaining: 50 });

    // 未登录查看：count 在，liked 无意义（false）
    get = await SELF.fetch('http://x/api/likes?target_type=diary&target_id=9001');
    expect(await get.json() as any).toEqual({ count: 1, liked: false });

    res = await toggle(alice, 'diary', 9001);
    expect(await res.json() as any).toEqual({ liked: false, count: 0 });

    get = await SELF.fetch('http://x/api/likes?target_type=diary&target_id=9001', { headers: auth(alice) });
    expect(await get.json() as any).toEqual({ count: 0, liked: false, daily_remaining: 50 });
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
      '9003': { count: 2, liked: true, daily_remaining: 50 },
      '9004': { count: 1, liked: true, daily_remaining: 50 },
      '9005': { count: 0, liked: false, daily_remaining: 50 },
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

  const burst = (user: { token: string }, target_type: string, target_id: number, delta: number) =>
    SELF.fetch('http://x/api/likes/burst', {
      method: 'POST',
      headers: auth(user),
      body: JSON.stringify({ target_type, target_id, delta }),
    });

  it('burst：首次创建行并累加，计数为 SUM(count)', async () => {
    let res = await burst(alice, 'diary', 9100, 3);
    expect(res.status).toBe(200);
    expect(await res.json() as any).toEqual({ liked: true, count: 3, daily_remaining: 47 });

    res = await burst(alice, 'diary', 9100, 5);
    expect(await res.json() as any).toEqual({ liked: true, count: 8, daily_remaining: 42 });

    // 另一用户累加同一目标
    res = await burst(bob, 'diary', 9100, 2);
    expect(await res.json() as any).toEqual({ liked: true, count: 10, daily_remaining: 48 });

    const get = await SELF.fetch('http://x/api/likes?target_type=diary&target_id=9100', { headers: auth(alice) });
    expect(await get.json() as any).toEqual({ count: 10, liked: true, daily_remaining: 42 });

    const batch = await SELF.fetch('http://x/api/likes/batch?target_type=diary&ids=9100', { headers: auth(bob) });
    expect(await batch.json() as any).toEqual({ '9100': { count: 10, liked: true, daily_remaining: 48 } });

    await toggle(alice, 'diary', 9100); // 清理（删 alice 行，剩 bob 的 2）
    const after = await SELF.fetch('http://x/api/likes?target_type=diary&target_id=9100');
    expect((await after.json() as any).count).toBe(2);
    await toggle(bob, 'diary', 9100);
  });

  it('burst：delta 非法返回 400，未登录 401', async () => {
    expect((await burst(alice, 'diary', 9101, 0)).status).toBe(400);
    expect((await burst(alice, 'diary', 9101, 11)).status).toBe(400);
    expect((await burst(alice, 'diary', 9101, 1.5)).status).toBe(400);
    expect((await burst(alice, 'song', 9101, 1)).status).toBe(400);
    const anon = await SELF.fetch('http://x/api/likes/burst', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_type: 'diary', target_id: 9101, delta: 1 }),
    });
    expect(anon.status).toBe(401);
  });

  it('burst：每日上限 50 钳制，响应带 daily_remaining', async () => {
    let res;
    for (let i = 0; i < 6; i++) res = await burst(alice, 'photo', 9102, 10); // 60 > 50
    expect(await res!.json() as any).toEqual({ liked: true, count: 50, daily_remaining: 0 });
    const get = await SELF.fetch('http://x/api/likes?target_type=photo&target_id=9102', { headers: auth(alice) });
    expect(await get.json() as any).toEqual({ count: 50, liked: true, daily_remaining: 0 });
    await toggle(alice, 'photo', 9102); // 清理
    const cleaned = await SELF.fetch('http://x/api/likes?target_type=photo&target_id=9102');
    expect((await cleaned.json() as any).count).toBe(0);
  });

  it('burst：跨天（北京时间）后每日计数重置，累计 count 继续增长', async () => {
    for (let i = 0; i < 5; i++) await burst(alice, 'diary', 9103, 10); // 当日 50
    // 直接把 daily_date 改成历史日期，模拟跨天
    await env.DB.prepare(
      "UPDATE likes SET daily_date = '2000-01-01' WHERE user_id = ? AND target_type = 'diary' AND target_id = 9103"
    ).bind(alice.id).run();
    const res = await burst(alice, 'diary', 9103, 10);
    expect(await res.json() as any).toEqual({ liked: true, count: 60, daily_remaining: 40 });
    await toggle(alice, 'diary', 9103); // 清理
  });
});

describe('管理员点赞（归属用户）', () => {
  const adminAuthHeader = async () => ({
    Authorization: `Bearer ${await adminToken()}`,
    'Content-Type': 'application/json',
  });
  const setAttribution = (v: string | null) =>
    v === null
      ? env.DB.prepare("DELETE FROM settings WHERE key = 'admin_like_user_id'").run()
      : env.DB.prepare("INSERT INTO settings (key, value) VALUES ('admin_like_user_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(v).run();
  const adminBurst = (target_type: string, target_id: number, delta: number) =>
    adminAuthHeader().then((headers) => SELF.fetch('http://x/api/likes/burst', {
      method: 'POST', headers, body: JSON.stringify({ target_type, target_id, delta }),
    }));

  it('未配置归属用户时管理员点赞返回 400', async () => {
    await setAttribution(null);
    const res = await adminBurst('diary', 9200, 1);
    expect(res.status).toBe(400);
  });

  it('归属用户不存在时管理员点赞返回 400', async () => {
    await setAttribution('999999');
    const res = await adminBurst('diary', 9200, 1);
    expect(res.status).toBe(400);
    await setAttribution(null);
  });

  it('配置归属用户后：管理员点赞记到该用户，liked 状态对管理员可见，toggle 可取消', async () => {
    const token = await adminToken();
    await setAttribution(String(alice.id));

    const res = await adminBurst('diary', 9201, 2);
    expect(res.status).toBe(200);
    expect(await res.json() as any).toEqual({ liked: true, count: 2, daily_remaining: 48 });

    // 点赞记到归属用户头上
    const row = await env.DB.prepare('SELECT user_id, count FROM likes WHERE target_type = ? AND target_id = ?')
      .bind('diary', 9201).first<{ user_id: number; count: number }>();
    expect(row).toMatchObject({ user_id: alice.id, count: 2 });

    // 管理员查看 liked 状态可见（含 batch）
    const get = await SELF.fetch('http://x/api/likes?target_type=diary&target_id=9201', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(await get.json() as any).toEqual({ count: 2, liked: true, daily_remaining: 48 });
    const batch = await SELF.fetch('http://x/api/likes/batch?target_type=diary&ids=9201', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(await batch.json() as any).toEqual({ '9201': { count: 2, liked: true, daily_remaining: 48 } });

    // toggle 取消
    const un = await SELF.fetch('http://x/api/likes/toggle', {
      method: 'POST',
      headers: await adminAuthHeader(),
      body: JSON.stringify({ target_type: 'diary', target_id: 9201 }),
    });
    expect(await un.json() as any).toEqual({ liked: false, count: 0 });

    await setAttribution(null);
  });

  it('访客 token 仍然 401', async () => {
    const res = await SELF.fetch('http://x/api/likes/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer invalid-token' },
      body: JSON.stringify({ target_type: 'diary', target_id: 9202 }),
    });
    expect(res.status).toBe(401);
  });
});

describe('店铺点赞（store）', () => {
  let storeId = 0;

  beforeAll(async () => {
    const r = await env.DB.prepare("INSERT INTO stores (name, is_active) VALUES ('赞测店铺', 1)").run();
    storeId = Number(r.meta.last_row_id);
  });

  it('toggle/burst/batch 支持 target_type=store；dish 仍 400', async () => {
    const res = await toggle(alice, 'store', storeId);
    expect(res.status).toBe(200);
    expect(await res.json() as any).toMatchObject({ liked: true, count: 1 });

    const batch = await SELF.fetch(`http://x/api/likes/batch?target_type=store&ids=${storeId},999999`, { headers: auth(alice) });
    const b = await batch.json() as any;
    expect(b[String(storeId)]).toMatchObject({ count: 1, liked: true });

    // dish 不在 CHECK 内
    expect((await toggle(alice, 'dish', 1)).status).toBe(400);
  });

  it('赞店铺 → 站长收到 like 通知（detail=店铺，jump=store）', async () => {
    const n = await env.DB.prepare(
      "SELECT recipient_type, type, actor_nickname, target_type, target_id, detail FROM notifications WHERE type = 'like' AND target_type = 'store' ORDER BY id DESC"
    ).first<any>();
    expect(n).toMatchObject({
      recipient_type: 'admin', type: 'like', actor_nickname: 'likes_alice',
      target_type: 'store', target_id: storeId, detail: '店铺',
    });
  });

  it('迁移后旧点赞数据与 daily 字段完好', async () => {
    const row = await env.DB.prepare(
      "SELECT sql FROM sqlite_master WHERE name = 'likes'"
    ).first<{ sql: string }>();
    expect(row!.sql).toContain("'store'");
    expect(row!.sql).toContain('daily_count');
    // 本文件既有用例的点赞行仍在（count 字段非空）
    const cnt = await env.DB.prepare('SELECT COUNT(*) AS n FROM likes').first<{ n: number }>();
    expect(cnt!.n).toBeGreaterThan(0);
  });

  it('清理', async () => {
    await env.DB.prepare("DELETE FROM notifications WHERE type = 'like' AND target_type = 'store'").run();
    await env.DB.prepare("DELETE FROM likes WHERE target_type = 'store'").run();
    await env.DB.prepare('DELETE FROM stores WHERE id = ?').bind(storeId).run();
  });
});

describe('点赞审计日志', () => {
  it('日记目标的审计详情显示日记标题而非 diary#id', async () => {
    const admin = await adminToken();
    const create = await SELF.fetch('http://x/api/admin/diaries', {
      method: 'POST',
      headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '审计标题日记' }),
    });
    const diaryId = ((await create.json()) as any).id;

    await toggle(alice, 'diary', diaryId);
    const likeLog = await env.DB.prepare(
      "SELECT detail FROM audit_logs WHERE type = 'like' ORDER BY id DESC"
    ).first<{ detail: string }>();
    expect(likeLog?.detail).toBe(`点赞 日记「审计标题日记」`);

    await SELF.fetch('http://x/api/likes/burst', {
      method: 'POST',
      headers: auth(alice),
      body: JSON.stringify({ target_type: 'diary', target_id: diaryId, delta: 2 }),
    });
    const burstLog = await env.DB.prepare(
      "SELECT detail FROM audit_logs WHERE type = 'like_burst' ORDER BY id DESC"
    ).first<{ detail: string }>();
    expect(burstLog?.detail).toBe(`连赞 +2 日记「审计标题日记」`);

    // 清理
    await toggle(alice, 'diary', diaryId); // toggle 走取消（记录「取消点赞」）
    await env.DB.prepare("DELETE FROM audit_logs WHERE detail LIKE '%审计标题日记%'").run();
    await env.DB.prepare("DELETE FROM notifications WHERE type = 'like' AND target_type = 'diary' AND target_id = ?").bind(diaryId).run();
    await SELF.fetch(`http://x/api/admin/diaries/${diaryId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${admin}` },
    });
  });
});
