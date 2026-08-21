import { SELF, env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { applyMigrations, adminToken, registerUser } from './helpers';

let token: string;
beforeAll(async () => { await applyMigrations(); token = await adminToken(); });
const auth = () => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

async function cleanup() {
  await env.DB.prepare('DELETE FROM prize_records').run();
  await env.DB.prepare('DELETE FROM prizes').run();
  await env.DB.prepare("DELETE FROM settings WHERE key IN ('checkin_base_points','checkin_streak_bonus','checkin_max_points','box_cost')").run();
}

async function createPrize(body: Record<string, unknown>) {
  return SELF.fetch('http://x/api/admin/prizes', {
    method: 'POST', headers: auth(), body: JSON.stringify(body),
  });
}

describe('后台奖品管理', () => {
  it('未授权 401', async () => {
    expect((await SELF.fetch('http://x/api/admin/prizes')).status).toBe(401);
  });

  it('创建/列表/编辑/删除', async () => {
    await cleanup();
    const bad = await createPrize({ name: '' });
    expect(bad.status).toBe(400);
    const badStock = await createPrize({ name: 'X', stock: -2 });
    expect(badStock.status).toBe(400);

    const created = await createPrize({ name: '按摩券', name_en: 'Massage', points_cost: 200, box_weight: 3, stock: 5 });
    expect(created.status).toBe(200);
    const { id } = await created.json() as any;

    const list = await (await SELF.fetch('http://x/api/admin/prizes', { headers: auth() })).json() as any[];
    const prize = list.find((p) => p.id === id);
    expect(prize).toMatchObject({ name: '按摩券', name_en: 'Massage', points_cost: 200, box_weight: 3, stock: 5, is_active: 1 });

    const upd = await SELF.fetch(`http://x/api/admin/prizes/${id}`, {
      method: 'PUT', headers: auth(), body: JSON.stringify({ points_cost: 300, stock: -1 }),
    });
    expect(upd.status).toBe(200);
    const after = await (await SELF.fetch('http://x/api/admin/prizes', { headers: auth() })).json() as any[];
    expect(after.find((p) => p.id === id)).toMatchObject({ points_cost: 300, stock: -1 });

    // 无记录引用 → 硬删
    const del = await SELF.fetch(`http://x/api/admin/prizes/${id}`, { method: 'DELETE', headers: auth() });
    expect(del.status).toBe(200);
    expect(await env.DB.prepare('SELECT id FROM prizes WHERE id = ?').bind(id).first()).toBeNull();
  });

  it('有记录引用的奖品删除时软删', async () => {
    await cleanup();
    const { id } = await (await createPrize({ name: '大餐', points_cost: 100 })).json() as any;
    const user = await registerUser('admin_prize_user');
    await env.DB.prepare(
      "INSERT INTO prize_records (user_id, prize_id, source, points_spent) VALUES (?, ?, 'redeem', 100)"
    ).bind(user.id, id).run();

    await SELF.fetch(`http://x/api/admin/prizes/${id}`, { method: 'DELETE', headers: auth() });
    const row = await env.DB.prepare('SELECT is_active FROM prizes WHERE id = ?').bind(id).first<{ is_active: number }>();
    expect(row!.is_active).toBe(0);
  });
});

describe('核销记录管理', () => {
  it('列表筛选、后台核销、取消退积分', async () => {
    await cleanup();
    const user = await registerUser('record_user');
    await env.DB.prepare('UPDATE users SET points = 0 WHERE id = ?').bind(user.id).run();
    const { id: pid } = await (await createPrize({ name: '电影', points_cost: 150 })).json() as any;
    const rec = await env.DB.prepare(
      "INSERT INTO prize_records (user_id, prize_id, source, points_spent) VALUES (?, ?, 'redeem', 150)"
    ).bind(user.id, pid).run();
    const rid = Number(rec.meta.last_row_id);

    const all = await (await SELF.fetch('http://x/api/admin/prize-records', { headers: auth() })).json() as any[];
    const mine = all.find((r) => r.id === rid);
    expect(mine).toMatchObject({ username: 'record_user', prize_name: '电影', status: 'pending' });

    const filtered = await (await SELF.fetch('http://x/api/admin/prize-records?status=used', { headers: auth() })).json() as any[];
    expect(filtered.find((r) => r.id === rid)).toBeUndefined();

    // 取消：状态 cancelled + 退 150 分 + 写流水
    const cancel = await SELF.fetch(`http://x/api/admin/prize-records/${rid}/cancel`, { method: 'POST', headers: auth() });
    expect(cancel.status).toBe(200);
    expect((await env.DB.prepare('SELECT status FROM prize_records WHERE id = ?').bind(rid).first<any>())!.status).toBe('cancelled');
    expect((await env.DB.prepare('SELECT points FROM users WHERE id = ?').bind(user.id).first<any>())!.points).toBe(150);
    const tx = await env.DB.prepare("SELECT * FROM point_transactions WHERE user_id = ? AND type = 'cancel_refund'").bind(user.id).all();
    expect(tx.results).toHaveLength(1);
    expect((tx.results[0] as any).change).toBe(150);

    // 已取消的不能再核销/取消
    expect((await SELF.fetch(`http://x/api/admin/prize-records/${rid}/use`, { method: 'POST', headers: auth() })).status).toBe(409);
    expect((await SELF.fetch(`http://x/api/admin/prize-records/${rid}/cancel`, { method: 'POST', headers: auth() })).status).toBe(409);

    // 第二次 cancel 不得重复退款
    expect((await env.DB.prepare('SELECT points FROM users WHERE id = ?').bind(user.id).first<any>())!.points).toBe(150);
    const txAfter = await env.DB.prepare("SELECT * FROM point_transactions WHERE user_id = ? AND type = 'cancel_refund'").bind(user.id).all();
    expect(txAfter.results).toHaveLength(1);
  });

  it('后台核销 pending 记录', async () => {
    await cleanup();
    const user = await registerUser('record_user2');
    const { id: pid } = await (await createPrize({ name: '拥抱', points_cost: 50 })).json() as any;
    const rec = await env.DB.prepare(
      "INSERT INTO prize_records (user_id, prize_id, source, points_spent) VALUES (?, ?, 'box', 50)"
    ).bind(user.id, pid).run();
    const rid = Number(rec.meta.last_row_id);
    const ok = await SELF.fetch(`http://x/api/admin/prize-records/${rid}/use`, { method: 'POST', headers: auth() });
    expect(ok.status).toBe(200);
    const row = await env.DB.prepare('SELECT status, used_at FROM prize_records WHERE id = ?').bind(rid).first<any>();
    expect(row.status).toBe('used');
    expect(row.used_at).toBeTruthy();
  });
});

describe('签到设置', () => {
  it('默认读取、修改、非法值拒绝', async () => {
    await cleanup();
    const def = await (await SELF.fetch('http://x/api/admin/checkin-settings', { headers: auth() })).json() as any;
    expect(def).toEqual({
      checkin_base_points: '10', checkin_streak_bonus: '5', checkin_max_points: '40', box_cost: '100',
    });

    const upd = await SELF.fetch('http://x/api/admin/checkin-settings', {
      method: 'PUT', headers: auth(), body: JSON.stringify({ box_cost: 80 }),
    });
    expect(upd.status).toBe(200);
    const after = await (await SELF.fetch('http://x/api/admin/checkin-settings', { headers: auth() })).json() as any;
    expect(after.box_cost).toBe('80');
    expect(after.checkin_base_points).toBe('10');

    const bad = await SELF.fetch('http://x/api/admin/checkin-settings', {
      method: 'PUT', headers: auth(), body: JSON.stringify({ box_cost: 0 }),
    });
    expect(bad.status).toBe(400);

    await env.DB.prepare("DELETE FROM settings WHERE key IN ('checkin_base_points','checkin_streak_bonus','checkin_max_points','box_cost')").run();
  });

  it('非法值不产生部分写入', async () => {
    await cleanup();
    const partial = await SELF.fetch('http://x/api/admin/checkin-settings', {
      method: 'PUT', headers: auth(), body: JSON.stringify({ checkin_base_points: 20, box_cost: 0 }),
    });
    expect(partial.status).toBe(400);
    const unchanged = await (await SELF.fetch('http://x/api/admin/checkin-settings', { headers: auth() })).json() as any;
    expect(unchanged.checkin_base_points).toBe('10'); // 仍是默认值，未被部分写入
    expect(unchanged.box_cost).toBe('100');
  });
});
