import { SELF, env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SignJWT } from 'jose';
import { applyMigrations, adminToken } from './helpers';

let alice: { id: number; token: string };

// 注册接口限流 30 次/60 秒（全测试文件共享）：不挤占注册配额，
// 测试用户直接插库 + 手工签 JWT（沿用 dishes.test.ts 的做法）
async function makeUserDirect(username: string): Promise<{ id: number; token: string }> {
  const r = await env.DB.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
    .bind(username, 'x').run();
  const id = Number(r.meta.last_row_id);
  const token = await new SignJWT({ sub: id, username, role: 'user' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(env.JWT_SECRET));
  return { id, token };
}

const userAuth = (u: { token: string }) => ({
  Authorization: `Bearer ${u.token}`,
  'Content-Type': 'application/json',
});
const adminAuth = async () => ({
  Authorization: `Bearer ${await adminToken()}`,
  'Content-Type': 'application/json',
});

const createStore = (u: { token: string }, payload: Record<string, unknown>) =>
  SELF.fetch('http://x/api/stores', {
    method: 'POST',
    headers: userAuth(u),
    body: JSON.stringify(payload),
  });

// 测试共享同一 D1：清空本文件数据，避免外键挡住其他测试的 DELETE FROM users
afterAll(async () => {
  await env.DB.prepare('DELETE FROM store_dishes').run();
  await env.DB.prepare('DELETE FROM stores').run();
});

describe('探店门店投稿', () => {
  beforeAll(async () => {
    await applyMigrations();
    alice = await makeUserDirect('stores_alice');
    await env.DB.prepare('DELETE FROM store_dishes').run();
    await env.DB.prepare('DELETE FROM stores').run();
  });

  it('未登录投稿 401', async () => {
    const res = await SELF.fetch('http://x/api/stores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '老王面馆' }),
    });
    expect(res.status).toBe(401);
  });

  it('空店名 / 超长字段 / 超量菜品 / 空菜名拒绝', async () => {
    expect((await createStore(alice, { name: '' })).status).toBe(400);
    expect((await createStore(alice, { name: '  ' })).status).toBe(400);
    expect((await createStore(alice, { name: 'x'.repeat(51) })).status).toBe(400);
    expect((await createStore(alice, { name: '店', address: 'x'.repeat(101) })).status).toBe(400);
    const many = Array.from({ length: 31 }, (_, i) => ({ name: `菜${i}` }));
    expect((await createStore(alice, { name: '店', dishes: many })).status).toBe(400);
    expect((await createStore(alice, { name: '店', dishes: [{ name: '' }] })).status).toBe(400);
  });

  it('JSON 投稿成功并出现在公开列表（带菜品）', async () => {
    const res = await createStore(alice, {
      name: '老王面馆',
      address: '幸福路 8 号',
      note: '手擀面一绝',
      dishes: [{ name: '牛肉面', note: '招牌' }, { name: '酸梅汤' }],
    });
    expect(res.status).toBe(200);
    const { id } = (await res.json()) as any;

    const list = await SELF.fetch('http://x/api/stores');
    const items = (await list.json()) as any[];
    const store = items.find((s) => s.id === id);
    expect(store).toMatchObject({ name: '老王面馆', address: '幸福路 8 号', note: '手擀面一绝' });
    expect(store.dishes.map((d: any) => d.name)).toEqual(['牛肉面', '酸梅汤']);
    expect(store.dishes[0]).toMatchObject({ name: '牛肉面', note: '招牌' });
  });

  it('multipart 投稿（带封面图）成功', async () => {
    const form = new FormData();
    form.append('name', '川味小馆');
    form.append('address', '中山路 12 号');
    form.append('dishes', JSON.stringify([{ name: '酸菜鱼' }]));
    form.append('image', new File([new Uint8Array([1, 2, 3])], 'store.png', { type: 'image/png' }));
    const res = await SELF.fetch('http://x/api/stores', {
      method: 'POST',
      headers: { Authorization: `Bearer ${alice.token}` },
      body: form,
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.image).toMatch(/^stores\/.+\.png$/);
    // 清理 R2 与记录
    await env.DB.prepare('DELETE FROM stores WHERE id = ?').bind(data.id).run();
    await env.UPLOADS.delete(data.image);
  });
});

describe('管理端门店管理', () => {
  it('未授权访问 401', async () => {
    expect((await SELF.fetch('http://x/api/admin/stores')).status).toBe(401);
  });

  it('管理员新建 + 列表含投稿人 + 店内菜品', async () => {
    const create = await SELF.fetch('http://x/api/admin/stores', {
      method: 'POST',
      headers: await adminAuth(),
      body: JSON.stringify({ name: '深夜食堂', dishes: [{ name: '蛋炒饭' }] }),
    });
    expect(create.status).toBe(200);
    const { id } = (await create.json()) as any;

    const list = await SELF.fetch('http://x/api/admin/stores', { headers: await adminAuth() });
    const store = ((await list.json()) as any[]).find((s) => s.id === id);
    expect(store).toMatchObject({
      name: '深夜食堂',
      created_by_user_id: null,
      created_by_username: null,
      is_active: 1,
    });
    expect(store.dishes.map((d: any) => d.name)).toEqual(['蛋炒饭']);
  });

  it('下架后公开列表不可见，恢复后可见', async () => {
    const create = await SELF.fetch('http://x/api/admin/stores', {
      method: 'POST',
      headers: await adminAuth(),
      body: JSON.stringify({ name: '临时摊位' }),
    });
    const { id } = (await create.json()) as any;

    const off = await SELF.fetch(`http://x/api/admin/stores/${id}`, {
      method: 'PUT',
      headers: await adminAuth(),
      body: JSON.stringify({ is_active: 0 }),
    });
    expect(off.status).toBe(200);
    let items = (await (await SELF.fetch('http://x/api/stores')).json()) as any[];
    expect(items.find((s) => s.id === id)).toBeUndefined();

    const on = await SELF.fetch(`http://x/api/admin/stores/${id}`, {
      method: 'PUT',
      headers: await adminAuth(),
      body: JSON.stringify({ is_active: 1 }),
    });
    expect(on.status).toBe(200);
    items = (await (await SELF.fetch('http://x/api/stores')).json()) as any[];
    expect(items.find((s) => s.id === id)).toBeDefined();
  });

  it('编辑店名/地址/备注', async () => {
    const create = await SELF.fetch('http://x/api/admin/stores', {
      method: 'POST',
      headers: await adminAuth(),
      body: JSON.stringify({ name: '早茶铺' }),
    });
    const { id } = (await create.json()) as any;

    const bad = await SELF.fetch(`http://x/api/admin/stores/${id}`, {
      method: 'PUT',
      headers: await adminAuth(),
      body: JSON.stringify({ name: '  ' }),
    });
    expect(bad.status).toBe(400);

    const ok = await SELF.fetch(`http://x/api/admin/stores/${id}`, {
      method: 'PUT',
      headers: await adminAuth(),
      body: JSON.stringify({ name: '老广早茶', address: '北京路 1 号', note: '虾饺必点' }),
    });
    expect(ok.status).toBe(200);
    const list = await SELF.fetch('http://x/api/admin/stores', { headers: await adminAuth() });
    const store = ((await list.json()) as any[]).find((s) => s.id === id);
    expect(store).toMatchObject({ name: '老广早茶', address: '北京路 1 号', note: '虾饺必点' });
  });

  it('店内菜品增删改', async () => {
    const create = await SELF.fetch('http://x/api/admin/stores', {
      method: 'POST',
      headers: await adminAuth(),
      body: JSON.stringify({ name: '烤肉店' }),
    });
    const { id } = (await create.json()) as any;

    // 新增
    const add = await SELF.fetch(`http://x/api/admin/stores/${id}/dishes`, {
      method: 'POST',
      headers: await adminAuth(),
      body: JSON.stringify({ name: '五花肉', note: '必点' }),
    });
    expect(add.status).toBe(200);
    const dish = (await add.json()) as any;
    expect(dish).toMatchObject({ name: '五花肉', note: '必点' });

    // 空菜名拒绝
    const badAdd = await SELF.fetch(`http://x/api/admin/stores/${id}/dishes`, {
      method: 'POST',
      headers: await adminAuth(),
      body: JSON.stringify({ name: '  ' }),
    });
    expect(badAdd.status).toBe(400);

    // 编辑
    const put = await SELF.fetch(`http://x/api/admin/stores/${id}/dishes/${dish.id}`, {
      method: 'PUT',
      headers: await adminAuth(),
      body: JSON.stringify({ name: '五花肉（厚切）', note: '' }),
    });
    expect(put.status).toBe(200);

    const list = await SELF.fetch('http://x/api/admin/stores', { headers: await adminAuth() });
    const store = ((await list.json()) as any[]).find((s) => s.id === id);
    expect(store.dishes[0]).toMatchObject({ name: '五花肉（厚切）', note: '' });

    // 删除
    const del = await SELF.fetch(`http://x/api/admin/stores/${id}/dishes/${dish.id}`, {
      method: 'DELETE',
      headers: await adminAuth(),
    });
    expect(del.status).toBe(200);
    expect(await env.DB.prepare('SELECT id FROM store_dishes WHERE id = ?').bind(dish.id).first()).toBeNull();
  });

  it('删除门店：店内菜品级联删除，R2 封面清理', async () => {
    const form = new FormData();
    form.append('name', '甜品屋');
    form.append('dishes', JSON.stringify([{ name: '提拉米苏' }]));
    form.append('image', new File([new Uint8Array([4, 5, 6])], 'cake.png', { type: 'image/png' }));
    const create = await SELF.fetch('http://x/api/admin/stores', {
      method: 'POST',
      headers: { Authorization: `Bearer ${await adminToken()}` },
      body: form,
    });
    const { id } = (await create.json()) as any;
    const row = await env.DB.prepare('SELECT image FROM stores WHERE id = ?').bind(id).first<{ image: string }>();
    const dish = await env.DB.prepare('SELECT id FROM store_dishes WHERE store_id = ?').bind(id).first<{ id: number }>();
    expect(await env.UPLOADS.get(row!.image)).not.toBeNull();

    const del = await SELF.fetch(`http://x/api/admin/stores/${id}`, {
      method: 'DELETE',
      headers: await adminAuth(),
    });
    expect(del.status).toBe(200);
    expect(await env.DB.prepare('SELECT id FROM stores WHERE id = ?').bind(id).first()).toBeNull();
    expect(await env.DB.prepare('SELECT id FROM store_dishes WHERE id = ?').bind(dish!.id).first()).toBeNull();
    expect(await env.UPLOADS.get(row!.image)).toBeNull();
  });

  it('编辑/删除不存在的门店或菜品 404', async () => {
    const put = await SELF.fetch('http://x/api/admin/stores/999999', {
      method: 'PUT',
      headers: await adminAuth(),
      body: JSON.stringify({ name: 'x' }),
    });
    expect(put.status).toBe(404);
    const del = await SELF.fetch('http://x/api/admin/stores/999999', {
      method: 'DELETE',
      headers: await adminAuth(),
    });
    expect(del.status).toBe(404);
    const dishDel = await SELF.fetch('http://x/api/admin/stores/1/dishes/999999', {
      method: 'DELETE',
      headers: await adminAuth(),
    });
    expect(dishDel.status).toBe(404);
  });
});
