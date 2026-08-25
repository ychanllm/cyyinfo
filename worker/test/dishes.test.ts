import { SELF, env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SignJWT } from 'jose';
import { applyMigrations, registerUser, adminToken } from './helpers';

let alice: { id: number; token: string };
let bob: { id: number; token: string };

// 注册接口限流 30 次/15 分钟（全测试文件共享）：只真实注册 1 个用户，
// 第二个用户直接插库 + 手工签 JWT，避免挤占注册配额
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

const createDish = (u: { token: string }, name: string, description = '') =>
  SELF.fetch('http://x/api/dishes', {
    method: 'POST',
    headers: userAuth(u),
    body: JSON.stringify({ name, description }),
  });
const want = (u: { token: string }, id: number) =>
  SELF.fetch(`http://x/api/dishes/${id}/want`, { method: 'POST', headers: userAuth(u) });

beforeAll(async () => {
  await applyMigrations();
  alice = await registerUser('dishes_alice');
  bob = await makeUserDirect('dishes_bob');
  await env.DB.prepare('DELETE FROM dish_wants').run();
  await env.DB.prepare('DELETE FROM dishes').run();
});

// 测试共享同一 D1：清空本文件数据，避免外键挡住其他测试的 DELETE FROM users
afterAll(async () => {
  await env.DB.prepare('DELETE FROM dish_wants').run();
  await env.DB.prepare('DELETE FROM dishes').run();
});

describe('菜品投稿', () => {
  it('未登录投稿 401', async () => {
    const res = await SELF.fetch('http://x/api/dishes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '红烧肉' }),
    });
    expect(res.status).toBe(401);
  });

  it('空菜名 / 超长菜名拒绝', async () => {
    expect((await createDish(alice, '')).status).toBe(400);
    expect((await createDish(alice, '   ')).status).toBe(400);
    expect((await createDish(alice, 'x'.repeat(51))).status).toBe(400);
  });

  it('投稿成功并出现在公开列表（want_count=0, wanted_by_me=false）', async () => {
    const res = await createDish(alice, '红烧肉', '肥而不腻');
    expect(res.status).toBe(200);
    const { id, image } = (await res.json()) as any;
    expect(id).toBeGreaterThan(0);
    expect(image).toBeNull();

    const list = await SELF.fetch('http://x/api/dishes');
    const items = (await list.json()) as any[];
    const dish = items.find((d) => d.id === id);
    expect(dish).toMatchObject({
      name: '红烧肉', description: '肥而不腻', want_count: 0, wanted_by_me: false, chef_pick: false,
    });
  });

  it('multipart 投稿（带图片）成功', async () => {
    const form = new FormData();
    form.append('name', '番茄炒蛋');
    form.append('description', '家常菜');
    form.append('image', new File([new Uint8Array([1, 2, 3])], 'dish.png', { type: 'image/png' }));
    const res = await SELF.fetch('http://x/api/dishes', {
      method: 'POST',
      headers: { Authorization: `Bearer ${alice.token}` },
      body: form,
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.image).toMatch(/^dishes\/.+\.png$/);
    // 清理 R2 与记录
    await env.DB.prepare('DELETE FROM dishes WHERE id = ?').bind(data.id).run();
    await env.UPLOADS.delete(data.image);
  });
});

