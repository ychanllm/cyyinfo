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
});
