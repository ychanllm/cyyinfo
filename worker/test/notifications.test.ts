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
  // 兜底：清掉本文件产生的 like/prize/thread 通知（message_id 为 NULL，不被留言级联删除覆盖）
  await env.DB.prepare("DELETE FROM notifications WHERE type IN ('like','prize','thread')").run();
  await env.DB.prepare(
    'DELETE FROM notifications WHERE message_id IN (SELECT id FROM messages WHERE target_type = ? AND target_id = ?)'
  ).bind('diary', diaryId).run();
  await env.DB.prepare('DELETE FROM messages WHERE target_type = ? AND target_id = ?').bind('diary', diaryId).run();
  // 串测试日记（讨论串用例所建，id 可能落在 messages.test 的 diary#2 上）同样清理
  await env.DB.prepare(
    "DELETE FROM notifications WHERE message_id IN (SELECT id FROM messages WHERE content LIKE '串-%')"
  ).run();
  await env.DB.prepare("DELETE FROM messages WHERE content LIKE '串-%'").run();
  await env.DB.prepare("DELETE FROM diaries WHERE title = '串测试日记'").run();
});

describe('通知表扩展（0023）', () => {
  it('message_id 可空 + detail 透出：prize 类通知在 unread 可见且 excerpt 为 null', async () => {
    await env.DB.prepare(
      "INSERT INTO notifications (recipient_type, recipient_id, type, message_id, actor_nickname, target_type, target_id, detail) VALUES ('user', ?, 'prize', NULL, '站长', 'points', NULL, '你兑换的「测试」已被核销')"
    ).bind(alice.id).run();
    const data = (await (await getUnread(alice.token)).json()) as any;
    const item = data.items.find((n: any) => n.type === 'prize');
    expect(item).toBeTruthy();
    expect(item.detail).toBe('你兑换的「测试」已被核销');
    expect(item.excerpt).toBeNull();
    await markRead(alice.token);
  });

  it('旧 reply/comment 数据迁移后完好', async () => {
    // 本文件前面的用例生成的通知行仍在（type 仍在 CHECK 集合内）
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM notifications WHERE type IN ('reply','comment')"
    ).first<{ n: number }>();
    expect(row!.n).toBeGreaterThan(0);
  });
});

describe('通知范围：评论类扩展', () => {
  it('photo/site 新评论立即通知站长，未审核 excerpt 为 null', async () => {
    const before = await notifCount('admin', 1);
    const p = await postMsg({ nickname: '拍客', content: '照片真好看', target_type: 'photo', target_id: 9501 });
    expect(p.status).toBe(202);
    const s = await postMsg({ nickname: '过客', content: '留言板报到', target_type: 'site' });
    expect(s.status).toBe(202);
    expect(await notifCount('admin', 1)).toBe(before + 2);

    const data = (await (await getUnread(admin)).json()) as any;
    const photoN = data.items.find((n: any) => n.type === 'comment' && n.target_type === 'photo' && n.actor_nickname === '拍客');
    expect(photoN).toBeTruthy();
    expect(photoN.excerpt).toBeNull(); // 待审核内容不透出

    // 清理待审核留言（admin DELETE 级联清 notifications）
    const authH = { Authorization: `Bearer ${admin}` };
    const pending = await (await SELF.fetch('http://x/api/admin/messages?pending=1', { headers: authH })).json() as any[];
    for (const m of pending.filter((m) => ['照片真好看', '留言板报到'].includes(m.content))) {
      await SELF.fetch(`http://x/api/admin/messages/${m.id}`, { method: 'DELETE', headers: authH });
    }
  });

  it('日记讨论串：参与过的登录用户收到 thread；自己/回复不触发', async () => {
    // 独立日记隔离订阅者
    const create = await SELF.fetch('http://x/api/admin/diaries', {
      method: 'POST',
      headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '串测试日记' }),
    });
    const tid = ((await create.json()) as any).id;

    // alice 参与讨论
    await postMsg({ nickname: '爱丽丝', content: '串- alice 先评', target_type: 'diary', target_id: tid }, alice.token);
    const baseAlice = await notifCount('user', alice.id);
    // bob 顶级评论 → alice 收 thread；bob 自己收不到自己的
    await postMsg({ nickname: '鲍勃', content: '串- bob 新评', target_type: 'diary', target_id: tid }, bob.token);
    expect(await notifCount('user', alice.id)).toBe(baseAlice + 1);
    const thread = await env.DB.prepare(
      "SELECT type, actor_nickname, target_type, target_id FROM notifications WHERE recipient_type = 'user' AND recipient_id = ? AND type = 'thread' ORDER BY id DESC"
    ).bind(alice.id).first<any>();
    expect(thread).toMatchObject({ actor_nickname: '鲍勃', target_type: 'diary', target_id: tid });

    // 回复不触发 thread：alice 回复 bob 的评论 → alice 的 thread 数不变
    const bobTop = await env.DB.prepare("SELECT id FROM messages WHERE content = '串- bob 新评'").first<{ id: number }>();
    const threadBefore = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM notifications WHERE type = 'thread'"
    ).first<{ n: number }>();
    await postMsg({ nickname: '爱丽丝', content: '串- alice 回复', target_type: 'diary', target_id: tid, parent_id: bobTop!.id }, alice.token);
    const threadAfter = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM notifications WHERE type = 'thread'"
    ).first<{ n: number }>();
    expect(threadAfter!.n).toBe(threadBefore!.n);

    // 游客评论不进入订阅（user_id NULL）：游客再评 → alice 仍收 thread（游客是新评论者），但游客自己永远收不到
    const guestBefore = await notifCount('user', alice.id);
    await postMsg({ nickname: '游客丙', content: '串- 游客评', target_type: 'diary', target_id: tid });
    expect(await notifCount('user', alice.id)).toBe(guestBefore + 1);
  });
});

