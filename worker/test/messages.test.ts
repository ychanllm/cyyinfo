import { SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { applyMigrations, adminToken } from './helpers';

let token: string;
beforeAll(async () => { await applyMigrations(); token = await adminToken(); });

describe('留言', () => {
  it('提交后待审核不可见，审核后可见', async () => {
    const post = await SELF.fetch('http://x/api/messages', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: '小明', content: '祝幸福！', target_type: 'site' }),
    });
    expect(post.status).toBe(202);

    let list = await (await SELF.fetch('http://x/api/messages?target_type=site')).json() as any[];
    expect(list).toHaveLength(0);

    const pending = await (await SELF.fetch('http://x/api/admin/messages?pending=1', {
      headers: { Authorization: `Bearer ${token}` },
    })).json() as any[];
    expect(pending).toHaveLength(1);

    const approve = await SELF.fetch(`http://x/api/admin/messages/${pending[0].id}/approve`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` },
    });
    expect(approve.status).toBe(200);

    list = await (await SELF.fetch('http://x/api/messages?target_type=site')).json() as any[];
    expect(list).toHaveLength(1);
    expect(list[0].content).toBe('祝幸福！');
  });

  it('超长内容被拒绝', async () => {
    const res = await SELF.fetch('http://x/api/messages', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: 'x', content: 'a'.repeat(501), target_type: 'site' }),
    });
    expect(res.status).toBe(400);
  });

  it('划线评论：diary 评论免审核，提交后立即可见', async () => {
    const post = await SELF.fetch('http://x/api/messages', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nickname: '小红', content: '这句写得真好', target_type: 'diary', target_id: 1,
        quote_text: '今天天气很好',
      }),
    });
    expect(post.status).toBe(201);

    // 无需审核，GET 立即可见
    const list = await (await SELF.fetch('http://x/api/messages?target_type=diary&target_id=1')).json() as any[];
    expect(list).toHaveLength(1);
    expect(list[0].quote_text).toBe('今天天气很好');

    // 日记评论不会泄漏到全站留言板（target_type 隔离）
    const siteList = await (await SELF.fetch('http://x/api/messages?target_type=site')).json() as any[];
    expect(siteList.find((m) => m.content === '这句写得真好')).toBeUndefined();
  });

  it('管理员隐藏 diary 评论后 GET 不可见', async () => {
    const post = await SELF.fetch('http://x/api/messages', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: '小蓝', content: '待隐藏的评论', target_type: 'diary', target_id: 2 }),
    });
    expect(post.status).toBe(201);

    let list = await (await SELF.fetch('http://x/api/messages?target_type=diary&target_id=2')).json() as any[];
    expect(list).toHaveLength(1);
    const msgId = list[0].id;

    const hide = await SELF.fetch(`http://x/api/admin/messages/${msgId}/hide`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` },
    });
    expect(hide.status).toBe(200);

    list = await (await SELF.fetch('http://x/api/messages?target_type=diary&target_id=2')).json() as any[];
    expect(list).toHaveLength(0);

    // 隐藏后可通过 approve 恢复可见
    const approve = await SELF.fetch(`http://x/api/admin/messages/${msgId}/approve`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` },
    });
    expect(approve.status).toBe(200);
    list = await (await SELF.fetch('http://x/api/messages?target_type=diary&target_id=2')).json() as any[];
    expect(list).toHaveLength(1);
  });

  it('quote_text 超长被拒绝', async () => {
    const res = await SELF.fetch('http://x/api/messages', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nickname: 'x', content: 'ok', target_type: 'diary', target_id: 1,
        quote_text: 'a'.repeat(501),
      }),
    });
    expect(res.status).toBe(400);
  });

  it('管理端可按 target_type/target_id 过滤评论', async () => {
    await SELF.fetch('http://x/api/messages', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: '小绿', content: '日记3的评论', target_type: 'diary', target_id: 3 }),
    });
    await SELF.fetch('http://x/api/messages', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: '小绿', content: '日记3的划线', target_type: 'diary', target_id: 3, quote_text: '某句话' }),
    });

    const headers = { Authorization: `Bearer ${token}` };
    const list = await (await SELF.fetch('http://x/api/admin/messages?target_type=diary&target_id=3', { headers })).json() as any[];
    expect(list).toHaveLength(2);
    expect(list.every((m) => m.target_type === 'diary' && m.target_id === 3)).toBe(true);

    // 其他日记的评论不受影响
    const other = await (await SELF.fetch('http://x/api/admin/messages?target_type=diary&target_id=999', { headers })).json() as any[];
    expect(other).toHaveLength(0);

    // 无过滤参数时行为不变（仍能拿到全量列表）
    const all = await (await SELF.fetch('http://x/api/admin/messages', { headers })).json() as any[];
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  it('非 diary 类型的 quote_text 被忽略（存 NULL）', async () => {
    const post = await SELF.fetch('http://x/api/messages', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nickname: '小刚', content: '路过', target_type: 'photo', target_id: 1,
        quote_text: '这句话不该被存',
      }),
    });
    expect(post.status).toBe(202);

    const pending = await (await SELF.fetch('http://x/api/admin/messages?pending=1', {
      headers: { Authorization: `Bearer ${token}` },
    })).json() as any[];
    const mine = pending.find((m) => m.content === '路过');
    expect(mine.quote_text).toBeNull();
  });
});
