import { SELF, env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { applyMigrations, adminToken } from './helpers';

const adminAuth = async () => ({
  Authorization: `Bearer ${await adminToken()}`,
});

async function upload(name: string, bytes: number | Uint8Array, type = 'application/octet-stream', auth = true) {
  const data = typeof bytes === 'number' ? new Uint8Array(bytes) : bytes;
  const form = new FormData();
  form.append('file', new File([data], name, { type }));
  return SELF.fetch('http://x/api/admin/files', {
    method: 'POST',
    headers: auth ? { Authorization: `Bearer ${await adminToken()}` } : {},
    body: form,
  });
}

beforeAll(async () => {
  await applyMigrations();
  await env.DB.prepare('DELETE FROM files').run();
});

// 测试共享同一 D1/R2（isolatedStorage 关闭）：结束后清理本文件产生的数据
afterAll(async () => {
  const { results } = await env.DB.prepare('SELECT filename FROM files').all<{ filename: string }>();
  for (const row of results) await env.FILES.delete(row.filename);
  await env.DB.prepare('DELETE FROM files').run();
});

describe('文件上传', () => {
  it('未授权 401', async () => {
    const res = await upload('a.txt', new Uint8Array([1]), 'text/plain', false);
    expect(res.status).toBe(401);
  });

  it('上传成功：R2 与 D1 均写入，记录审计', async () => {
    const res = await upload('报告 2026.pdf', new Uint8Array([1, 2, 3]), 'application/pdf');
    expect(res.status).toBe(200);
    const { id, filename } = (await res.json()) as any;
    expect(filename).toMatch(/^files\/.+\.pdf$/);
    expect(await env.FILES.get(filename)).not.toBeNull();
    const row = await env.DB.prepare('SELECT * FROM files WHERE id = ?').bind(id)
      .first<{ display_name: string; size: number; content_type: string }>();
    expect(row).toMatchObject({ display_name: '报告 2026.pdf', size: 3, content_type: 'application/pdf' });
    const audit = await env.DB.prepare("SELECT 1 AS ok FROM audit_logs WHERE type = 'file_upload'").first();
    expect(audit).not.toBeNull();
  });

  it('无扩展名文件可上传', async () => {
    const res = await upload('LICENSE', new Uint8Array([9]), 'text/plain');
    expect(res.status).toBe(200);
    const { filename } = (await res.json()) as any;
    expect(filename).toMatch(/^files\/.+$/);
  });

  it('缺少 file 字段 400', async () => {
    const form = new FormData();
    const res = await SELF.fetch('http://x/api/admin/files', {
      method: 'POST',
      headers: await adminAuth(),
      body: form,
    });
    expect(res.status).toBe(400);
  });

  it('超过 100MB 拒绝', async () => {
    const res = await upload('big.bin', 100 * 1024 * 1024 + 1);
    expect(res.status).toBe(400);
    const { detail } = (await res.json()) as any;
    expect(detail).toContain('100MB');
  }, 60000);
});

describe('文件列表', () => {
  it('未授权 401', async () => {
    expect((await SELF.fetch('http://x/api/admin/files')).status).toBe(401);
  });

  it('分页与搜索', async () => {
    // 前面用例残留了文件记录，先清表再测（R2 残留对象由 afterAll 按表清理之外的少量孤儿对象不影响断言）
    await env.DB.prepare('DELETE FROM files').run();
    for (const name of ['合同A.docx', '合同B.docx', '照片.zip']) await upload(name, new Uint8Array([1]));

    const page1 = await SELF.fetch('http://x/api/admin/files?page=1&size=2', { headers: await adminAuth() });
    const data1 = (await page1.json()) as any;
    expect(data1.items.length).toBe(2);
    expect(data1.total).toBe(3);
    // id DESC：最后上传的排在最前
    expect(data1.items[0].display_name).toBe('照片.zip');

    const searched = await SELF.fetch('http://x/api/admin/files?q=' + encodeURIComponent('合同'), { headers: await adminAuth() });
    const data2 = (await searched.json()) as any;
    expect(data2.total).toBe(2);

    const miss = await SELF.fetch('http://x/api/admin/files?q=' + encodeURIComponent('不存在'), { headers: await adminAuth() });
    expect(((await miss.json()) as any).total).toBe(0);
  });
});

describe('文件下载', () => {
  it('未授权 401', async () => {
    expect((await SELF.fetch('http://x/api/admin/files/1/download')).status).toBe(401);
  });

  it('下载成功：字节一致，Content-Disposition 带显示名', async () => {
    const bytes = new Uint8Array([10, 20, 30, 40]);
    const create = await upload('数据 备份.tar.gz', bytes);
    const { id } = (await create.json()) as any;

    const res = await SELF.fetch(`http://x/api/admin/files/${id}/download`, { headers: await adminAuth() });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition'))
      .toBe(`attachment; filename*=UTF-8''${encodeURIComponent('数据 备份.tar.gz')}`);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  });

  it('不存在的 id 404', async () => {
    const res = await SELF.fetch('http://x/api/admin/files/999999/download', { headers: await adminAuth() });
    expect(res.status).toBe(404);
  });
});

describe('文件编辑与删除', () => {
  it('重命名与备注', async () => {
    const create = await upload('旧名字.txt', new Uint8Array([1]), 'text/plain');
    const { id } = (await create.json()) as any;

    const res = await SELF.fetch(`http://x/api/admin/files/${id}`, {
      method: 'PUT',
      headers: { ...await adminAuth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: '新名字.txt', note: '给老板的版本' }),
    });
    expect(res.status).toBe(200);
    const row = await env.DB.prepare('SELECT display_name, note FROM files WHERE id = ?').bind(id)
      .first<{ display_name: string; note: string }>();
    expect(row).toMatchObject({ display_name: '新名字.txt', note: '给老板的版本' });
  });

  it('空文件名 / 空 body / 不存在的 id 拒绝', async () => {
    const create = await upload('x.txt', new Uint8Array([1]), 'text/plain');
    const { id } = (await create.json()) as any;
    const put = async (target: number, body: unknown) => SELF.fetch(`http://x/api/admin/files/${target}`, {
      method: 'PUT',
      headers: { ...await adminAuth(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect((await put(id, { display_name: '  ' })).status).toBe(400);
    expect((await put(id, {})).status).toBe(400);
    expect((await put(999999, { note: 'x' })).status).toBe(404);
  });

  it('删除：D1 记录与 R2 对象都清除', async () => {
    const create = await upload('待删除.zip', new Uint8Array([5, 6]));
    const { id, filename } = (await create.json()) as any;
    expect(await env.FILES.get(filename)).not.toBeNull();

    const res = await SELF.fetch(`http://x/api/admin/files/${id}`, {
      method: 'DELETE',
      headers: await adminAuth(),
    });
    expect(res.status).toBe(200);
    expect(await env.DB.prepare('SELECT id FROM files WHERE id = ?').bind(id).first()).toBeNull();
    expect(await env.FILES.get(filename)).toBeNull();

    const missing = await SELF.fetch('http://x/api/admin/files/999999', {
      method: 'DELETE',
      headers: await adminAuth(),
    });
    expect(missing.status).toBe(404);
  });
});
