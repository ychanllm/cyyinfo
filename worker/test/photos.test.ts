import { SELF, env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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

  it('隐藏照片：前台列表/封面不显示，后台可见，恢复后重现，R2 文件保留', async () => {
    const create = await SELF.fetch('http://x/api/admin/albums', {
      method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '隐藏测试' }),
    });
    const album = await create.json() as any;
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
    const uploadPhoto = async (caption: string) => {
      const form = new FormData();
      form.append('file', new File([jpeg], 'a.jpg', { type: 'image/jpeg' }));
      form.append('album_id', String(album.id));
      form.append('caption', caption);
      return (await (await SELF.fetch('http://x/api/admin/photos', { method: 'POST', headers: auth(), body: form })).json()) as any;
    };
    const p1 = await uploadPhoto('要隐藏的');
    const p2 = await uploadPhoto('正常的');

    // 把 p1 设为封面
    await SELF.fetch(`http://x/api/admin/albums/${album.id}/cover`, {
      method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ photo_id: p1.id }),
    });

    // 隐藏 p1
    const hide = await SELF.fetch(`http://x/api/admin/photos/${p1.id}`, {
      method: 'PUT', headers: { ...auth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ hidden: true }),
    });
    expect(hide.status).toBe(200);

    // 前台：照片列表只剩 p2；封面因 p1 隐藏而为空
    const detail = await (await SELF.fetch(`http://x/api/albums/${album.id}`)).json() as any;
    expect(detail.photos.map((p: any) => p.id)).toEqual([p2.id]);
    expect(detail.cover_filename).toBeNull();

    // 后台：两张都在，p1 带 hidden 标记
    const adminDetail = await (await SELF.fetch(`http://x/api/admin/albums/${album.id}`, { headers: auth() })).json() as any;
    expect(adminDetail.photos).toHaveLength(2);
    expect(adminDetail.photos.find((p: any) => p.id === p1.id).hidden).toBe(1);
    expect(adminDetail.photos.find((p: any) => p.id === p2.id).hidden).toBe(0);

    // R2 文件未删
    expect((await SELF.fetch(`http://x/uploads/${p1.filename}`)).status).toBe(200);

    // 恢复后前台重新可见
    await SELF.fetch(`http://x/api/admin/photos/${p1.id}`, {
      method: 'PUT', headers: { ...auth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ hidden: false }),
    });
    const restored = await (await SELF.fetch(`http://x/api/albums/${album.id}`)).json() as any;
    expect(restored.photos).toHaveLength(2);
    expect(restored.cover_filename).toBe(p1.filename);
  });
});

describe('admin 相册列表分页与搜索', () => {
  const albumIds: number[] = [];
  const adminHeaders = async () => ({ Authorization: `Bearer ${await adminToken()}` });

  beforeAll(async () => {
    for (let i = 1; i <= 25; i++) {
      const r = await env.DB.prepare('INSERT INTO albums (title, title_en, sort_order) VALUES (?, ?, ?)')
        .bind(`分页测相册${String(i).padStart(2, '0')}`, `PageTest Album ${i}`, 1000 + i).run();
      albumIds.push(Number(r.meta.last_row_id));
    }
  });

  afterAll(async () => {
    await env.DB.prepare(`DELETE FROM albums WHERE id IN (${albumIds.join(',')})`).run();
  });

  it('不带参数时保持旧的数组返回(兼容)', async () => {
    const res = await SELF.fetch('http://x/api/admin/albums', { headers: await adminHeaders() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown;
    expect(Array.isArray(body)).toBe(true);
  });

  it('带 page/size 返回 {items,total,page,size},q 过滤', async () => {
    const res = await SELF.fetch('http://x/api/admin/albums?page=2&size=10&q=%E5%88%86%E9%A1%B5%E6%B5%8B%E7%9B%B8%E5%86%8C', { headers: await adminHeaders() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.total).toBe(25);
    expect(body.page).toBe(2);
    expect(body.size).toBe(10);
    expect(body.items).toHaveLength(10);
    expect(body.items[0].title).toBe('分页测相册11');
    expect(body.items.every((a: any) => a.title.startsWith('分页测相册'))).toBe(true);
  });

  it('q 匹配 title_en;特殊字符 % 被转义不匹配', async () => {
    const en = await SELF.fetch('http://x/api/admin/albums?q=PageTest%20Album%207', { headers: await adminHeaders() });
    // 只带 q 不带分页参数 → 仍是数组
    const enBody = (await en.json()) as any[];
    expect(Array.isArray(enBody)).toBe(true);
    expect(enBody).toHaveLength(1);
    expect(enBody[0].title).toBe('分页测相册07');

    const pct = await SELF.fetch('http://x/api/admin/albums?page=1&q=%25', { headers: await adminHeaders() });
    const pctBody = (await pct.json()) as any;
    expect(pctBody.total).toBe(0);
    expect(pctBody.items).toHaveLength(0);
  });
});

describe('admin 相册内照片分页与搜索', () => {
  let albumId = 0;
  const photoIds: number[] = [];
  const adminHeaders = async () => ({ Authorization: `Bearer ${await adminToken()}` });

  beforeAll(async () => {
    const a = await env.DB.prepare("INSERT INTO albums (title, sort_order) VALUES ('分页测照片册', 2000)").run();
    albumId = Number(a.meta.last_row_id);
    for (let i = 1; i <= 15; i++) {
      const r = await env.DB.prepare("INSERT INTO photos (album_id, filename, caption, sort_order) VALUES (?, ?, ?, ?)")
        .bind(albumId, `pgt/${i}.jpg`, `分页测照片${String(i).padStart(2, '0')}`, i).run();
      photoIds.push(Number(r.meta.last_row_id));
    }
    const other = await env.DB.prepare("INSERT INTO photos (album_id, filename, caption, sort_order) VALUES (?, 'pgt/x.jpg', '无关照片', 100)")
      .bind(albumId).run();
    photoIds.push(Number(other.meta.last_row_id));
  });

  afterAll(async () => {
    await env.DB.prepare(`DELETE FROM albums WHERE id = ${albumId}`).run(); // photos 随 CASCADE 删除
  });

  it('不带参数 photos 仍是数组(兼容)', async () => {
    const res = await SELF.fetch(`http://x/api/admin/albums/${albumId}`, { headers: await adminHeaders() });
    const body = (await res.json()) as any;
    expect(Array.isArray(body.photos)).toBe(true);
    expect(body.photos).toHaveLength(16);
  });

  it('带 page/size/q 时 photos 是分页对象', async () => {
    const res = await SELF.fetch(`http://x/api/admin/albums/${albumId}?page=2&size=10&q=${encodeURIComponent('分页测照片')}`, { headers: await adminHeaders() });
    const body = (await res.json()) as any;
    expect(body.title).toBe('分页测照片册');
    expect(body.photos.total).toBe(15);
    expect(body.photos.page).toBe(2);
    expect(body.photos.items).toHaveLength(5);
    expect(body.photos.items[0].caption).toBe('分页测照片11');
  });
});
