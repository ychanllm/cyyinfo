import { SELF, env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { applyMigrations, adminToken, registerUser } from './helpers';

let admin: string;
let alice: { id: number; token: string };
let bob: { id: number; token: string };
let diaryId: number;
// 每个测试用独立 IP，避免共享留言限流桶（10 条/小时/IP，且 400 也计数）
let ipSeq = 0;
const nextIp = () => `10.12.${++ipSeq}.1`;

beforeAll(async () => {
  await applyMigrations();
  admin = await adminToken();
  alice = await registerUser('notif_alice');
  bob = await registerUser('notif_bob');
  const create = await SELF.fetch('http://x/api/admin/diaries', {
    method: 'POST',
    headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '通知测试日记' }),
  });
  diaryId = ((await create.json()) as any).id;
});

const postMsg = (body: Record<string, unknown>, token?: string) =>
  SELF.fetch('http://x/api/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': nextIp(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

const notifCount = (rtype: string, rid: number) =>
  env.DB.prepare('SELECT COUNT(*) AS n FROM notifications WHERE recipient_type = ? AND recipient_id = ?')
    .bind(rtype, rid).first<{ n: number }>().then((r) => r?.n ?? 0);

describe('通知生成', () => {
  it('登录用户评论日记 → 评论带 user_id，站长收到 comment 通知', async () => {
    const before = await notifCount('admin', 1);
    const res = await postMsg(
      { nickname: '爱丽丝', content: '通知-顶级', target_type: 'diary', target_id: diaryId },
      alice.token,
    );
    expect(res.status).toBe(201);
    const msg = await env.DB.prepare(
      "SELECT user_id FROM messages WHERE content = '通知-顶级'"
    ).first<{ user_id: number | null }>();
    expect(msg?.user_id).toBe(alice.id);
    expect(await notifCount('admin', 1)).toBe(before + 1);
    const n = await env.DB.prepare(
      "SELECT type, actor_nickname, target_type, target_id, is_read FROM notifications WHERE recipient_type = 'admin' AND recipient_id = 1 ORDER BY id DESC"
    ).first<any>();
    expect(n).toMatchObject({ type: 'comment', actor_nickname: '爱丽丝', target_type: 'diary', target_id: diaryId, is_read: 0 });
  });

  it('游客评论日记 → user_id 为 NULL，站长仍收到通知', async () => {
    const before = await notifCount('admin', 1);
    const res = await postMsg({ nickname: '路人', content: '通知-游客', target_type: 'diary', target_id: diaryId });
    expect(res.status).toBe(201);
    const msg = await env.DB.prepare(
      "SELECT user_id FROM messages WHERE content = '通知-游客'"
    ).first<{ user_id: number | null }>();
    expect(msg?.user_id).toBeNull();
    expect(await notifCount('admin', 1)).toBe(before + 1);
  });

  it('回复登录用户的评论 → 原作者收到 reply 通知；自己回复自己不通知', async () => {
    const base = await notifCount('user', alice.id);
    // alice 的顶级评论（同时也会通知站长，这里不关心）
    await postMsg({ nickname: '爱丽丝', content: '通知-待回复', target_type: 'diary', target_id: diaryId }, alice.token);
    const top = await env.DB.prepare(
      "SELECT id FROM messages WHERE content = '通知-待回复'"
    ).first<{ id: number }>();
    // bob 回复 alice → alice +1
    const r1 = await postMsg(
      { nickname: '鲍勃', content: '通知-回复', target_type: 'diary', target_id: diaryId, parent_id: top!.id },
      bob.token,
    );
    expect(r1.status).toBe(201);
    expect(await notifCount('user', alice.id)).toBe(base + 1);
    // alice 自己回复自己 → 不新增
    const r2 = await postMsg(
      { nickname: '爱丽丝', content: '通知-自回', target_type: 'diary', target_id: diaryId, parent_id: top!.id },
      alice.token,
    );
    expect(r2.status).toBe(201);
    expect(await notifCount('user', alice.id)).toBe(base + 1);
  });

  it('游客评论被回复 → 不产生任何通知', async () => {
    await postMsg({ nickname: '路人甲', content: '通知-游客楼', target_type: 'diary', target_id: diaryId });
    const top = await env.DB.prepare(
      "SELECT id FROM messages WHERE content = '通知-游客楼'"
    ).first<{ id: number }>();
    const beforeAll = await env.DB.prepare('SELECT COUNT(*) AS n FROM notifications').first<{ n: number }>();
    await postMsg(
      { nickname: '鲍勃', content: '通知-回游客', target_type: 'diary', target_id: diaryId, parent_id: top!.id },
      bob.token,
    );
    const afterAll = await env.DB.prepare('SELECT COUNT(*) AS n FROM notifications').first<{ n: number }>();
    expect(afterAll?.n).toBe(beforeAll?.n);
  });

  it('站长自己评论自己的日记 → 不给自己发通知', async () => {
    const before = await notifCount('admin', 1);
    const res = await postMsg(
      { nickname: '站长', content: '通知-自评', target_type: 'diary', target_id: diaryId },
      admin,
    );
    expect(res.status).toBe(201);
    expect(await notifCount('admin', 1)).toBe(before);
  });
});

const getUnread = (token: string) =>
  SELF.fetch('http://x/api/notifications/unread', { headers: { Authorization: `Bearer ${token}` } });

const markRead = (token: string, body: Record<string, unknown> = {}) =>
  SELF.fetch('http://x/api/notifications/read', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('通知查询与已读', () => {
  it('无 token → 401', async () => {
    expect((await SELF.fetch('http://x/api/notifications/unread')).status).toBe(401);
    expect((await markRead('')).status).toBe(401);
  });

  it('站长 unread 返回 count 与 items（含 excerpt）', async () => {
    // Task 3 的用例已给 admin#1 生成过未读通知
    const res = await getUnread(admin);
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.count).toBeGreaterThan(0);
    expect(data.items[0]).toHaveProperty('actor_nickname');
    expect(data.items[0]).toHaveProperty('excerpt');
    expect(data.items[0]).toHaveProperty('target_type');
  });

  it('标记单条已读，count 减少；不能标记他人通知', async () => {
    const before = ((await (await getUnread(admin)).json()) as any).count;
    const adminItem = ((await (await getUnread(admin)).json()) as any).items[0];
    // alice 尝试标记站长的通知 → 无效
    await markRead(alice.token, { ids: [adminItem.id] });
    expect(((await (await getUnread(admin)).json()) as any).count).toBe(before);
    // 站长标记自己这条
    const res = await markRead(admin, { ids: [adminItem.id] });
    expect(res.status).toBe(200);
    expect(((await (await getUnread(admin)).json()) as any).count).toBe(before - 1);
  });

  it('不传 ids 标记全部已读', async () => {
    await markRead(admin);
    expect(((await (await getUnread(admin)).json()) as any).count).toBe(0);
    // 同理清掉 alice 的，避免影响后续全量测试的其他文件断言
    await markRead(alice.token);
  });
});

describe('review 修复回归', () => {
  it('站长删除产生过通知的留言 → 删除成功且关联通知一并清除', async () => {
    // alice 评论日记 → 站长收到 comment 通知
    const res = await postMsg(
      { nickname: '爱丽丝', content: '通知-待删除', target_type: 'diary', target_id: diaryId },
      alice.token,
    );
    expect(res.status).toBe(201);
    const msg = await env.DB.prepare(
      "SELECT id FROM messages WHERE content = '通知-待删除'"
    ).first<{ id: number }>();
    const notif = await env.DB.prepare(
      'SELECT id FROM notifications WHERE message_id = ?'
    ).bind(msg!.id).first<{ id: number }>();
    expect(notif).toBeTruthy();
    // 站长删除该留言（此前会因 notifications 外键报错）
    const del = await SELF.fetch(`http://x/api/admin/messages/${msg!.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${admin}` },
    });
    expect(del.status).toBe(200);
    expect(await env.DB.prepare('SELECT id FROM messages WHERE id = ?').bind(msg!.id).first()).toBeNull();
    expect(await env.DB.prepare('SELECT id FROM notifications WHERE message_id = ?').bind(msg!.id).first()).toBeNull();
  });

  it('未审核的 site 回复 → 通知存在但 excerpt 为 null', async () => {
    const authH = { Authorization: `Bearer ${admin}` };
    // alice 发 site 顶级评论（待审核），站长审核通过后才能被回复
    const top = await postMsg({ nickname: '爱丽丝', content: '通知-站点楼', target_type: 'site' }, alice.token);
    expect(top.status).toBe(202);
    const pending = await (await SELF.fetch('http://x/api/admin/messages?pending=1', { headers: authH })).json() as any[];
    const siteTop = pending.find((m) => m.content === '通知-站点楼');
    await SELF.fetch(`http://x/api/admin/messages/${siteTop.id}/approve`, { method: 'POST', headers: authH });
    // bob 回复（待审核 202），但仍会生成给 alice 的 reply 通知
    const reply = await postMsg(
      { nickname: '鲍勃', content: '通知-站点待审回复', target_type: 'site', parent_id: siteTop.id },
      bob.token,
    );
    expect(reply.status).toBe(202);
    // alice 的未读里通知存在，但 excerpt 不得泄露未审核内容
    const data = (await (await getUnread(alice.token)).json()) as any;
    const item = data.items.find((n: any) => n.type === 'reply' && n.actor_nickname === '鲍勃' && n.target_type === 'site');
    expect(item).toBeTruthy();
    expect(item.excerpt).toBeNull();
    // 清理：先删回复再删顶级，避免共享存储影响其他测试文件
    const replyRow = await env.DB.prepare(
      "SELECT id FROM messages WHERE content = '通知-站点待审回复'"
    ).first<{ id: number }>();
    await SELF.fetch(`http://x/api/admin/messages/${replyRow!.id}`, { method: 'DELETE', headers: authH });
    await SELF.fetch(`http://x/api/admin/messages/${siteTop.id}`, { method: 'DELETE', headers: authH });
  });
});

// 共享存储下本文件的日记评论会污染 messages.test 的 diary#1 断言，结束时清理（先删通知再删留言，尊重外键）
afterAll(async () => {
  await env.DB.prepare(
    'DELETE FROM notifications WHERE message_id IN (SELECT id FROM messages WHERE target_type = ? AND target_id = ?)'
  ).bind('diary', diaryId).run();
  await env.DB.prepare('DELETE FROM messages WHERE target_type = ? AND target_id = ?').bind('diary', diaryId).run();
});
