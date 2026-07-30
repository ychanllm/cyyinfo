import { SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { applyMigrations, adminToken } from './helpers';

let token: string;
beforeAll(async () => { await applyMigrations(); token = await adminToken(); });
const auth = () => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

describe('日记', () => {
  it('草稿不出现在公开列表，发布后可按 slug 阅读', async () => {
    const create = await SELF.fetch('http://x/api/admin/diaries', {
      method: 'POST', headers: auth(),
      body: JSON.stringify({ title: '第一篇', content_md: '# 你好\n\n正文内容', slug: 'first' }),
    });
    expect(create.status).toBe(200);
    const diary = await create.json() as any;

    let list = await (await SELF.fetch('http://x/api/diaries')).json() as any;
    expect(list.items).toHaveLength(0); // 草稿

    const pub = await SELF.fetch(`http://x/api/admin/diaries/${diary.id}`, {
      method: 'PUT', headers: auth(), body: JSON.stringify({ status: 'published' }),
    });
    expect(pub.status).toBe(200);

    list = await (await SELF.fetch('http://x/api/diaries')).json() as any;
    expect(list.items).toHaveLength(1);
    expect(list.items[0].excerpt).toBeTruthy();
    expect(list.items[0].content_md).toBeUndefined();

    const read = await SELF.fetch('http://x/api/diaries/first');
    expect(read.status).toBe(200);
    expect((await read.json() as any).content_md).toContain('正文内容');

    const byId = await SELF.fetch(`http://x/api/diaries/${diary.id}`);
    expect(byId.status).toBe(200);

    // 撤回为 draft 再发布，published_at 应保持首次发布的值
    const firstRead = await SELF.fetch('http://x/api/diaries/first');
    const firstPublishedAt = (await firstRead.json() as any).published_at;
    expect(firstPublishedAt).toBeTruthy();

    await SELF.fetch(`http://x/api/admin/diaries/${diary.id}`, {
      method: 'PUT', headers: auth(), body: JSON.stringify({ status: 'draft' }),
    });
    const repub = await SELF.fetch(`http://x/api/admin/diaries/${diary.id}`, {
      method: 'PUT', headers: auth(), body: JSON.stringify({ status: 'published' }),
    });
    expect(repub.status).toBe(200);

    const secondRead = await SELF.fetch('http://x/api/diaries/first');
    expect((await secondRead.json() as any).published_at).toBe(firstPublishedAt);
  });

  it('非数字 page 回退到第 1 页', async () => {
    const bad = await SELF.fetch('http://x/api/diaries?page=abc');
    expect(bad.status).toBe(200);
    const p1 = await SELF.fetch('http://x/api/diaries?page=1');
    expect(p1.status).toBe(200);
    expect(await bad.json()).toEqual(await p1.json());
  });
});
