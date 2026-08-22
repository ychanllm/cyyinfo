import { SELF, env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { applyMigrations, adminToken, registerUser } from './helpers';

let token: string;
let alice: { id: number; token: string };
// 每个测试用独立 IP，避免共享留言限流桶（10 条/小时/IP，且 400 也计数）
let ipSeq = 0;
const nextIp = () => `10.11.${++ipSeq}.1`;

beforeAll(async () => {
  await applyMigrations();
  token = await adminToken();
  alice = await registerUser('reply_alice');
});

const postMsg = (body: Record<string, unknown>, ip = nextIp()) =>
  SELF.fetch('http://x/api/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify(body),
  });

const getMsgs = (query: string) =>
  SELF.fetch(`http://x/api/messages?${query}`).then((r) => r.json() as Promise<any[]>);

describe('评论回复', () => {
  it('parent 不存在返回 400', async () => {
    const res = await postMsg({
      nickname: '小回', content: '回复幽灵', target_type: 'diary', target_id: 9101, parent_id: 999999,
    });
    expect(res.status).toBe(400);
  });

  it('跨 target 的回复返回 400', async () => {
    const post = await postMsg({ nickname: '小回', content: '顶级评论', target_type: 'diary', target_id: 9101 });
    expect(post.status).toBe(201);
    const list = await getMsgs('target_type=diary&target_id=9101');
    const parent = list.find((m) => m.content === '顶级评论');

    // target_type 不一致
    let res = await postMsg({
      nickname: '小回', content: '跨类型', target_type: 'site', parent_id: parent.id,
    });
    expect(res.status).toBe(400);
    // target_id 不一致
    res = await postMsg({
      nickname: '小回', content: '跨日记', target_type: 'diary', target_id: 9102, parent_id: parent.id,
    });
    expect(res.status).toBe(400);
  });

  it('diary 回复免审核，回复的回复挂到顶级（一层楼中楼）', async () => {
    await postMsg({ nickname: 'A', content: '楼中楼-顶级', target_type: 'diary', target_id: 9103 });
    let list = await getMsgs('target_type=diary&target_id=9103');
    const top = list.find((m) => m.content === '楼中楼-顶级');
    expect(top.parent_id).toBeNull();

    // 一级回复：201 免审核立即可见
    const r1 = await postMsg({ nickname: 'B', content: '楼中楼-一级回复', target_type: 'diary', target_id: 9103, parent_id: top.id });
    expect(r1.status).toBe(201);

    list = await getMsgs('target_type=diary&target_id=9103');
    const reply1 = list.find((m) => m.content === '楼中楼-一级回复');
    expect(reply1.parent_id).toBe(top.id);

    // 回复的回复：挂到顶级而非一级回复
    const r2 = await postMsg({ nickname: 'C', content: '楼中楼-二级回复', target_type: 'diary', target_id: 9103, parent_id: reply1.id });
    expect(r2.status).toBe(201);

    list = await getMsgs('target_type=diary&target_id=9103');
    const reply2 = list.find((m) => m.content === '楼中楼-二级回复');
    expect(reply2.parent_id).toBe(top.id);
  });

  it('划线评论的回复挂到该评论且自身不带 quote_text', async () => {
    await postMsg({
      nickname: 'A', content: '划线-顶级', target_type: 'diary', target_id: 9104, quote_text: '被划线的话',
    });
    let list = await getMsgs('target_type=diary&target_id=9104');
    const quoteTop = list.find((m) => m.content === '划线-顶级');
    expect(quoteTop.quote_text).toBe('被划线的话');

    const res = await postMsg({
      nickname: 'B', content: '划线-回复', target_type: 'diary', target_id: 9104,
      parent_id: quoteTop.id, quote_text: '不应被存',
    });
    expect(res.status).toBe(201);

    list = await getMsgs('target_type=diary&target_id=9104');
    const reply = list.find((m) => m.content === '划线-回复');
    expect(reply.parent_id).toBe(quoteTop.id);
    expect(reply.quote_text).toBeNull();
  });

  it('site 回复待审核，审核后可见', async () => {
    const res = await postMsg({ nickname: '小站', content: '站点回复', target_type: 'site', parent_id: null });
    expect(res.status).toBe(202);

    // site 顶级评论需先审核，再对其回复
    const authH = { Authorization: `Bearer ${token}` };
    let pending = await (await SELF.fetch('http://x/api/admin/messages?pending=1', { headers: authH })).json() as any[];
    const siteTop = pending.find((m) => m.content === '站点回复');
    await SELF.fetch(`http://x/api/admin/messages/${siteTop.id}/approve`, { method: 'POST', headers: authH });

    const reply = await postMsg({ nickname: '小站', content: '站点回复-回复', target_type: 'site', parent_id: siteTop.id });
    expect(reply.status).toBe(202);

    // 未审核前不可见
    let list = await getMsgs('target_type=site');
    expect(list.find((m) => m.content === '站点回复-回复')).toBeUndefined();

    pending = await (await SELF.fetch('http://x/api/admin/messages?pending=1', { headers: authH })).json() as any[];
    const siteReply = pending.find((m) => m.content === '站点回复-回复');
    expect(siteReply.parent_id).toBe(siteTop.id);
    await SELF.fetch(`http://x/api/admin/messages/${siteReply.id}/approve`, { method: 'POST', headers: authH });

    list = await getMsgs('target_type=site');
    const visible = list.find((m) => m.content === '站点回复-回复');
    expect(visible.parent_id).toBe(siteTop.id);

    // 清理：共享存储下已审核的 site 留言会影响 messages.test 的断言
    await SELF.fetch(`http://x/api/admin/messages/${siteReply.id}`, { method: 'DELETE', headers: authH });
    await SELF.fetch(`http://x/api/admin/messages/${siteTop.id}`, { method: 'DELETE', headers: authH });
  });
});