describe('想吃 toggle', () => {
  let dishId: number;

  beforeAll(async () => {
    const res = await createDish(alice, '糖醋排骨');
    dishId = ((await res.json()) as any).id;
  });

  it('未登录点想吃 401', async () => {
    const res = await SELF.fetch(`http://x/api/dishes/${dishId}/want`, { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('想吃/取消往返，want_count 正确变化', async () => {
    let res = await want(alice, dishId);
    expect(res.status).toBe(200);
    expect((await res.json()) as any).toEqual({ wanted: true, want_count: 1 });

    res = await want(bob, dishId);
    expect((await res.json()) as any).toEqual({ wanted: true, want_count: 2 });

    res = await want(alice, dishId);
    expect((await res.json()) as any).toEqual({ wanted: false, want_count: 1 });
  });

  it('列表 wanted_by_me 按当前用户标记', async () => {
    const mine = await SELF.fetch('http://x/api/dishes', { headers: userAuth(bob) });
    const items = (await mine.json()) as any[];
    const dish = items.find((d) => d.id === dishId);
    expect(dish.wanted_by_me).toBe(true);
    expect(dish.want_count).toBe(1);

    const anon = await SELF.fetch('http://x/api/dishes');
    const anonDish = ((await anon.json()) as any[]).find((d) => d.id === dishId);
    expect(anonDish.wanted_by_me).toBe(false);
  });

  it('UNIQUE 约束：重复插入同一用户同一菜品被拒绝', async () => {
    await expect(
      env.DB.prepare('INSERT INTO dish_wants (user_id, dish_id) VALUES (?, ?)').bind(bob.id, dishId).run()
    ).rejects.toThrow();
  });

  it('对已下架/不存在菜品点想吃 404', async () => {
    expect((await want(alice, 999999)).status).toBe(404);
  });
});

describe('管理端菜品管理', () => {
  it('未授权访问 401', async () => {
    expect((await SELF.fetch('http://x/api/admin/dishes')).status).toBe(401);
  });

  it('管理员新建 + 列表含想吃明细', async () => {
    const create = await SELF.fetch('http://x/api/admin/dishes', {
      method: 'POST',
      headers: await adminAuth(),
      body: JSON.stringify({ name: '清蒸鲈鱼' }),
    });
    expect(create.status).toBe(200);
    const { id } = (await create.json()) as any;
    await want(alice, id);

    const publicList = await SELF.fetch('http://x/api/dishes');
    const publicDish = ((await publicList.json()) as any[]).find((d) => d.id === id);
    expect(publicDish).toMatchObject({ chef_pick: true });

    const list = await SELF.fetch('http://x/api/admin/dishes', { headers: await adminAuth() });
    const dish = ((await list.json()) as any[]).find((d) => d.id === id);
    expect(dish).toMatchObject({
      name: '清蒸鲈鱼',
      created_by_user_id: null,
      created_by_username: null,
      is_active: 1,
      want_count: 1,
    });
    expect(dish.want_usernames).toEqual(['dishes_alice']);
  });

  it('下架后公开列表不可见，恢复后可见', async () => {
    const create = await SELF.fetch('http://x/api/admin/dishes', {
      method: 'POST',
      headers: await adminAuth(),
      body: JSON.stringify({ name: '麻婆豆腐' }),
    });
    const { id } = (await create.json()) as any;

    const off = await SELF.fetch(`http://x/api/admin/dishes/${id}`, {
      method: 'PUT',
      headers: await adminAuth(),
      body: JSON.stringify({ is_active: 0 }),
    });
    expect(off.status).toBe(200);
    let items = (await (await SELF.fetch('http://x/api/dishes')).json()) as any[];
    expect(items.find((d) => d.id === id)).toBeUndefined();

    const on = await SELF.fetch(`http://x/api/admin/dishes/${id}`, {
      method: 'PUT',
      headers: await adminAuth(),
      body: JSON.stringify({ is_active: 1 }),
    });
    expect(on.status).toBe(200);
    items = (await (await SELF.fetch('http://x/api/dishes')).json()) as any[];
    expect(items.find((d) => d.id === id)).toBeDefined();
  });

  it('编辑名称/描述', async () => {
    const create = await SELF.fetch('http://x/api/admin/dishes', {
      method: 'POST',
      headers: await adminAuth(),
      body: JSON.stringify({ name: '宫保鸡丁' }),
    });
    const { id } = (await create.json()) as any;

    // 空名拒绝
    const bad = await SELF.fetch(`http://x/api/admin/dishes/${id}`, {
      method: 'PUT',
      headers: await adminAuth(),
      body: JSON.stringify({ name: '  ' }),
    });
    expect(bad.status).toBe(400);

    const ok = await SELF.fetch(`http://x/api/admin/dishes/${id}`, {
      method: 'PUT',
      headers: await adminAuth(),
      body: JSON.stringify({ name: '宫保鸡丁（微辣）', description: '下饭神器' }),
    });
    expect(ok.status).toBe(200);
    const list = await SELF.fetch('http://x/api/admin/dishes', { headers: await adminAuth() });
    const dish = ((await list.json()) as any[]).find((d) => d.id === id);
    expect(dish).toMatchObject({ name: '宫保鸡丁（微辣）', description: '下饭神器' });
  });

  it('删除菜品：dish_wants 级联删除，R2 图片清理', async () => {
    const form = new FormData();
    form.append('name', '水煮鱼');
    form.append('image', new File([new Uint8Array([4, 5, 6])], 'fish.png', { type: 'image/png' }));
    const create = await SELF.fetch('http://x/api/admin/dishes', {
      method: 'POST',
      headers: { Authorization: `Bearer ${await adminToken()}` },
      body: form,
    });
    const { id } = (await create.json()) as any;
    const row = await env.DB.prepare('SELECT image FROM dishes WHERE id = ?').bind(id).first<{ image: string }>();
    expect(await env.UPLOADS.get(row!.image)).not.toBeNull();
    await want(alice, id);

    const del = await SELF.fetch(`http://x/api/admin/dishes/${id}`, {
      method: 'DELETE',
      headers: await adminAuth(),
    });
    expect(del.status).toBe(200);
    expect(await env.DB.prepare('SELECT id FROM dishes WHERE id = ?').bind(id).first()).toBeNull();
    expect(await env.DB.prepare('SELECT id FROM dish_wants WHERE dish_id = ?').bind(id).first()).toBeNull();
    expect(await env.UPLOADS.get(row!.image)).toBeNull();
  });

  it('编辑/删除不存在的菜品 404', async () => {
    const put = await SELF.fetch('http://x/api/admin/dishes/999999', {
      method: 'PUT',
      headers: await adminAuth(),
      body: JSON.stringify({ name: 'x' }),
    });
    expect(put.status).toBe(404);
    const del = await SELF.fetch('http://x/api/admin/dishes/999999', {
      method: 'DELETE',
      headers: await adminAuth(),
    });
    expect(del.status).toBe(404);
  });
});

describe('admin 菜品分页与搜索', () => {
  const dishIds: number[] = [];

  beforeAll(async () => {
    // 先清掉本文件前面用例留下的菜品和想吃,保证计数可控
    await env.DB.prepare('DELETE FROM dish_wants').run();
    await env.DB.prepare('DELETE FROM dishes').run();
    for (let i = 1; i <= 25; i++) {
      const r = await env.DB.prepare("INSERT INTO dishes (name, description) VALUES (?, ?)")
        .bind(`分页测菜${String(i).padStart(2, '0')}`, i === 1 ? '招牌描述' : '').run();
      dishIds.push(Number(r.meta.last_row_id));
    }
  });

  it('不带参数保持数组返回(兼容)', async () => {
    const res = await SELF.fetch('http://x/api/admin/dishes', { headers: await adminAuth() });
    const body = (await res.json()) as unknown;
    expect(Array.isArray(body)).toBe(true);
  });

  it('分页:total/items/page/size 正确,按 id DESC', async () => {
    const res = await SELF.fetch(`http://x/api/admin/dishes?page=2&size=10&q=${encodeURIComponent('分页测菜')}`, { headers: await adminAuth() });
    const body = (await res.json()) as any;
    expect(body.total).toBe(25);
    expect(body.items).toHaveLength(10);
    expect(body.items[0].name).toBe('分页测菜15'); // id DESC:25..16 是第 1 页,15..6 是第 2 页
    expect(body.items[9].name).toBe('分页测菜06');
  });

  it('搜索匹配描述;want_usernames 只含当前页菜品', async () => {
    // alice 想吃第 1 道,bob 想吃第 2 道
    await SELF.fetch(`http://x/api/dishes/${dishIds[0]}/want`, { method: 'POST', headers: userAuth(alice) });
    await SELF.fetch(`http://x/api/dishes/${dishIds[1]}/want`, { method: 'POST', headers: userAuth(bob) });

    const res = await SELF.fetch(`http://x/api/admin/dishes?q=${encodeURIComponent('招牌描述')}`, { headers: await adminAuth() });
    const body = (await res.json()) as any[];
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe('分页测菜01');
    expect(body[0].want_usernames).toEqual(['dishes_alice']);

    // 分页形态同样只带当前页的 want_usernames
    const paged = await SELF.fetch(`http://x/api/admin/dishes?page=1&size=1&q=${encodeURIComponent('分页测菜02')}`, { headers: await adminAuth() });
    const pagedBody = (await paged.json()) as any;
    expect(pagedBody.items[0].want_usernames).toEqual(['dishes_bob']);
  });
});
