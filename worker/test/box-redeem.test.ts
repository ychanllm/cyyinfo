import { SELF, env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { applyMigrations, registerUser } from './helpers';

beforeAll(applyMigrations);

let user: { id: number; token: string };
const auth = () => ({ Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json' });

beforeAll(async () => {
  user = await registerUser('box_user');
});

async function reset(points: number) {
  // 先清空全部记录再清奖品：prize_records.prize_id 有外键，其他测试文件残留的记录会导致删奖品失败
  await env.DB.prepare('DELETE FROM prize_records').run();
  await env.DB.prepare('DELETE FROM point_transactions WHERE user_id = ?').bind(user.id).run();
  await env.DB.prepare('UPDATE users SET points = ? WHERE id = ?').bind(points, user.id).run();
  await env.DB.prepare('DELETE FROM prizes').run();
  await env.DB.prepare("DELETE FROM settings WHERE key IN ('checkin_base_points','checkin_streak_bonus','checkin_max_points','box_cost')").run();
}

async function insertPrize(p: { name: string; points_cost?: number; box_weight?: number; stock?: number }): Promise<number> {
  const r = await env.DB.prepare(
    'INSERT INTO prizes (name, points_cost, box_weight, stock) VALUES (?, ?, ?, ?)'
  ).bind(p.name, p.points_cost ?? 0, p.box_weight ?? 0, p.stock ?? -1).run();
  return Number(r.meta.last_row_id);
}

async function balance(): Promise<number> {
  const row = await env.DB.prepare('SELECT points FROM users WHERE id = ?').bind(user.id).first<{ points: number }>();
  return row!.points;
}

describe('盲盒', () => {
  it('积分不足 400', async () => {
    await reset(50);
    await insertPrize({ name: '按摩券', box_weight: 1 });
    const res = await SELF.fetch('http://x/api/box/draw', { method: 'POST', headers: auth() });
    expect(res.status).toBe(400);
    expect(await balance()).toBe(50);
  });

  it('奖池为空 409 且不扣分', async () => {
    await reset(500);
    await insertPrize({ name: '不进池', points_cost: 100 }); // box_weight=0
    const res = await SELF.fetch('http://x/api/box/draw', { method: 'POST', headers: auth() });
    expect(res.status).toBe(409);
    expect(await balance()).toBe(500);
  });

  it('抽中扣 100 分、减库存、写记录和流水', async () => {
    await reset(300);
    const pid = await insertPrize({ name: '大餐一顿', box_weight: 5, stock: 2 });
    const res = await SELF.fetch('http://x/api/box/draw', { method: 'POST', headers: auth() });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.prize.id).toBe(pid);
    expect(data.prize.name).toBe('大餐一顿');
    expect(data.balance).toBe(200);

    const prize = await env.DB.prepare('SELECT stock FROM prizes WHERE id = ?').bind(pid).first<{ stock: number }>();
    expect(prize!.stock).toBe(1);

    const rec = await env.DB.prepare("SELECT * FROM prize_records WHERE user_id = ? AND source = 'box'").bind(user.id).all();
    expect(rec.results).toHaveLength(1);
    expect((rec.results[0] as any).points_spent).toBe(100);
    expect((rec.results[0] as any).status).toBe('pending');

    const tx = await env.DB.prepare("SELECT * FROM point_transactions WHERE user_id = ? AND type = 'box'").bind(user.id).all();
    expect(tx.results).toHaveLength(1);
    expect((tx.results[0] as any).change).toBe(-100);
    expect((tx.results[0] as any).balance_after).toBe(200);
  });

  it('无限库存（-1）不扣库存', async () => {
    await reset(1000);
    const pid = await insertPrize({ name: '拥抱一个', box_weight: 1, stock: -1 });
    await SELF.fetch('http://x/api/box/draw', { method: 'POST', headers: auth() });
    const prize = await env.DB.prepare('SELECT stock FROM prizes WHERE id = ?').bind(pid).first<{ stock: number }>();
    expect(prize!.stock).toBe(-1);
  });

  it('库存为 0 的奖品不进奖池', async () => {
    await reset(500);
    await insertPrize({ name: '已抽空', box_weight: 10, stock: 0 });
    const res = await SELF.fetch('http://x/api/box/draw', { method: 'POST', headers: auth() });
    expect(res.status).toBe(409);
    expect(await balance()).toBe(500);
  });
});

describe('兑换', () => {
  it('成功兑换：扣分减库存写记录', async () => {
    await reset(500);
    const pid = await insertPrize({ name: '电影之夜', points_cost: 200, stock: 3 });
    const res = await SELF.fetch(`http://x/api/prizes/${pid}/redeem`, { method: 'POST', headers: auth() });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.balance).toBe(300);
    expect(data.record_id).toBeTruthy();
    expect((await env.DB.prepare('SELECT stock FROM prizes WHERE id = ?').bind(pid).first<{ stock: number }>())!.stock).toBe(2);
  });

  it('积分不足 400 / 无库存 409 / 不可兑换 409 / 不存在 404', async () => {
    await reset(100);
    const pid = await insertPrize({ name: '贵奖品', points_cost: 200 });
    expect((await SELF.fetch(`http://x/api/prizes/${pid}/redeem`, { method: 'POST', headers: auth() })).status).toBe(400);

    await reset(1000);
    const outOfStock = await insertPrize({ name: '没了', points_cost: 100, stock: 0 });
    expect((await SELF.fetch(`http://x/api/prizes/${outOfStock}/redeem`, { method: 'POST', headers: auth() })).status).toBe(409);

    const boxOnly = await insertPrize({ name: '只能抽', box_weight: 1 }); // points_cost=0
    expect((await SELF.fetch(`http://x/api/prizes/${boxOnly}/redeem`, { method: 'POST', headers: auth() })).status).toBe(409);

    expect((await SELF.fetch('http://x/api/prizes/99999/redeem', { method: 'POST', headers: auth() })).status).toBe(404);
    expect(await balance()).toBe(1000);
  });
});

describe('奖品列表', () => {
  it('只返回上架奖品，含 in_box/in_stock 标记', async () => {
    await reset(0);
    await insertPrize({ name: 'A', points_cost: 100, box_weight: 1 });
    const off = await insertPrize({ name: '下架', points_cost: 100 });
    await env.DB.prepare('UPDATE prizes SET is_active = 0 WHERE id = ?').bind(off).run();
    const res = await SELF.fetch('http://x/api/prizes');
    expect(res.status).toBe(200);
    const list = await res.json() as any[];
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('A');
    expect(list[0].in_box).toBe(true);
    expect(list[0].in_stock).toBe(true);
  });
});
