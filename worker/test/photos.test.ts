import { SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { applyMigrations, adminToken } from './helpers';

let token: string;
beforeAll(async () => { await applyMigrations(); token = await adminToken(); });

const auth = () => ({ Authorization: `Bearer ${token}` });

describe('相册与照片', () => {
  it('创建相册 → 上传照片 → 公开读取 → /uploads 读图', async () => {
    // 无 token 创建应 401
    expect((await SELF.fetch('http://x/api/admin/albums', { method: 'POST' })).status).toBe(401);

    const create = await SELF.fetch('http://x/api/admin/albums', {
      method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '旅行', description: '2026' }),
    });
    expect(create.status).toBe(200);
    const album = await create.json() as any;
    expect(album.id).toBeTruthy();

    // 上传照片（构造一个最小合法 JPEG 字节）
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
    const form = new FormData();
    form.append('file', new File([jpeg], 'a.jpg', { type: 'image/jpeg' }));
    form.append('album_id', String(album.id));
    form.append('caption', '海边');
    const up = await SELF.fetch('http://x/api/admin/photos', { method: 'POST', headers: auth(), body: form });
    expect(up.status).toBe(200);
    const photo = await up.json() as any;
    expect(photo.filename).toMatch(/^photos\//);

    // 公开接口读到
    const detail = await SELF.fetch(`http://x/api/albums/${album.id}`);
    expect(detail.status).toBe(200);
    const d = await detail.json() as any;
    expect(d.photos).toHaveLength(1);
    expect(d.photos[0].caption).toBe('海边');

    // /uploads 可读
    const img = await SELF.fetch(`http://x/uploads/${photo.filename}`);
    expect(img.status).toBe(200);
    expect(img.headers.get('Cache-Control')).toContain('max-age');
  });

  it('拒绝非图片类型', async () => {
    const form = new FormData();
    form.append('file', new File([new Uint8Array([1, 2, 3])], 'x.exe', { type: 'application/octet-stream' }));
    form.append('album_id', '1');
    const res = await SELF.fetch('http://x/api/admin/photos', { method: 'POST', headers: auth(), body: form });
    expect(res.status).toBe(400);
  });
});
