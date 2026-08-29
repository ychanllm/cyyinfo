import { SELF, env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { applyMigrations, adminToken } from './helpers';

let authH: Record<string, string>;
let diaryId: number;
const keys: string[] = [];

beforeAll(async () => {
  await applyMigrations();
  authH = { Authorization: `Bearer ${await adminToken()}` };
  const create = await SELF.fetch('http://x/api/admin/diaries', {
    method: 'POST',
    headers: { ...authH, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '上传类型测试' }),
  });
  diaryId = ((await create.json()) as any).id;
});

const upload = (file: File) => {
  const form = new FormData();
  form.append('file', file);
  return SELF.fetch(`http://x/api/admin/diaries/${diaryId}/images`, {
    method: 'POST', headers: authH, body: form,
  });
};

describe('移动端图片类型', () => {
  it('image/heic 通过，url 以 .heic 结尾', async () => {
    const res = await upload(new File([new Uint8Array([0, 0, 0, 24])], 'IMG_1.heic', { type: 'image/heic' }));
    expect(res.status).toBe(200);
    const { url } = (await res.json()) as any;
    expect(url).toMatch(/^\/uploads\/diary\/.+\.heic$/);
    keys.push(url.replace('/uploads/', ''));
  });

  it('空 MIME + .jpg 扩展名按文件名回退通过', async () => {
    const res = await upload(new File([new Uint8Array([0xff, 0xd8])], 'photo.jpg', { type: '' }));
    expect(res.status).toBe(200);
    const { url } = (await res.json()) as any;
    expect(url).toMatch(/\.jpg$/);
    keys.push(url.replace('/uploads/', ''));
  });

  it('空 MIME + 非法扩展名仍 400', async () => {
    const res = await upload(new File(['hello'], 'notes.txt', { type: '' }));
    expect(res.status).toBe(400);
  });

  it('清理上传文件', async () => {
    for (const k of keys) await env.UPLOADS.delete(k);
  });
});
