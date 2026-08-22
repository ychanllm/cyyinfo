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

  it('管理端按 id 获取日记详情（含 content_md 全文）', async () => {
    const content = '## 详情测试\n\n这是一段完整的正文内容，含 **加粗**。';
    const create = await SELF.fetch('http://x/api/admin/diaries', {
      method: 'POST', headers: auth(),
      body: JSON.stringify({ title: '详情测试', content_md: content }),
    });
    expect(create.status).toBe(200);
    const diary = await create.json() as any;

    const detail = await SELF.fetch(`http://x/api/admin/diaries/${diary.id}`, { headers: auth() });
    expect(detail.status).toBe(200);
    const d = await detail.json() as any;
    expect(d.id).toBe(diary.id);
    expect(d.title).toBe('详情测试');
    expect(d.content_md).toBe(content);
    expect(d.status).toBe('draft');

    const missing = await SELF.fetch('http://x/api/admin/diaries/999999', { headers: auth() });
    expect(missing.status).toBe(404);

    // 清理，避免影响其它用例的公开列表断言
    await SELF.fetch(`http://x/api/admin/diaries/${diary.id}`, { method: 'DELETE', headers: auth() });
  });

  it('非数字 page 回退到第 1 页', async () => {
    const bad = await SELF.fetch('http://x/api/diaries?page=abc');
    expect(bad.status).toBe(200);
    const p1 = await SELF.fetch('http://x/api/diaries?page=1');
    expect(p1.status).toBe(200);
    expect(await bad.json()).toEqual(await p1.json());
  });
});

describe('日记正文图片', () => {
  it('上传成功返回 /uploads/diary/ url；非图片 400；未授权 401；不存在 404', async () => {
    const token = await adminToken();
    const authH = { Authorization: `Bearer ${token}` };
    // 建一篇日记
    const create = await SELF.fetch('http://x/api/admin/diaries', {
      method: 'POST',
      headers: { ...authH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '插图测试' }),
    });
    const { id } = await create.json() as any;

    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const form = new FormData();
    form.append('file', new File([png], 'a.png', { type: 'image/png' }));
    const up = await SELF.fetch(`http://x/api/admin/diaries/${id}/images`, { method: 'POST', headers: authH, body: form });
    expect(up.status).toBe(200);
    const { url } = await up.json() as any;
    expect(url).toMatch(/^\/uploads\/diary\/.+\.png$/);

    // 文件可访问
    const img = await SELF.fetch(`http://x${url}`);
    expect(img.status).toBe(200);

    // 非图片
    const bad = new FormData();
    bad.append('file', new File(['hello'], 'a.txt', { type: 'text/plain' }));
    const badRes = await SELF.fetch(`http://x/api/admin/diaries/${id}/images`, { method: 'POST', headers: authH, body: bad });
    expect(badRes.status).toBe(400);

    // 未授权
    const anon = await SELF.fetch(`http://x/api/admin/diaries/${id}/images`, { method: 'POST', body: form });
    expect(anon.status).toBe(401);

    // 日记不存在
    const form2 = new FormData();
    form2.append('file', new File([png], 'b.png', { type: 'image/png' }));
    const missing = await SELF.fetch('http://x/api/admin/diaries/999999/images', { method: 'POST', headers: authH, body: form2 });
    expect(missing.status).toBe(404);
  });
});