describe('评论点赞', () => {
  const auth = { Authorization: '', 'Content-Type': 'application/json' };

  it("target_type='message' 可点赞，旧类型仍可用", async () => {
    auth.Authorization = `Bearer ${alice.token}`;
    let res = await SELF.fetch('http://x/api/likes/toggle', {
      method: 'POST', headers: auth, body: JSON.stringify({ target_type: 'message', target_id: 9201 }),
    });
    expect(res.status).toBe(200);
    expect(await res.json() as any).toEqual({ liked: true, count: 1 });

    const batch = await SELF.fetch('http://x/api/likes/batch?target_type=message&ids=9201,9202', { headers: auth });
    expect(await batch.json() as any).toEqual({
      '9201': { count: 1, liked: true },
      '9202': { count: 0, liked: false },
    });

    // 旧类型不受影响
    res = await SELF.fetch('http://x/api/likes/toggle', {
      method: 'POST', headers: auth, body: JSON.stringify({ target_type: 'diary', target_id: 9203 }),
    });
    expect(res.status).toBe(200);

    // 清理
    await SELF.fetch('http://x/api/likes/toggle', {
      method: 'POST', headers: auth, body: JSON.stringify({ target_type: 'message', target_id: 9201 }),
    });
    await SELF.fetch('http://x/api/likes/toggle', {
      method: 'POST', headers: auth, body: JSON.stringify({ target_type: 'diary', target_id: 9203 }),
    });
  });

  it('迁移重建后 CHECK 约束仍拒绝非法 target_type', async () => {
    await expect(
      env.DB.prepare('INSERT INTO likes (user_id, target_type, target_id) VALUES (?, ?, ?)')
        .bind(alice.id, 'song', 9204).run()
    ).rejects.toThrow();
    // message 在新约束内，可直接插入
    await env.DB.prepare('INSERT INTO likes (user_id, target_type, target_id) VALUES (?, ?, ?)')
      .bind(alice.id, 'message', 9205).run();
    await env.DB.prepare('DELETE FROM likes WHERE target_type = ? AND target_id = ?').bind('message', 9205).run();
  });
});