describe('通知范围：点赞', () => {
  const likeToggle = (token: string, target_type: string, target_id: number) =>
    SELF.fetch('http://x/api/likes/toggle', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_type, target_id }),
    });
  const likeNotifs = (rtype: string, rid: number) =>
    env.DB.prepare("SELECT COUNT(*) AS n FROM notifications WHERE type = 'like' AND recipient_type = ? AND recipient_id = ?")
      .bind(rtype, rid).first<{ n: number }>().then((r) => r?.n ?? 0);

  it('首次赞日记通知站长；取消再赞当天不重复；burst 连赞也只一次', async () => {
    const mk = async (title: string) => {
      const res = await SELF.fetch('http://x/api/admin/diaries', {
        method: 'POST',
        headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      return ((await res.json()) as any).id as number;
    };
    const d1 = await mk('点赞通知日记一');
    const d2 = await mk('点赞通知日记二');

    const base = await likeNotifs('admin', 1);
    // toggle 首次赞 → +1
    await likeToggle(alice.token, 'diary', d1);
    expect(await likeNotifs('admin', 1)).toBe(base + 1);
    const n = await env.DB.prepare(
      "SELECT actor_nickname, target_type, target_id, detail FROM notifications WHERE type = 'like' ORDER BY id DESC"
    ).first<any>();
    expect(n).toMatchObject({ actor_nickname: 'notif_alice', target_type: 'diary', target_id: d1, detail: '日记' });

    // 取消再赞 → 当天不重复
    await likeToggle(alice.token, 'diary', d1);
    await likeToggle(alice.token, 'diary', d1);
    expect(await likeNotifs('admin', 1)).toBe(base + 1);

    // burst 首次 → +1；再次 burst → 不重复
    const burst = (id: number, delta: number) =>
      SELF.fetch('http://x/api/likes/burst', {
        method: 'POST',
        headers: { Authorization: `Bearer ${alice.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_type: 'diary', target_id: id, delta }),
      });
    await burst(d2, 3);
    expect(await likeNotifs('admin', 1)).toBe(base + 2);
    await burst(d2, 2);
    expect(await likeNotifs('admin', 1)).toBe(base + 2);

    // 清理点赞
    await likeToggle(alice.token, 'diary', d1);
    await env.DB.prepare("DELETE FROM likes WHERE target_type = 'diary' AND target_id IN (?, ?)").bind(d1, d2).run();
  });

  it('评论被赞通知评论作者；游客评论被赞不通知；自己赞自己不通知', async () => {
    // bob 在独立日记发评论（免审核立即可见）
    const create = await SELF.fetch('http://x/api/admin/diaries', {
      method: 'POST',
      headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '评论点赞日记' }),
    });
    const did = ((await create.json()) as any).id;
    await postMsg({ nickname: '鲍勃', content: '赞我这条', target_type: 'diary', target_id: did }, bob.token);
    await postMsg({ nickname: '路人', content: '游客被赞', target_type: 'diary', target_id: did });
    const list = await (await SELF.fetch(`http://x/api/messages?target_type=diary&target_id=${did}`)).json() as any[];
    const bobMsg = list.find((m) => m.content === '赞我这条');
    const guestMsg = list.find((m) => m.content === '游客被赞');

    const baseBob = await likeNotifs('user', bob.id);
    await likeToggle(alice.token, 'message', bobMsg.id);
    expect(await likeNotifs('user', bob.id)).toBe(baseBob + 1);

    // 游客评论被赞：全表 like 通知数不变
    const allBefore = await env.DB.prepare("SELECT COUNT(*) AS n FROM notifications WHERE type = 'like'").first<{ n: number }>();
    await likeToggle(alice.token, 'message', guestMsg.id);
    const allAfter = await env.DB.prepare("SELECT COUNT(*) AS n FROM notifications WHERE type = 'like'").first<{ n: number }>();
    expect(allAfter!.n).toBe(allBefore!.n);

    // bob 自己赞自己的评论 → 不通知
    await likeToggle(bob.token, 'message', bobMsg.id);
    expect(await likeNotifs('user', bob.id)).toBe(baseBob + 1);

    // 清理
    await likeToggle(alice.token, 'message', bobMsg.id);
    await likeToggle(alice.token, 'message', guestMsg.id);
    await likeToggle(bob.token, 'message', bobMsg.id);
  });

  it('站长赞自己的日记不通知自己', async () => {
    // 配置管理员点赞归属用户（resolveLikerId 需要）
    await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('admin_like_user_id', ?)")
      .bind(String(alice.id)).run();
    const base = await likeNotifs('admin', 1);
    const create = await SELF.fetch('http://x/api/admin/diaries', {
      method: 'POST',
      headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '站长自赞日记' }),
    });
    const did = ((await create.json()) as any).id;
    await likeToggle(admin, 'diary', did);
    expect(await likeNotifs('admin', 1)).toBe(base);
    // 清理
    await likeToggle(admin, 'diary', did);
    await env.DB.prepare("DELETE FROM settings WHERE key = 'admin_like_user_id'").run();
  });

  it('跨接收人去重：同一人当天赞不同作者的 site 评论，各自都收到通知', async () => {
    const carol = await registerUser('notif_carol');
    // bob 与 carol 各发一条待审核 site 留言（跳转目标均为 site/NULL，旧去重键在此碰撞）
    await postMsg({ nickname: '鲍勃', content: '站点被赞-bob', target_type: 'site' }, bob.token);
    await postMsg({ nickname: '卡罗尔', content: '站点被赞-carol', target_type: 'site' }, carol.token);
    const bobMsg = await env.DB.prepare(
      "SELECT id FROM messages WHERE content = '站点被赞-bob'"
    ).first<{ id: number }>();
    const carolMsg = await env.DB.prepare(
      "SELECT id FROM messages WHERE content = '站点被赞-carol'"
    ).first<{ id: number }>();

    const baseBob = await likeNotifs('user', bob.id);
    const baseCarol = await likeNotifs('user', carol.id);
    await likeToggle(alice.token, 'message', bobMsg!.id);
    expect(await likeNotifs('user', bob.id)).toBe(baseBob + 1);
    // 第二条接收人不同，去重不再误吞
    await likeToggle(alice.token, 'message', carolMsg!.id);
    expect(await likeNotifs('user', carol.id)).toBe(baseCarol + 1);

    // 清理：取消点赞 + admin DELETE 这两条 site 留言（级联清 notifications）
    const authH = { Authorization: `Bearer ${admin}` };
    await likeToggle(alice.token, 'message', bobMsg!.id);
    await likeToggle(alice.token, 'message', carolMsg!.id);
    await SELF.fetch(`http://x/api/admin/messages/${bobMsg!.id}`, { method: 'DELETE', headers: authH });
    await SELF.fetch(`http://x/api/admin/messages/${carolMsg!.id}`, { method: 'DELETE', headers: authH });
  });
});

describe('通知范围：奖品核销/取消', () => {
  const prizeNotifs = (uid: number) =>
    env.DB.prepare("SELECT detail FROM notifications WHERE type = 'prize' AND recipient_type = 'user' AND recipient_id = ? ORDER BY id")
      .bind(uid).all<{ detail: string }>().then((r) => r.results.map((x) => x.detail));
  const mkRecord = async (uid: number, name: string) => {
    const pid = Number((await env.DB.prepare(
      'INSERT INTO prizes (name, points_cost) VALUES (?, 10)'
    ).bind(name).run()).meta.last_row_id);
    const rid = Number((await env.DB.prepare(
      "INSERT INTO prize_records (user_id, prize_id, source, points_spent) VALUES (?, ?, 'redeem', 10)"
    ).bind(uid, pid).run()).meta.last_row_id);
    return { pid, rid };
  };

  it('站长核销 → 用户收到「已核销」；站长取消 → 「已取消，积分已退回」；用户自核销不通知', async () => {
    const authH = { Authorization: `Bearer ${admin}` };
    const base = (await prizeNotifs(alice.id)).length;

    const r1 = await mkRecord(alice.id, '通知奖品A');
    const use = await SELF.fetch(`http://x/api/admin/prize-records/${r1.rid}/use`, { method: 'POST', headers: authH });
    expect(use.status).toBe(200);

    const r2 = await mkRecord(alice.id, '通知奖品B');
    const cancel = await SELF.fetch(`http://x/api/admin/prize-records/${r2.rid}/cancel`, { method: 'POST', headers: authH });
    expect(cancel.status).toBe(200);

    const r3 = await mkRecord(alice.id, '通知奖品C');
    const selfUse = await SELF.fetch(`http://x/api/my/prizes/${r3.rid}/use`, {
      method: 'POST', headers: { Authorization: `Bearer ${alice.token}` },
    });
    expect(selfUse.status).toBe(200);

    const details = await prizeNotifs(alice.id);
    expect(details.length).toBe(base + 2); // 自核销不产生第三条
    expect(details).toContain('你兑换的「通知奖品A」已被核销');
    expect(details).toContain('你兑换的「通知奖品B」已被取消，积分已退回');

    // 清理（prize_records 有 prizes 外键，先删记录）
    await env.DB.prepare('DELETE FROM prize_records WHERE prize_id IN (?, ?, ?)').bind(r1.pid, r2.pid, r3.pid).run();
    await env.DB.prepare('DELETE FROM prizes WHERE id IN (?, ?, ?)').bind(r1.pid, r2.pid, r3.pid).run();
  });
});
